// Watch Mervin work (mervin-watch.html, #1516): a merge round replayed as a stream of events. The round is a record
// from `scripts/mervin-merge.ts` (`.mervin/rounds/*.json`: the board's stages and Mervin's verdicts). `events` turns
// it into one ordered stream, `Player` plays it with play, pause, stop, step and a speed, and `view` folds the
// events played so far into what the page draws. Add, build and deploy steps can feed the same stream and player
// later. No DOM and no imports, so tests read it; the build ships it to the page as mervin-replay.js.
//
// Pausing here holds the replay and touches nothing else. For a real run, pausing means holding `gh pr merge --auto`
// for the next wave (a live feed, not built yet).

export type Tier = "certain" | "agree" | "mervin" | "differ" | "card";
export const TIERS: Tier[] = ["certain", "agree", "mervin", "differ", "card"];

/** The parts of a recorded round the replay reads. */
export interface Round {
  main?: string;
  board: { stages: { pr: number; title?: string; stackedOn?: number; files: { path: string; tier: Tier; why?: string }[] }[] };
  verdicts: { pr: number; title?: string; go: boolean; wave?: number; why: string }[];
}

export type Ev =
  | { kind: "round"; prs: number[] }
  | { kind: "wave"; wave: number }
  | { kind: "hold"; pr: number; why: string }
  | { kind: "start"; pr: number }
  | { kind: "file"; pr: number; path: string; tier: Tier; why: string }
  | { kind: "card"; pr: number; path: string }
  | { kind: "merged"; pr: number };
/** An event and how long it takes at 1x, in milliseconds. */
export type Step = Ev & { ms: number };

const COST = { round: 500, wave: 900, hold: 500, start: 300, file: 450, card: 1400, merged: 700 };

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
        if (f.tier === "card") out.push(at({ kind: "card", pr: v.pr, path: f.path }));
      }
      out.push(at({ kind: "merged", pr: v.pr }));
    }
  }
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
  constructor(public steps: Step[]) {}

  play() { if (this.mode === "done") this.stop(); if (this.steps.length) this.mode = "playing"; }
  pause() { if (this.mode === "playing") this.mode = "paused"; }
  /** Back to the start, nothing played. */
  stop() { this.mode = "stopped"; this.at = 0; this.clock = 0; this.into = 0; }
  setSpeed(x: number) { if (x > 0 && Number.isFinite(x)) this.speed = x; }
  /** Play the next event now, then hold. */
  step(): Step | null {
    if (this.mode === "playing") this.mode = "paused";
    if (this.mode === "stopped") this.mode = "paused";
    const s = this.steps[this.at];
    if (!s) { this.mode = "done"; return null; }
    this.clock += s.ms - this.into; this.into = 0; this.at++;
    if (this.at >= this.steps.length) this.mode = "done";
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
    if (next) { this.into += left; this.clock += left; } else this.mode = "done";
    return played;
  }
  get total() { return this.steps.reduce((n, s) => n + s.ms, 0); }
}

export type PrState = "queued" | "held" | "merging" | "merged";
export interface PrView { pr: number; title: string; state: PrState; wave?: number; why?: string; files: { path: string; tier: Tier; why: string }[]; cards: string[] }
export interface View { wave: number; prs: PrView[]; tiers: Record<Tier, number>; log: string[] }

/** What the page draws once `played` events have happened. */
export function view(round: Round, played: Step[]): View {
  const titles = new Map<number, string>();
  for (const s of round.board.stages) if (s.title) titles.set(s.pr, s.title);
  for (const v of round.verdicts) if (v.title) titles.set(v.pr, v.title);
  const waveOf = new Map(round.verdicts.map((v) => [v.pr, v.wave]));
  const prs = new Map(round.verdicts.map((v): [number, PrView] => [v.pr, { pr: v.pr, title: titles.get(v.pr) ?? "", state: "queued", wave: waveOf.get(v.pr), files: [], cards: [] }]));
  const tiers = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  const log: string[] = [];
  let wave = 0;
  for (const e of played) {
    const p = "pr" in e ? prs.get(e.pr) : undefined;
    if (e.kind === "wave") { wave = e.wave; log.push(`wave ${e.wave}`); }
    else if (e.kind === "hold" && p) { p.state = "held"; p.why = e.why; log.push(`#${e.pr} held: ${e.why}`); }
    else if (e.kind === "start" && p) { p.state = "merging"; log.push(`#${e.pr} merging`); }
    else if (e.kind === "file" && p) { p.files.push({ path: e.path, tier: e.tier, why: e.why }); tiers[e.tier]++; log.push(`#${e.pr} ${e.tier} ${e.path}`); }
    else if (e.kind === "card" && p) { p.cards.push(e.path); log.push(`#${e.pr} Mervin asks about ${e.path}`); }
    else if (e.kind === "merged" && p) { p.state = "merged"; log.push(`#${e.pr} merged`); }
  }
  return { wave, prs: [...prs.values()], tiers, log };
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
