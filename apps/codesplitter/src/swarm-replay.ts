// The swarm week replayed (notes/FAKE_SWARM_REPLAY.md): a week of this repo's real PRs, each a made-up agent at a desk,
// and what each open PR was waiting on at any minute. The week comes from `scripts/swarm-week.ts` (src/swarm-week.json);
// `band` says where one PR stands, `timeline` stacks them per hour into the backlog chart, `Playhead` moves through the
// week. No DOM and no imports, so tests read it; the build ships it to swarm-watch.html as swarm-replay.js.

/** One PR of the week. Times are minutes from the week's start. */
export interface WeekRow {
  n: number;
  t: string;
  /** Opened. */
  a: number;
  /** Merged or closed; null while still open. */
  z: number | null;
  /** Merged (not just closed). */
  m: boolean;
  /** Its last commit: working before it, ready after it. */
  w: number;
  /** Spans it sat conflicted with main (git-blocked). */
  g: [number, number][];
  /** Spans a check sat red on its branch (test-blocked). */
  r: [number, number][];
  /** The shared files it touched, as indexes into `Week.hot`. */
  h?: number[];
}
export interface Mark { who: "Mervin" | "Ester"; at: number }
/** `hot`: the files many PRs of the week touched, the ones a crowd piles into. */
export interface Week { repo: string; start: number; minutes: number; marks: Mark[]; hot: string[]; rows: WeekRow[] }

/** What a PR is waiting on. Only the middle four are open; git wins over test when both hold it. */
export type Band = "unborn" | "working" | "git" | "test" | "ready" | "merged" | "closed";
export const OPEN: Band[] = ["working", "git", "test", "ready"];

const inside = (spans: [number, number][], t: number) => spans.some(([a, b]) => t >= a && t < b);

export function band(r: WeekRow, t: number): Band {
  if (t < r.a) return "unborn";
  if (r.z !== null && t >= r.z) return r.m ? "merged" : "closed";
  if (inside(r.g, t)) return "git";
  if (inside(r.r, t)) return "test";
  return t < r.w ? "working" : "ready";
}

export type Counts = Record<Band, number>;
export function counts(week: Week, t: number): Counts {
  const c = { unborn: 0, working: 0, git: 0, test: 0, ready: 0, merged: 0, closed: 0 };
  for (const r of week.rows) c[band(r, t)]++;
  return c;
}

/** The backlog per `step` minutes: how many PRs were open, split by band. */
export function timeline(week: Week, step = 60) {
  const out: ({ t: number } & Counts)[] = [];
  for (let t = 0; t <= week.minutes; t += step) out.push({ t, ...counts(week, t) });
  return out;
}

/** The widest the git and test bands got each day (the week starts at midnight Pacific), and the ship marks that fell in it.
 * Peaks, not averages: after Mervin's mark the git average reads higher than before it, because the cascade's tail sits there. */
export function nightPeaks(week: Week, step = 10) {
  const tl = timeline(week, step), DAY = 1440, out: { day: number; open: number; git: number; test: number; marks: Mark["who"][] }[] = [];
  for (let d = 0; d * DAY < week.minutes; d++) {
    const s = tl.filter((x) => x.t >= d * DAY && x.t < (d + 1) * DAY);
    out.push({ day: d, open: Math.max(...s.map((x) => OPEN.reduce((n, b) => n + x[b], 0))), git: Math.max(...s.map((x) => x.git)), test: Math.max(...s.map((x) => x.test)), marks: week.marks.filter((m) => m.at >= d * DAY && m.at < (d + 1) * DAY).map((m) => m.who) });
  }
  return out;
}

/** The minute the git band was widest: where the stuck agents pile up. */
export function gitPeak(week: Week, step = 60) {
  return timeline(week, step).reduce((best, x) => (x.git > best.git ? x : best), { t: 0, git: -1 } as { t: number; git: number }).t;
}

/** The shared file most conflicted PRs sit in at `t` (the README on a tie), and every open PR's line in it, conflicted first. */
export function pile(week: Week, t: number) {
  const open = week.rows.filter((r) => r.h && OPEN.includes(band(r, t)));
  const score = (i: number) => open.reduce((s, r) => s + (r.h!.includes(i) ? (band(r, t) === "git" ? 1000 : 1) : 0), 0);
  const readme = week.hot.indexOf("README.md");
  let best = readme;
  week.hot.forEach((_, i) => { if (best < 0 || score(i) > score(best)) best = i; });
  const lines = open.filter((r) => r.h!.includes(best)).map((r) => ({ n: r.n, title: r.t, conflicted: band(r, t) === "git", agent: agentName(r.n) }))
    .sort((a, b) => Number(b.conflicted) - Number(a.conflicted) || a.n - b.n);
  return { file: week.hot[best] ?? "README.md", lines };
}

/** Each moment a PR changes band, in order: the dots' keyframes. */
export function changes(r: WeekRow, minutes: number) {
  const cuts = [...new Set([0, r.a, r.w, r.z ?? 0, ...r.g.flat(), ...r.r.flat()])].filter((t) => t >= 0 && t <= minutes).sort((a, b) => a - b);
  const out: [number, Band][] = [];
  for (const t of cuts) { const b = band(r, t); if (out.at(-1)?.[1] !== b) out.push([t, b]); }
  return out;
}

const FIRST = ["Ada", "Bo", "Cy", "Dot", "Eli", "Fen", "Gus", "Hal", "Ivy", "Jo", "Kit", "Lou", "Mo", "Ned", "Oz", "Pip", "Quin", "Rae", "Sol", "Tam", "Uma", "Vic", "Wren", "Xan", "Yuri", "Zed"];
const LAST = ["Birch", "Cobble", "Dune", "Ember", "Fjord", "Grove", "Heath", "Inlet", "Juniper", "Knoll", "Lark", "Moss", "Nook", "Orchard", "Pike", "Quarry", "Reed", "Sage", "Thorn", "Vale"];
/** A made-up agent for a PR: the same name every time, nobody real. */
export const agentName = (n: number) => `${FIRST[n % FIRST.length]} ${LAST[Math.floor(n / FIRST.length) % LAST.length]}`;

export type Mode = "stopped" | "playing" | "paused" | "done";
export const SPEEDS = [1, 2, 4, 8, 16, 32, 64];
/** Week minutes per real second at 1x: the week plays in about 19 minutes at 1x and 18 seconds at 64x. */
export const RATE = 10;

/** The playhead. The page calls `tick` with the real time since the last frame, and can drag it with `seek`. */
export class Playhead {
  mode: Mode = "stopped";
  speed = 1;
  t = 0;
  constructor(public minutes: number) {}
  play() { if (this.mode === "done") this.t = 0; this.mode = "playing"; }
  pause() { if (this.mode === "playing") this.mode = "paused"; }
  stop() { this.mode = "stopped"; this.t = 0; }
  setSpeed(x: number) { if (x > 0 && Number.isFinite(x)) this.speed = x; }
  seek(t: number) { this.t = Math.max(0, Math.min(this.minutes, t)); if (this.mode === "done" && this.t < this.minutes) this.mode = "paused"; }
  /** Move `dt` real milliseconds on; returns the week minutes covered. */
  tick(dt: number) {
    if (this.mode !== "playing") return 0;
    const from = this.t;
    this.t = Math.min(this.minutes, this.t + (dt / 1000) * RATE * this.speed);
    if (this.t >= this.minutes) this.mode = "done";
    return this.t - from;
  }
}

/** A week file, or why it isn't one. */
export function readWeek(x: unknown): Week | string {
  const w = x as Partial<Week> | null;
  if (!w || typeof w !== "object" || !Array.isArray(w.rows) || typeof w.minutes !== "number" || typeof w.start !== "number") return "a week is the JSON scripts/swarm-week.ts writes";
  return { repo: "", marks: [], hot: [], ...w } as Week;
}
