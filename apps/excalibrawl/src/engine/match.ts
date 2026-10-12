// A fight, one turn at a time. Each turn every fighter looks at its own canvas, Clef
// decides, and the decision becomes ops. The Durable Object calls playTurn on an alarm
// and saves the state between turns, so a fight survives an eviction and paces itself.
// The log is the replay: every op with the decision that made it. A pen fighter (a text model
// writing pen lines, src/engine/pen-fighter.ts) plays every PEN_EVERY turns, since one pen turn is up
// to 8 lines. At the end Clef referees: judgeMatch scores each side and names the winner.

import { clefRequest, decide, toOps, type Decision } from "./brain.ts";
import { judge, winnerOf, type Score } from "./judge.ts";
import { DEFAULT_LIMITS, applyOps, regionFor } from "./ops.ts";
import { penOpen, penStep, type PenFighter, type PenMessage } from "./pen-fighter.ts";
import type { PlanStep } from "./plan.ts";
import { snapshot } from "./raster.ts";
import type { Bounds, Op, SkeletonEl } from "./types.ts";

export const CANVAS: Bounds = { x: 0, y: 0, w: 700, h: 700 };

export interface ModelInfo {
  id: string;
  label: string;
  /** A pen fighter: whether it can ask to see its canvas, and its reply budget (a reasoning model needs room to think). */
  pen?: Omit<PenFighter, "model">;
}

export const MODELS = {
  clef: { id: "@cf/cloudflare/clef", label: "Clef" },
  "clef-flash": { id: "@cf/cloudflare/clef-flash", label: "Clef Flash" },
  "gpt-oss-20b": { id: "@cf/openai/gpt-oss-20b", label: "GPT-OSS 20B", pen: { canLook: false, maxTokens: 3000 } },
  scout: { id: "@cf/meta/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout", pen: { canLook: true, maxTokens: 800 } },
} satisfies Record<string, ModelInfo>;
export type FighterModel = keyof typeof MODELS;

/** A pen fighter's settings, or undefined for a Clef. */
export const penOf = (model: FighterModel): PenFighter | undefined => {
  const m: ModelInfo = MODELS[model];
  return m.pen && { model: m.id, ...m.pen };
};

/** A pen fighter plays on turns 1, 1 + PEN_EVERY, …: a few arena turns' time for its up to 8 lines. */
export const PEN_EVERY = 3;
export const penTurns = (turns: number) => Math.ceil(turns / PEN_EVERY);

export interface Fighter {
  model: FighterModel;
  name: string;
  persona?: string;
}

export interface LogEntry {
  side: number;
  turn: number;
  ops: Op[];
  decision?: Decision;
  /** A pen turn: lines that drew, lines skipped, and whether it asked to look or said it's done. */
  pen?: { lines: number; skipped: number; look?: boolean; done?: boolean };
  error?: string;
}

export interface MatchState {
  id: string;
  prompt: string;
  fighters: Fighter[];
  turns: number;
  /** Turns played so far. */
  turn: number;
  startedAt: number;
  endedAt?: number;
  scenes: SkeletonEl[][];
  /** The next new-shape number, per fighter. */
  nextId: number[];
  /** Each fighter's plan from the planner (empty if it failed), and how many of its steps are drawn. */
  plans?: PlanStep[][];
  done?: number[];
  /** Each pen fighter's conversation so far (null for a Clef), and whether it said `done`. Never sent or archived. */
  talks?: (PenMessage[] | null)[];
  penDone?: boolean[];
  /** Clef's scores at the end, per side (null if it couldn't judge that side), and the winner (-1: a tie). */
  scores?: (Score | null)[];
  winner?: number;
  log: LogEntry[];
}

export function newMatch(id: string, prompt: string, fighters: Fighter[], turns: number, now: number): MatchState {
  return { id, prompt, fighters, turns, turn: 0, startedAt: now, scenes: fighters.map(() => []), nextId: fighters.map(() => 1), log: [] };
}

export const regionOf = (m: Pick<MatchState, "fighters">, side: number) => regionFor(side, m.fighters.length, CANVAS);

export interface TurnDeps {
  /** One Clef call: Workers AI's env.AI.run, or a fake in tests. */
  run: (model: string, input: unknown) => Promise<unknown>;
  /** Whether today's budget has room for one more call. */
  take: () => Promise<boolean>;
  /** The planner: a fighter's parts list for the prompt, once at the start. Without it, Clef plays unplanned. */
  plan?: (prompt: string, persona?: string) => Promise<PlanStep[]>;
  temperature?: number;
  rand?: () => number;
}

/** Play the next turn for every fighter at once. Mutates `m`, returns the turn's log entries. */
export async function playTurn(m: MatchState, deps: TurnDeps): Promise<LogEntry[]> {
  const turn = m.turn + 1;
  // Only Clef fighters plan; a pen fighter lists its own parts as it draws.
  if (deps.plan && !m.plans && m.fighters.some((f) => !penOf(f.model))) {
    const plan = deps.plan;
    m.plans = await Promise.all(m.fighters.map(async (f) => (!penOf(f.model) && (await deps.take()) ? plan(m.prompt, f.persona).catch(() => []) : [])));
    m.done = m.fighters.map(() => 0);
  }
  // A pen fighter sits out the turns between its own, and every turn after it said `done`.
  const playing = m.fighters
    .map((f, side) => ({ f, side, pen: penOf(f.model) }))
    .filter(({ side, pen }) => !pen || ((turn - 1) % PEN_EVERY === 0 && !m.penDone?.[side]));
  const entries = await Promise.all(
    playing.map(async ({ f, side, pen }): Promise<LogEntry> => {
      const region = regionOf(m, side);
      const scene = m.scenes[side]!;
      try {
        if (!(await deps.take())) return { side, turn, ops: [], error: "daily budget spent" };
        if (pen) return await penPlay(m, deps.run, pen, side, turn);
        const model = f.model as "clef" | "clef-flash";
        const input = { prompt: m.prompt, turn, turns: m.turns, scene, region, image: await snapshot(scene, region), persona: f.persona, plan: m.plans?.[side], done: m.done?.[side] };
        const res = await deps.run(MODELS[model].id, clefRequest(model, input));
        const decision = decide(res, input, deps.temperature, deps.rand);
        const ops = toOps(decision, scene, region, () => `${side}-${m.nextId[side]!++}`);
        // Starting over deletes everything at once, past the usual per-turn cap.
        const limits = { ...DEFAULT_LIMITS, maxOpsPerTurn: Math.max(DEFAULT_LIMITS.maxOpsPerTurn, ops.length) };
        const { scene: next, applied } = applyOps(new Map(scene.map((e) => [e.id, e])), ops, region, limits);
        m.scenes[side] = [...next.values()];
        if (decision.action === "next" && m.done && applied.length) m.done[side]!++;
        // An update logs the clamped result, not what was asked for, so replays land where the fight did.
        const logged = applied.map((op): Op => (op.op === "update" ? { op: "update", id: op.id, patch: next.get(op.id)! } : op));
        return { side, turn, ops: logged, decision };
      } catch (e) {
        return { side, turn, ops: [], error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  m.turn = turn;
  m.log.push(...entries);
  return entries;
}

/** One pen turn for `side`: the next reply in its conversation, drawn on its canvas. */
async function penPlay(m: MatchState, run: TurnDeps["run"], pen: PenFighter, side: number, turn: number): Promise<LogEntry> {
  const region = regionOf(m, side);
  const talks = (m.talks ??= m.fighters.map(() => null));
  const talk = (talks[side] ??= penOpen(pen, m.prompt, region, penTurns(m.turns)));
  const prev = new Map(m.scenes[side]!.map((e) => [e.id, e]));
  const r = await penStep(run, pen, talk, prev, region, `${side}-`, Math.floor((turn - 1) / PEN_EVERY) + 1, penTurns(m.turns));
  m.scenes[side] = [...r.scene.values()];
  if (r.done) (m.penDone ??= m.fighters.map(() => false))[side] = true;
  // Updates log where the shape ended up, as Clef's do, so replays land where the fight did.
  const ops = r.ops.map((op): Op => (op.op === "update" && r.scene.has(op.id) ? { op: "update", id: op.id, patch: r.scene.get(op.id)! } : op));
  return { side, turn, ops, pen: { lines: r.lines, skipped: r.skipped.length, ...(r.look && { look: true }), ...(r.done && { done: true }) } };
}

export const finished = (m: MatchState) => m.turn >= m.turns;

/** Clef referees a finished fight: one call per side, then the winner. Skipped once scored, so an alarm retry doesn't pay twice. */
export async function judgeMatch(m: MatchState, deps: Pick<TurnDeps, "run" | "take">): Promise<void> {
  if (m.scores) return;
  m.scores = await Promise.all(
    m.scenes.map(async (scene, side) => (scene.length && (await deps.take()) ? judge(deps.run, m.prompt, scene, regionOf(m, side)).catch(() => null) : null)),
  );
  m.winner = winnerOf(m.scores);
}

/** Rebuild every fighter's scene from a log, up to and including `upToTurn`. Replays use this. */
export function scenesAt(m: Pick<MatchState, "fighters" | "log">, upToTurn = Infinity): SkeletonEl[][] {
  const scenes = m.fighters.map(() => new Map<string, SkeletonEl>());
  for (const e of m.log) {
    if (e.turn > upToTurn) break;
    const s = scenes[e.side]!;
    for (const op of e.ops) {
      if (op.op === "add") s.set(op.element.id, op.element);
      else if (op.op === "delete") s.delete(op.id);
      else {
        const cur = s.get(op.id);
        if (cur) s.set(op.id, { ...cur, ...op.patch } as SkeletonEl);
      }
    }
  }
  return scenes.map((s) => [...s.values()]);
}
