// A slow breaker on the office's worker ceiling. The 16 GB office Mac crashes when too many workers build at once,
// and a fixed cap (--max-workers, ⚙️ Settings) is either too low on a quiet day or too high on a busy one. So the
// office's Machine (upstream machine.js, which already reads the CPU and memory every 5 s for the wall monitor)
// feeds each reading here:
//
//   trip     the CPU or memory at or over 90% for 30 s straight: the ceiling drops to the workers there now.
//            Nobody running is stopped; new hires are refused with why, and queued tasks wait.
//   reopen   both under 90% for 2 full minutes: the ceiling goes up by one and the 2-minute clock starts again,
//            until it is back at the normal cap. Any reading at 90% or over restarts the clock.
//
// Built to server/rb-breaker.js; scripts/rustybunsify.ts applies MACHINE_PATCHES to machine.js and calls
// holdMachine from office/services.js. It only changes this office's own cap, never the builder's (scripts/remote-ci.ts).
// AGENT_OFFICE_BREAKER=off turns it off; AGENT_OFFICE_BREAKER_AT, _TRIP_S, _REOPEN_S and _STEP change the numbers.
import os from "node:os";

export interface BreakerConfig {
  /** A reading this high (percent), CPU or memory, is hot. */
  at: number;
  /** Hot this long in a row trips the breaker. */
  tripMs: number;
  /** Cool (both under `at`) this long in a row opens the ceiling by `step`. */
  reopenMs: number;
  step: number;
}

export const BREAKER_DEFAULTS: BreakerConfig = { at: 90, tripMs: 30_000, reopenMs: 120_000, step: 1 };

/** The breaker's numbers from the environment, or null when AGENT_OFFICE_BREAKER=off. */
export function breakerConfig(env: Record<string, string | undefined> = process.env): BreakerConfig | null {
  if (env.AGENT_OFFICE_BREAKER === "off") return null;
  const num = (name: string, fallback: number, min: number) => {
    const n = Number(env[name]);
    return env[name]?.trim() && Number.isFinite(n) && n >= min ? n : fallback;
  };
  return {
    at: num("AGENT_OFFICE_BREAKER_AT", BREAKER_DEFAULTS.at, 1),
    tripMs: num("AGENT_OFFICE_BREAKER_TRIP_S", BREAKER_DEFAULTS.tripMs / 1000, 0) * 1000,
    reopenMs: num("AGENT_OFFICE_BREAKER_REOPEN_S", BREAKER_DEFAULTS.reopenMs / 1000, 0) * 1000,
    step: Math.floor(num("AGENT_OFFICE_BREAKER_STEP", BREAKER_DEFAULTS.step, 1)),
  };
}

/** One look at the machine: when, and how busy its CPU and how full its memory, in percent. */
export interface Reading { at: number; cpu: number; mem: number }

export interface BreakerState {
  /** The most workers for now, or null when the breaker is closed (the normal cap holds). */
  ceiling: number | null;
  /** Since when every reading has been hot, or null. */
  hotSince: number | null;
  /** Since when every reading has been cool, or null. */
  coolSince: number | null;
  last: Reading | null;
}

export const CLOSED: BreakerState = { ceiling: null, hotSince: null, coolSince: null, last: null };

/** The breaker after one more reading, with `running` workers in the office and a normal cap (undefined: no cap). */
export function stepBreaker(s: BreakerState, r: Reading, running: number, normal: number | undefined, cfg: BreakerConfig): BreakerState {
  const hot = r.cpu >= cfg.at || r.mem >= cfg.at;
  const hotSince = hot ? (s.hotSince ?? r.at) : null;
  let coolSince = hot ? null : (s.coolSince ?? r.at);
  let ceiling = s.ceiling;
  const cap = normal ?? Infinity;
  if (hotSince !== null && r.at - hotSince >= cfg.tripMs) ceiling = Math.min(ceiling ?? cap, cap, running);
  else if (ceiling !== null && coolSince !== null && r.at - coolSince >= cfg.reopenMs) {
    // with no normal cap there is nothing to climb back to: a step whose last opening went unused closes it
    ceiling = normal === undefined && ceiling > running ? null : ceiling + cfg.step;
    coolSince = r.at;
  }
  if (ceiling !== null && ceiling >= cap) ceiling = null;
  return { ceiling, hotSince, coolSince, last: r };
}

/** The office's cap now: the normal one, held lower while the breaker is open. */
export function heldLimit(s: BreakerState, normal: number | undefined): number | undefined {
  return s.ceiling === null ? normal : Math.min(normal ?? Infinity, s.ceiling);
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s % 60 === 0 ? `${s / 60} min` : s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Why the office won't hire past its ceiling right now, or undefined while the breaker is closed:
 * "the office is cooling down: CPU 94% (2 min under 90% to reopen), 5 of 12 workers for now".
 */
export function coolingLine(s: BreakerState, normal: number | undefined, cfg: BreakerConfig, now: number): string | undefined {
  if (s.ceiling === null || !s.last) return undefined;
  const { cpu, mem } = s.last;
  const over = [cpu >= cfg.at && `CPU ${cpu}%`, mem >= cfg.at && `memory ${mem}%`].filter(Boolean);
  const reading = over.length ? over.join(", ") : `CPU ${cpu}%, memory ${mem}%`;
  const left = s.coolSince === null ? cfg.reopenMs : cfg.reopenMs - (now - s.coolSince);
  const cap = normal === undefined ? "" : ` of ${normal}`;
  return `the office is cooling down: ${reading} (${clock(left)} under ${cfg.at}% to reopen), ${s.ceiling}${cap} workers for now`;
}

/** What holdMachine needs of upstream's Machine (machine.js), with the hooks MACHINE_PATCHES call. */
export interface BreakerMachine {
  cpu: number;
  memUsed: number;
  count(): number;
  /** The cap without the breaker: --max-workers or ⚙️ Settings (MACHINE_PATCHES renames upstream's `limit` to it). */
  readonly __rbNormal: number | undefined;
  __rbHold?: (normal: number | undefined) => number | undefined;
  __rbWhy?: () => string | undefined;
  __rbSampled?: (cpu: boolean) => void;
}

/**
 * Puts the breaker on the office's Machine: every CPU reading steps it, the Machine's limit (and so a hire's
 * refusal and the queue's room) follows its ceiling, and `onRise` runs when the ceiling goes up so the queues seat
 * what waited. Returns the breaker's state, for tests.
 */
export function holdMachine(m: BreakerMachine, onRise: () => void, cfg = breakerConfig(), now = Date.now, memTotal = os.totalmem()) {
  let s = CLOSED;
  if (!cfg) return () => s;
  m.__rbHold = (normal) => heldLimit(s, normal);
  m.__rbWhy = () => coolingLine(s, m.__rbNormal, cfg, now());
  m.__rbSampled = (cpu) => {
    if (!cpu) return;
    const before = heldLimit(s, m.__rbNormal) ?? Infinity;
    const mem = memTotal ? Math.round((m.memUsed / memTotal) * 100) : 0;
    s = stepBreaker(s, { at: now(), cpu: m.cpu, mem }, m.count(), m.__rbNormal, cfg);
    if ((heldLimit(s, m.__rbNormal) ?? Infinity) > before) onRise();
  };
  return () => s;
}

/** The edits to upstream's machine.js behind holdMachine; each target is checked against the pinned release. */
export const MACHINE_PATCHES: [from: string, to: string][] = [
  // the cap everyone reads is the breaker's; the old getter stays as the normal cap
  ["    get limit() {\n",
    "    get limit() {\n        const __rbN = this.__rbNormal;\n        return this.__rbHold ? this.__rbHold(__rbN) : __rbN;\n    }\n    get __rbNormal() {\n"],
  // at a held ceiling there is no room at all: a queue doesn't send a finished worker home to seat the next task
  ["        return limit === undefined ? Infinity : limit - this.count();\n",
    "        const __rbRoom = limit === undefined ? Infinity : limit - this.count();\n        return __rbRoom <= 0 && this.__rbWhy?.() ? -1 : __rbRoom;\n"],
  // a hire turned away by the breaker says so, not "send one home"
  ["        if (limit === undefined || this.count() < limit)\n            return undefined;\n",
    "        if (limit === undefined || this.count() < limit)\n            return undefined;\n        const __rbWhy = this.__rbWhy?.();\n        if (__rbWhy)\n            return __rbWhy.charAt(0).toUpperCase() + __rbWhy.slice(1);\n"],
  // the wall monitor and the hire card show the held ceiling, the normal cap and why
  ["            pressure: this.pressure(memTotal),\n",
    "            pressure: this.__rbWhy?.() ?? this.pressure(memTotal),\n            normal: this.__rbNormal,\n            cooling: this.__rbWhy?.(),\n"],
  // every reading steps the breaker, before everyone hears the new state
  ["                this.history.shift();\n        }\n        this.emit();\n",
    "                this.history.shift();\n        }\n        this.__rbSampled?.(cpu);\n        this.emit();\n"],
];
