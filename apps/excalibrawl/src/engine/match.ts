// A fight, one turn at a time. Each turn every fighter looks at its own canvas, Clef
// decides, and the decision becomes ops. The Durable Object calls playTurn on an alarm
// and saves the state between turns, so a fight survives an eviction and paces itself.
// The log is the replay: every op with the decision that made it.

import { clefRequest, decide, toOps, type Decision } from "./brain.ts";
import { DEFAULT_LIMITS, applyOps, regionFor } from "./ops.ts";
import { snapshot } from "./raster.ts";
import type { Bounds, Op, SkeletonEl } from "./types.ts";

export const CANVAS: Bounds = { x: 0, y: 0, w: 700, h: 700 };

export const MODELS = {
  clef: { id: "@cf/cloudflare/clef", label: "Clef" },
  "clef-flash": { id: "@cf/cloudflare/clef-flash", label: "Clef Flash" },
} as const;
export type FighterModel = keyof typeof MODELS;

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
  temperature?: number;
  rand?: () => number;
}

/** Play the next turn for every fighter at once. Mutates `m`, returns the turn's log entries. */
export async function playTurn(m: MatchState, deps: TurnDeps): Promise<LogEntry[]> {
  const turn = m.turn + 1;
  const entries = await Promise.all(
    m.fighters.map(async (f, side): Promise<LogEntry> => {
      const region = regionOf(m, side);
      const scene = m.scenes[side]!;
      try {
        if (!(await deps.take())) return { side, turn, ops: [], error: "daily budget spent" };
        const input = { prompt: m.prompt, turn, turns: m.turns, scene, region, image: await snapshot(scene, region), persona: f.persona };
        const res = await deps.run(MODELS[f.model].id, clefRequest(f.model, input));
        const decision = decide(res, input, deps.temperature, deps.rand);
        const ops = toOps(decision, scene, region, () => `${side}-${m.nextId[side]!++}`);
        // Starting over deletes everything at once, past the usual per-turn cap.
        const limits = { ...DEFAULT_LIMITS, maxOpsPerTurn: Math.max(DEFAULT_LIMITS.maxOpsPerTurn, ops.length) };
        const { scene: next, applied } = applyOps(new Map(scene.map((e) => [e.id, e])), ops, region, limits);
        m.scenes[side] = [...next.values()];
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

export const finished = (m: MatchState) => m.turn >= m.turns;

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
