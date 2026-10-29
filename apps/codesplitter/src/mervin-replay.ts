// Watch Mervin work (mervin-watch.html, #1516): a merge round replayed as a stream of events. The round is a record
// from `scripts/mervin-merge.ts` (`.mervin/rounds/*.json`: the board's stages and Mervin's verdicts). `events` turns
// it into one ordered stream, `Player` plays it with play, pause, stop, step and a speed, and `view` folds the
// events played so far into what the page draws. Files can carry their lines, which stream in and settle (the live
// diff), and add, build and deploy steps ride the same stream in lanes. A live player takes events as they arrive
// (`push`) and waits at the end instead of finishing. No DOM and no imports, so tests read it; the build ships it to
// the page as mervin-replay.js.
//
// Pausing a replay holds the replay and touches nothing else. Pausing a live feed is real: the page tells the feed
// (`PAUSE`, scripts/mervin-watch.ts), and `scripts/mervin-merge.ts --go` waits on it before the next `gh pr merge --auto`.

export type Tier = "certain" | "agree" | "mervin" | "differ" | "card";
export const TIERS: Tier[] = ["certain", "agree", "mervin", "differ", "card"];

/** The parts of a recorded round the replay reads. */
export interface Round {
  main?: string;
  board: { stages: { pr: number; title?: string; stackedOn?: number; files: { path: string; tier: Tier; why?: string; lines?: Line[] }[] }[] };
  /** Add, build and deploy steps of the round, in order. */
  lanes?: LaneStep[];
  verdicts: { pr: number; title?: string; go: boolean; wave?: number; why: string }[];
}

/** One line of a file's diff: which side wrote it ("both" is shared context). */
export interface Line { text: string; side: "pr" | "main" | "both" }
export type Lane = "add" | "build" | "deploy";
export const LANES: Lane[] = ["add", "build", "deploy"];
export type LaneState = "run" | "ok" | "fail";
export interface LaneStep { lane: Lane; name: string; state: LaneState; pr?: number }

export type Ev =
  | { kind: "round"; prs: number[] }
  | { kind: "wave"; wave: number }
  | { kind: "hold"; pr: number; why: string }
  | { kind: "start"; pr: number }
  | { kind: "file"; pr: number; path: string; tier: Tier; why: string }
  | { kind: "line"; pr: number; path: string; text: string; side: Line["side"] }
  | { kind: "settle"; pr: number; path: string }
  | { kind: "card"; pr: number; path: string }
  | { kind: "step"; lane: Lane; name: string; state: LaneState; pr?: number }
  | { kind: "pause"; paused: boolean }
  | { kind: "merged"; pr: number };
/** An event and how long it takes at 1x, in milliseconds. */
export type Step = Ev & { ms: number };

const COST = { round: 500, wave: 900, hold: 500, start: 300, file: 450, line: 120, settle: 500, card: 1400, step: 800, pause: 0, merged: 700 };

/** Cost of an event at 1x. */
export const costOf = (e: Ev) => COST[e.kind];

/** The round as an event stream: the held PRs first, then each wave, a PR at a time, a file at a time. */
export function events(round: Round): Step[] {
  const at = (e: Ev): Step => ({ ...e, ms: COST[e.kind] });
  const stage = new Map(round.board.stages.map((s) => [s.pr, s]));
  const out: Step[] = [at({ kind: "round", prs: round.verdicts.map((v) => v.pr) })];
  for (const v of round.verdicts) if (!v.go) out.push(at({ kind: "hold", pr: v.pr, why: v.why }));
  const go = round.verdicts.filter((v) => v.go);
  for (let w = 1; w <= Math.max(0, ...go.map((v) => v.wave ?? 1)); w++) {
    const now = go.filter((v) => (v.wave ?? 1) === w);
    if (!now.length) continue;
    out.push(at({ kind: "wave", wave: w }));
    for (const v of now) {
      out.push(at({ kind: "start", pr: v.pr }));
      for (const f of stage.get(v.pr)?.files ?? []) {
        out.push(at({ kind: "file", pr: v.pr, path: f.path, tier: f.tier, why: f.why ?? "" }));
        for (const l of f.lines ?? []) out.push(at({ kind: "line", pr: v.pr, path: f.path, text: l.text, side: l.side }));
        if (f.lines?.length) out.push(at({ kind: "settle", pr: v.pr, path: f.path }));
        if (f.tier === "card") out.push(at({ kind: "card", pr: v.pr, path: f.path }));
      }
      for (const l of round.lanes ?? []) if (l.pr === v.pr) out.push(at({ kind: "step", ...l }));
      out.push(at({ kind: "merged", pr: v.pr }));
    }
  }
  for (const l of round.lanes ?? []) if (l.pr === undefined) out.push(at({ kind: "step", ...l }));
  return out;
}

export type Mode = "stopped" | "playing" | "paused" | "done";
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];

/** Plays a stream. The page calls `tick` with the time since the last frame; tests call it with whatever they like. */
export class Player {
  mode: Mode = "stopped";
  speed = 1;
  /** How many events have played. */
  at = 0;
  /** Round time played, in milliseconds (at 1x). */
  clock = 0;
  private into = 0;
  /** A live player takes events as they come and waits at the end instead of finishing. */
  constructor(public steps: Step[], public live = false) {}

  /** Events that arrived from a live feed. */
  push(more: Step[]) { this.steps.push(...more); if (this.mode === "done") this.mode = "playing"; }

  play() { if (this.mode === "done") this.stop(); if (this.steps.length || this.live) this.mode = "playing"; }
  pause() { if (this.mode === "playing") this.mode = "paused"; }
  /** Back to the start, nothing played. */
  stop() { this.mode = "stopped"; this.at = 0; this.clock = 0; this.into = 0; }
  setSpeed(x: number) { if (x > 0 && Number.isFinite(x)) this.speed = x; }
  /** Play the next event now, then hold. */
  step(): Step | null {
    if (this.mode === "playing") this.mode = "paused";
    if (this.mode === "stopped") this.mode = "paused";
    const s = this.steps[this.at];
    if (!s) { if (!this.live) this.mode = "done"; return null; }
    this.clock += s.ms - this.into; this.into = 0; this.at++;
    if (this.at >= this.steps.length && !this.live) this.mode = "done";
    return s;
  }
  /** Move `dt` real milliseconds on; returns the events that played. */
  tick(dt: number): Step[] {
    const played: Step[] = [];
    if (this.mode !== "playing") return played;
    let left = dt * this.speed;
    for (let s = this.steps[this.at]; s && left >= s.ms - this.into; s = this.steps[this.at]) {
      left -= s.ms - this.into; this.clock += s.ms - this.into; this.into = 0; this.at++; played.push(s);
    }
    const next = this.steps[this.at];
    if (next) { this.into += left; this.clock += left; } else if (!this.live) this.mode = "done";
    return played;
  }
  get total() { return this.steps.reduce((n, s) => n + s.ms, 0); }
}

export type PrState = "queued" | "held" | "merging" | "merged";
export interface PrView { pr: number; title: string; state: PrState; wave?: number; why?: string; files: FileView[]; cards: string[] }
/** A file's diff so far: its lines, and whether the merge has settled them. */
export interface FileView { path: string; tier: Tier; why: string; lines: Line[]; settled: boolean }
export interface View { wave: number; prs: PrView[]; tiers: Record<Tier, number>; log: string[]; lanes: Record<Lane, { name: string; state: LaneState; pr?: number }[]>; paused: boolean }

/** What the page draws once `played` events have happened. */
export function view(round: Round, played: Step[]): View {
  const titles = new Map<number, string>();
  for (const s of round.board.stages) if (s.title) titles.set(s.pr, s.title);
  for (const v of round.verdicts) if (v.title) titles.set(v.pr, v.title);
  const waveOf = new Map(round.verdicts.map((v) => [v.pr, v.wave]));
  const prs = new Map(round.verdicts.map((v): [number, PrView] => [v.pr, { pr: v.pr, title: titles.get(v.pr) ?? "", state: "queued", wave: waveOf.get(v.pr), files: [], cards: [] }]));
  const tiers = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  const log: string[] = [];
  const lanes: View["lanes"] = { add: [], build: [], deploy: [] };
  let wave = 0, paused = false;
  for (const e of played) {
    // a live feed names PRs the round file never listed
    if ("pr" in e && e.pr !== undefined && !prs.has(e.pr)) prs.set(e.pr, { pr: e.pr, title: titles.get(e.pr) ?? "", state: "queued", wave: wave || undefined, files: [], cards: [] });
    const p = "pr" in e && e.pr !== undefined ? prs.get(e.pr) : undefined;
    if (e.kind === "wave") { wave = e.wave; log.push(`wave ${e.wave}`); }
    else if (e.kind === "hold" && p) { p.state = "held"; p.why = e.why; log.push(`#${e.pr} held: ${e.why}`); }
    else if (e.kind === "start" && p) { p.state = "merging"; log.push(`#${e.pr} merging`); }
    else if (e.kind === "file" && p) { p.files.push({ path: e.path, tier: e.tier, why: e.why, lines: [], settled: false }); tiers[e.tier]++; log.push(`#${e.pr} ${e.tier} ${e.path}`); }
    else if (e.kind === "line" && p) p.files.findLast((f) => f.path === e.path)?.lines.push({ text: e.text, side: e.side });
    else if (e.kind === "settle" && p) { const f = p.files.findLast((x) => x.path === e.path); if (f) f.settled = true; log.push(`#${e.pr} settled ${e.path}`); }
    else if (e.kind === "step") {
      const l = lanes[e.lane], i = l.findIndex((x) => x.name === e.name && x.pr === e.pr);
      if (i >= 0) l[i] = { name: e.name, state: e.state, pr: e.pr }; else l.push({ name: e.name, state: e.state, pr: e.pr });
      log.push(`${e.lane} ${e.name} ${e.state}`);
    }
    else if (e.kind === "pause") { paused = e.paused; log.push(e.paused ? "paused: the next merge is held" : "resumed"); }
    else if (e.kind === "card" && p) { p.cards.push(e.path); log.push(`#${e.pr} Mervin asks about ${e.path}`); }
    else if (e.kind === "merged" && p) { p.state = "merged"; log.push(`#${e.pr} merged`); }
  }
  return { wave, prs: [...prs.values()], tiers, log, lanes, paused };
}

/** A round file, or why it isn't one. */
export function readRound(x: unknown): Round | string {
  const r = x as Partial<Round> | null;
  if (!r || typeof r !== "object") return "a round is an object from .mervin/rounds";
  if (!Array.isArray(r.verdicts) || !r.board || !Array.isArray(r.board.stages)) return "a round needs board.stages and verdicts";
  return r as Round;
}

/** Clock text with a fixed width: 00:07.3 */
export function clockText(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 100)), m = Math.floor(t / 600), s = Math.floor((t % 600) / 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t % 10}`;
}

/** The pause file and feed file the live pieces share (scripts/mervin-merge.ts writes and waits, mervin-watch.ts serves). */
export const PAUSE = "pause";
export const FEED = "live.ndjson";

/** A repo's recorded rounds as the board's GET hands them back (#2625): hit rate, needless holds, CI time, wrong kinds. */
export interface Rounds {
  exact: number; of: number; rounds: number;
  tiers: { tier: string; exact: number; of: number }[];
  kinds: { kind: string; wrong: number }[];
  needless: number[];
  ci: { median: number; max: number; prs: number; last: Map<number, number> } | null;
}

/** The `rounds` of a board GET reply, or null when the repo records none (or the reply isn't one). */
export function readRounds(reply: unknown): Rounds | null {
  const r = reply && typeof reply === "object" ? (reply as { rounds?: unknown }).rounds : undefined;
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((e): e is Record<string, unknown> => !!e && typeof e === "object") : []);
  const tiers = o.tiers && typeof o.tiers === "object" ? Object.entries(o.tiers as Record<string, unknown>) : [];
  const ci = o.ci && typeof o.ci === "object" ? (o.ci as Record<string, unknown>) : null;
  return {
    exact: n(o.exact), of: n(o.of), rounds: n(o.rounds),
    tiers: tiers.flatMap(([tier, h]) => (h && typeof h === "object" ? [{ tier, exact: n((h as { exact?: unknown }).exact), of: n((h as { of?: unknown }).of) }] : [])),
    kinds: list(o.kinds).flatMap((k) => (typeof k.kind === "string" ? [{ kind: k.kind, wrong: n(k.wrong) }] : [])),
    needless: Array.isArray(o.needless) ? o.needless.filter((x): x is number => Number.isInteger(x)) : [],
    ci: ci && n(ci.prs) ? { median: n(ci.median), max: n(ci.max), prs: n(ci.prs), last: new Map(list(ci.last).flatMap((c) => (Number.isInteger(c.pr) ? [[c.pr as number, n(c.secs)] as [number, number]] : []))) } : null,
  };
}

/** CI time with a fixed width: 07:42, or 1h05 past the hour. */
export function ciText(secs: number): string {
  const s = Math.max(0, Math.round(secs)), m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
