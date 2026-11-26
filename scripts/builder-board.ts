// What Bob is doing, live, where `bun run builder serve` runs on him (and from the office Mac: `bun run builder watch`).
// A board redrawn in place about once a second: each slot (busy or free, who sent it, its commit, the exact command
// its shell is running, how long, the last output line), the runs waiting for a slot, the last finished runs, his power
// and how many suites at once that allows, and (with SWARM_URL and SWARM_TOKEN set) the test swarm's queue, asked every
// 15 s. A run with no heartbeat or no output past remote-ci's own limits shows
// STALLED; a shell on Bob whose command isn't one the builder sends (a suite, a build, typecheck, its own housekeeping)
// shows UNEXPECTED with its whole command line. Piped or not a terminal, it prints one line per event instead.
//
// Read-only: one shell script (GATHER) reads the builder folder, `pmset` and `ps`, and everything else is pure, so
// the board on Bob and the one over ssh are the same code. It sees the shells remote-ci.ts starts over ssh (their
// command line holds the whole script); a process started some other way is outside it.
import { took, Record as RunGuard } from "./builder-bar.ts";
import { fold, SH_LOCK_HOLDER, type Job as BlenderJob } from "./blender-queue.ts";
import { check } from "../packages/util/src/guard.ts";
import { battery, CUT_CHECK, GATE, plan, PUSH_MS, REMOTE_PATH, STALE_MIN, type Battery, type RunRecord } from "./remote-ci.ts";
import type { QueueReply } from "../apps/test-swarm/src/api.ts";

/** One pass over the builder folder, as `@kind ...` lines. Run in the folder; `PS` swaps the process list (tests). */
export const GATHER = String.raw`mt() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
echo "@now $(date +%s)"
[ -f serving ] && echo "@serving $(mt serving)"
for d in slot-*; do [ -d "$d/.git" ] && echo "@slot $d $(head -c 40 "$d/.git/HEAD" 2>/dev/null)"; done
for l in locks/*; do [ -d "$l" ] && echo "@lock ${"$"}{l#locks/} $(mt "$l")"; done
for f in runs/*.json; do [ -f "$f" ] || continue; s=${"$"}{f#runs/}; s=${"$"}{s%.json}
  echo "@run $s $(mt "runs/$s.log") $(tr -d '\n' < "$f")"
  echo "@last $s $(tail -c 4000 "runs/$s.log" 2>/dev/null | tr '\r' '\n' | awk 'NF { l = $0 } END { print l }')"; done
for f in runs/wait/*.json; do [ -f "$f" ] && echo "@wait $(mt "$f") $(tr -d '\n' < "$f")"; done
ls -t runs/done/*.json 2>/dev/null | head -n 10 | while read -r f; do echo "@done $(tr -d '\n' < "$f")"; done
pmset -g batt 2>/dev/null | sed 's/^/@batt /'
[ -f blender/queue.jsonl ] && sed 's/^/@bq /' blender/queue.jsonl
h=$(${SH_LOCK_HOLDER}) && echo "@bholder $h"
${"$"}{PS:-ps -axww -o pid=,etime=,command=} | awk 'index($0, "/.bun/bin:/opt/homebrew/bin") && !index($0, "@now") { print "@ps " $0 }'
`;

export type Live = RunRecord & { slot: string; logAt: number; last: string };
export type Proc = { pid: number; secs: number; script: string };
/** One gather, parsed. Times are milliseconds. */
export type Shot = {
  now: number; serving: number; slots: { name: string; sha: string }[]; locks: { slot: string; at: number }[];
  runs: Live[]; waiting: (RunRecord & { at: number })[]; done: RunRecord[]; batt: Battery; procs: Proc[]; error?: string;
  /** The Blender queue's running and waiting jobs, and who holds Bob's one Blender (a job, a test, a warm Blender). */
  blender: BlenderJob[]; blenderHolder?: string;
};

// a colour or cursor code (built from a string: a regex literal with ESC in it reads as a mistake to the linter)
const CODE = String.raw`\x1b\[[0-9;?]*[A-Za-z]`;
const ANSI = new RegExp(CODE, "g");
// [[dd-]hh:]mm:ss, as ps prints elapsed time
const etime = (s: string) => {
  const [d, rest] = s.includes("-") ? s.split("-") : ["0", s];
  return (rest ?? "").split(":").map(Number).reduce((a, n) => a * 60 + n, 0) + Number(d) * 86_400;
};
const record = (json: string) => { try { return check(RunGuard, JSON.parse(json)) ?? undefined; } catch { return undefined; } };

export function parseShot(text: string): Shot {
  const shot: Shot = { now: 0, serving: 0, slots: [], locks: [], runs: [], waiting: [], done: [], batt: { onPower: true, pct: 100 }, procs: [], blender: [] };
  const batt: string[] = [], bq: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^@(\w+) ?(.*)$/);
    if (!m) continue;
    const [, kind, rest = ""] = m;
    const [a = "", b = "", ...more] = rest.split(" ");
    if (kind === "now") shot.now = Number(a) * 1000;
    else if (kind === "serving") shot.serving = Number(a) * 1000;
    else if (kind === "slot") shot.slots.push({ name: a, sha: b });
    else if (kind === "lock") shot.locks.push({ slot: a, at: Number(b) * 1000 });
    else if (kind === "run") { const r = record(more.join(" ")); if (r) shot.runs.push({ ...r, slot: a, logAt: Number(b) * 1000, last: "" }); }
    else if (kind === "last") { const r = shot.runs.find((x) => x.slot === a); if (r) r.last = [b, ...more].join(" ").replace(ANSI, "").trim(); }
    else if (kind === "wait") { const r = record([b, ...more].join(" ")); if (r) shot.waiting.push({ ...r, at: Number(a) * 1000 }); }
    else if (kind === "done") { const r = record(rest); if (r) shot.done.push(r); }
    else if (kind === "batt") batt.push(rest);
    else if (kind === "bq") bq.push(rest);
    else if (kind === "bholder") shot.blenderHolder = rest.trim();
    else if (kind === "error") shot.error = rest;
    else if (kind === "ps") { const p = rest.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/); if (p) shot.procs.push({ pid: Number(p[1]), secs: etime(p[2]!), script: p[3]! }); }
  }
  shot.batt = battery(batt.join("\n"));
  shot.blender = fold(bq.join("\n")).filter((j) => j.state === "running" || j.state === "waiting");
  shot.slots.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
  shot.waiting.sort((x, y) => x.started - y.started);
  return shot;
}

// ---- what a shell on Bob is running ----

/** Split a command at `&&` into words, single quotes undone; null when it has anything else a shell acts on. */
function commands(cmd: string): string[][] | null {
  const out: string[][] = [[]];
  let word = "", has = false;
  const end = () => { if (has) out[out.length - 1]!.push(word); word = ""; has = false; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (c === "'") { const j = cmd.indexOf("'", i + 1); if (j < 0) return null; word += cmd.slice(i + 1, j); has = true; i = j; }
    else if (c === "&" && cmd[i + 1] === "&") { end(); out.push([]); i++; }
    else if (/\s/.test(c)) end();
    else if (/[;|&<>$`()\\"{}*?~#]/.test(c)) return null;
    else { word += c; has = true; }
  }
  end();
  return out.every((w) => w.length) ? out : null;
}

// a script in the repo: a relative path (boot.ts from an app is ../../scripts/boot.ts), no ".." past its leading ones
const SCRIPT = /^(\.\.\/)*(\.\/)?[\w-]+(\/[\w.-]+)*\.[cm]?[jt]s$/;
const script = (p: string) => SCRIPT.test(p) && !p.replace(/^(\.\.\/)+/, "").split("/").includes("..");
const RUN_SCRIPT = /^(test|typecheck|build|lint|docs|site|check)(:[\w-]+)?$/;
const one = (w: string[]): boolean => {
  const [a, b = "", c = ""] = w;
  if (a === "bun") {
    if (b === "test") return true;
    if (b === "run") return RUN_SCRIPT.test(c);
    if (b === "install") return w.includes("--frozen-lockfile");
    return script(b);
  }
  if (a === "bunx") return (b === "vite" && c === "build") || (b === "rustybuns" && /^(boundary|build)$/.test(c));
  if (a === "vite") return b === "build";
  if (a === "cargo") return /^(build|test|check)$/.test(b);
  if (a === "git") return (b === "checkout" && c === "-q") || b === "update-ref" || (b === "clean" && c === "-fdq");
  return false;
};
/** True for a command the builder runs every day: a suite, a build, typecheck's steps, a slot's setup. */
export const expected = (cmd: string): boolean => { const cs = commands(cmd.trim()); return !!cs && cs.every(one); };

export type Kind = { kind: "job"; slot: string; dir: string; cmd: string; ok: boolean } | { kind: "house" } | { kind: "unexpected"; cmd: string };
const lit = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const JOB = new RegExp(String.raw`^L="\$PWD/runs/(slot-[\w-]+)\.log"; ${lit(GATE)}\{ cd '(slot-[\w-]+)(?:\/([^']*))?' && ([\s\S]*?); echo \$\? > "\$L\.\$\$"; \} 2>&1 \| tee -a "\$L"; c=\$\(cat "\$L\.\$\$"\); rm -f "\$L\.\$\$"; ${lit(CUT_CHECK)}exit "\$\{c:-1\}"$`);
const HOUSE = [
  /^mkdir -p locks runs\/done /, // claim
  /(^printf '%s' |^rm -f runs\/'slot-[\w-]+'\.json ).*rmdir locks\/'slot-[\w-]+'$/, // release
  /^\[ -d locks\/'slot-[\w-]+' \] && touch locks\/'slot-[\w-]+'$/, // heartbeat
  /^\[ -n "\$\(find serving -mmin -2 2>\/dev\/null\)" \]$/, // reachable
  /^cat nightly\/results\.json$/,
];
/** What one of remote-ci's ssh shells is: a slot's job (and whether its command is expected), housekeeping, or neither. */
export function classify(script: string): Kind {
  const at = script.indexOf(REMOTE_PATH);
  const body = (at < 0 ? script : script.slice(at + REMOTE_PATH.length)).replace(/^; cd '[^']*' && /, "");
  const job = body.match(JOB);
  if (job && job[1] === job[2]) return { kind: "job", slot: job[2]!, dir: job[3] ?? ".", cmd: job[4]!, ok: expected(job[4]!) };
  return HOUSE.some((re) => re.test(body)) ? { kind: "house" } : { kind: "unexpected", cmd: body };
}

// ---- the view: one per gather, what the board and the event log both read ----

export type SlotView = {
  name: string; sha: string; busy: boolean; run?: Live; stall?: string;
  jobs: { pid: number; secs: number; dir: string; cmd: string; ok: boolean }[];
};
/** The test swarm's queue (GET /queue), when SWARM_URL and SWARM_TOKEN are set; null when it didn't answer. */
export type SwarmQueue = QueueReply | null;
export type View = { shot: Shot; slots: SlotView[]; odd: { pid: number; secs: number; slot?: string; cmd: string; full: string }[]; swarm?: SwarmQueue };

/** Why a busy slot looks stuck: its lock's heartbeat older than STALE_MIN (what the next claim reaps), or no output for PUSH_MS. */
export function stalled(now: number, lockAt: number, logAt?: number): string | undefined {
  if (now - lockAt > STALE_MIN * 60_000) return `no heartbeat for ${took(now - lockAt)}`;
  if (logAt && now - logAt > PUSH_MS) return `no output for ${took(now - logAt)}`;
  return undefined;
}

export function view(shot: Shot): View {
  const odd: View["odd"] = [];
  const jobs = new Map<string, SlotView["jobs"]>();
  // a shell forks for its pipe, and the fork has the same command line: one row per script, the oldest
  const once = new Map<string, Proc>();
  for (const p of shot.procs) { const o = once.get(p.script); if (!o || p.secs > o.secs) once.set(p.script, p); }
  for (const p of once.values()) {
    const k = classify(p.script);
    if (k.kind === "job") {
      jobs.set(k.slot, [...(jobs.get(k.slot) ?? []), { pid: p.pid, secs: p.secs, dir: k.dir, cmd: k.cmd, ok: k.ok }]);
      if (!k.ok) odd.push({ pid: p.pid, secs: p.secs, slot: k.slot, cmd: k.cmd, full: p.script });
    } else if (k.kind === "unexpected") odd.push({ pid: p.pid, secs: p.secs, cmd: k.cmd, full: p.script });
  }
  const slots = shot.slots.map((s): SlotView => {
    const lock = shot.locks.find((l) => l.slot === s.name), run = shot.runs.find((r) => r.slot === s.name);
    return { ...s, busy: !!lock, run: lock ? run : undefined, jobs: jobs.get(s.name) ?? [],
      stall: lock ? stalled(shot.now, lock.at, run?.logAt) : undefined };
  });
  return { shot, slots, odd };
}

// ---- drawing ----

export type Look = { width: number; color: boolean; frame: number; title?: string };
const C = { pink: 212, purple: 141, gray: 245, dim: 240, green: 114, red: 203, yellow: 222, blue: 117, white: 255 } as const;
type Hue = keyof typeof C;
const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const vis = (s: string) => [...s.replace(ANSI, "")].length;
/** Cut an ANSI string to `n` visible characters. */
function clip(s: string, n: number): string {
  if (vis(s) <= n) return s;
  let out = "", seen = 0;
  for (const part of s.split(new RegExp(`(${CODE})`))) {
    if (part.startsWith("\x1b")) { out += part; continue; }
    const chars = [...part];
    const room = n - 1 - seen;
    if (chars.length > room) { out += chars.slice(0, Math.max(0, room)).join("") + "…"; seen = n; break; }
    out += part; seen += chars.length;
  }
  return out + (s.includes("\x1b") ? "\x1b[0m" : "");
}
const wrap = (s: string, n: number) => { const c = [...s], out: string[] = []; for (let i = 0; i < c.length; i += n) out.push(c.slice(i, i + n).join("")); return out.length ? out : [""]; };
const ago = (now: number, t: number) => `${took(now - t)} ago`;

/** The board for one view, as the lines of a frame. */
export function board(v: View, look: Look): string {
  const { shot } = v, W = Math.max(50, look.width), inner = W - 4;
  const paint = (h: Hue, s: string, bold = false) => (look.color ? `\x1b[${bold ? "1;" : ""}38;5;${C[h]}m${s}\x1b[0m` : s);
  const spin = SPIN[look.frame % SPIN.length]!;
  const box = (title: string, hue: Hue, lines: string[], right = "") => {
    const t = ` ${title} `, r = right ? ` ${right} ` : "";
    const fill = Math.max(0, W - 3 - vis(t) - vis(r));
    const out = [paint(hue, "╭─") + paint(hue, t, true) + paint(hue, "─".repeat(fill)) + r + paint(hue, "╮")];
    for (const l of lines.length ? lines : [paint("dim", "none")]) {
      const c = clip(l, inner);
      out.push(`${paint(hue, "│")} ${c}${" ".repeat(Math.max(0, inner - vis(c)))} ${paint(hue, "│")}`);
    }
    out.push(paint(hue, `╰${"─".repeat(W - 2)}╯`));
    return out;
  };

  const busy = v.slots.filter((s) => s.busy).length;
  const live = shot.serving && shot.now - shot.serving < 2 * 60_000;
  const p = plan("off", true, shot.batt, 4);
  const power = shot.batt.onPower ? paint("green", "on power") : paint(shot.batt.pct < 20 ? "red" : "yellow", `on battery ${shot.batt.pct}%`);
  const each = p.cap === 1 ? "one suite at a time per run" : `up to ${p.cap} suites at once per run`;
  const cap = p.where === "wait" ? paint("red", "runs wait until he is charged") : shot.batt.onPower ? each : paint("yellow", each);
  const clock = new Date(shot.now).toTimeString().slice(0, 8);
  const head = box(look.title ?? "builder", "pink", [
    `${paint("gray", "power ")} ${power} ${paint("dim", "·")} ${cap}`,
    `${paint("gray", "slots ")} ${busy} of ${v.slots.length} busy ${paint("dim", "·")} ${shot.waiting.length} waiting ${paint("dim", "·")} ${v.odd.length ? paint("red", `${v.odd.length} unexpected`, true) : "nothing unexpected"}`,
    ...(shot.error ? [paint("red", `can't read the builder: ${shot.error}`)] : []),
  ], live ? `${paint("pink", spin)} serving ${paint("dim", clock)}` : `${paint("red", "not serving")} ${paint("dim", clock)}`);

  const odd = v.odd.length ? box("UNEXPECTED", "red", v.odd.flatMap((o) => [
    paint("red", `pid ${o.pid} · ${took(o.secs * 1000)}${o.slot ? ` · ${o.slot}` : ""}`, true),
    ...wrap(o.cmd, inner).map((l) => paint("white", l)),
    // the whole command line, ssh shell and all, under it
    ...(o.full !== o.cmd ? wrap(o.full, inner).map((l) => paint("gray", l)) : []),
  ])) : [];

  const slots = box("slots", "purple", v.slots.flatMap((s, i) => {
    const sha = paint("dim", s.sha.slice(0, 8));
    if (!s.busy) return [`${paint("dim", "○")} ${s.name.padEnd(8)} ${paint("gray", "free")}  ${sha}`];
    const r = s.run, stall = s.stall;
    const mark = stall ? paint("red", "●") : paint("pink", spin);
    const out = [
      ...(i ? [""] : []),
      `${mark} ${paint("white", s.name.padEnd(8), true)} ${paint("blue", r?.who ?? "?")} ${sha} ${paint("gray", r ? took(shot.now - r.started) : "")}` +
        (stall ? `  ${paint("red", `STALLED ${stall}`, true)}` : ""),
      `  ${paint("gray", r?.cmd ?? "no run record")}`,
      ...s.jobs.map((j) => `  ${j.ok ? paint("purple", "$") : paint("red", "! UNEXPECTED", true)} ${j.cmd}  ${paint("dim", `${j.dir} · ${took(j.secs * 1000)}`)}`),
    ];
    if (r?.last) out.push(`  ${paint("dim", "›")} ${paint("gray", r.last)}`);
    return out;
  }));

  const waiting = box("waiting for a slot, longest first", "blue", shot.waiting.map((w, i) =>
    `${paint("dim", `${i + 1}.`)} ${paint("blue", w.who)} ${paint("gray", w.cmd)} ${paint("dim", `· asked ${ago(shot.now, w.started)}`)}`));

  const swarm = v.swarm === undefined ? [] : box("swarm", "yellow", v.swarm === null ? [paint("red", "the test swarm didn't answer")] : v.swarm.jobs.map((j, i) =>
    `${paint("dim", `${i + 1}.`)} ${j.state === "leased" ? `${paint("pink", spin)} ${paint("blue", j.runner)}` : paint("gray", "queued")} ${j.suite} ${paint("dim", j.sha.slice(0, 8))} ${paint("gray", j.branch)} ` +
      paint("dim", j.state === "leased" ? `· lease ends in ${took(Math.max(0, j.until - shot.now))}` : `· asked ${ago(shot.now, j.at)}${j.tries ? ` · try ${j.tries + 1}` : ""}`)));

  // the Blender queue (scripts/blender-queue.ts): who has his one Blender, then its jobs in line; shown when there are any
  const bl = shot.blender.length || shot.blenderHolder ? box("blender", "yellow", [
    ...(shot.blenderHolder ? [`${paint("pink", spin)} ${paint("gray", `has Blender: pid ${shot.blenderHolder}`)}`] : []),
    ...shot.blender.map((j) => `${j.state === "running" ? paint("pink", spin) : paint("dim", "○")} ${paint("blue", j.who)} ${paint("gray", j.cmd.join(" "))} ` +
      paint("dim", j.state === "running" && j.started ? `· ${took(shot.now - j.started)}` : `· asked ${ago(shot.now, j.added)}`)),
  ]) : [];

  const done = box("finished", "gray", shot.done.slice(0, 10).map((r) => {
    const end = r.ended ?? r.started, okay = r.code === 0;
    return `${okay ? paint("green", "✓ pass") : paint("red", `✗ fail${r.code === undefined ? "" : ` ${r.code}`}`)} ${paint("gray", took(end - r.started).padStart(7))} ${paint("blue", r.who)} ${r.cmd} ${paint("dim", `· ${ago(shot.now, end)}`)}`;
  }));

  return [...head, ...odd, ...slots, ...waiting, ...bl, ...swarm, ...done].join("\n");
}

/** One plain line per thing that changed between two views: a run started or finished, a slot stalled, an unexpected command. */
export function events(prev: View | undefined, next: View): string[] {
  const out: string[] = [];
  const runKey = (s: SlotView) => `${s.name}@${s.run?.started}`;
  const was = new Set(prev?.slots.filter((s) => s.busy && s.run).map(runKey));
  const stalledBefore = new Set(prev?.slots.filter((s) => s.stall).map(runKey));
  for (const s of next.slots) {
    if (s.busy && s.run && !was.has(runKey(s))) out.push(`start ${s.name} ${s.run.who} ${s.sha.slice(0, 8)}: ${s.run.cmd}`);
    if (s.stall && !stalledBefore.has(runKey(s))) out.push(`STALLED ${s.name} ${s.run?.who ?? "?"}: ${s.stall}`);
  }
  const doneKey = (r: RunRecord) => `${r.started}-${r.who}`;
  const seen = new Set(prev?.shot.done.map(doneKey));
  if (prev) for (const r of next.shot.done) if (!seen.has(doneKey(r))) {
    out.push(`finish ${r.code === 0 ? "pass" : `fail ${r.code ?? "?"}`} ${r.who} in ${took((r.ended ?? r.started) - r.started)}: ${r.cmd}`);
  }
  const odd = new Set(prev?.odd.map((o) => `${o.pid}:${o.cmd}`));
  for (const o of next.odd) if (!odd.has(`${o.pid}:${o.cmd}`)) out.push(`UNEXPECTED pid ${o.pid}${o.slot ? ` ${o.slot}` : ""}: ${o.full}`);
  return out;
}

const SWARM_EVERY = 15_000;

/** The test swarm's queue, read through its guard. Imported when asked: the swarm app's packages may not be installed. */
export async function swarmQueue(s: { url: string; token: string }): Promise<SwarmQueue> {
  const [{ getJson }, { QueueReply }] = await Promise.all([import("../packages/util/src/http.ts"), import("../apps/test-swarm/src/api.ts")]);
  return getJson(new URL("/queue", s.url).href, QueueReply, { headers: { authorization: `Bearer ${s.token}` }, signal: AbortSignal.timeout(5000) });
}

/** Gather, draw, repeat until `stop` aborts: a board redrawn in place on a terminal, else one line per event. */
export async function show(gather: () => Promise<string>, stop: AbortSignal, opts: { every: number; title: string; swarm?: () => Promise<SwarmQueue> }) {
  const tty = !!process.stdout.isTTY;
  const color = tty && !process.env.NO_COLOR;
  let prev: View | undefined, frame = 0;
  // The swarm is a paid Worker: asked once every SWARM_EVERY, not every frame.
  let swarm: SwarmQueue | undefined, swarmAt = 0;
  if (tty) process.stdout.write("\x1b[?1049h\x1b[?25l");
  try {
    while (!stop.aborted) {
      const text = await gather().catch((e: unknown) => `@error ${e instanceof Error ? e.message : String(e)}`);
      const v = view(parseShot(text));
      if (!v.shot.now) v.shot.now = Date.now();
      if (opts.swarm && Date.now() - swarmAt >= SWARM_EVERY) { swarmAt = Date.now(); swarm = await opts.swarm().catch(() => null); }
      v.swarm = swarm;
      if (tty) {
        const frameText = board(v, { width: Math.min(120, process.stdout.columns ?? 100), color, frame: frame++, title: opts.title });
        process.stdout.write(`\x1b[H${frameText.split("\n").join("\x1b[K\n")}\x1b[K\n\x1b[J`);
      } else {
        for (const e of events(prev, v)) console.log(`${new Date(v.shot.now).toISOString()} ${e}`);
      }
      prev = v;
      await new Promise<void>((done) => { const t = setTimeout(done, opts.every); stop.addEventListener("abort", () => { clearTimeout(t); done(); }, { once: true }); });
    }
  } finally {
    if (tty) process.stdout.write("\x1b[?25h\x1b[?1049l");
  }
}
