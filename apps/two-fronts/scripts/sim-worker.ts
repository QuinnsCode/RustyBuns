// One thread of the mass simulator (sim.ts): plays the jobs it is handed and posts back the results.
import { isMainThread } from "bun";
import { bot, specFor } from "./balance.ts";
import { startBattle, step, timeLimit } from "../src/battle/sim.ts";
import type { Faction, SectorKind, Side } from "../src/battle/contract.ts";

export interface Job { i: number; sector: SectorKind; seed: number; attacker: Faction; hero: Side | null; handicap: number; record: boolean }
export const GRID = 24, BINS = 30, BIN_S = 10; // heat: GRID x GRID cells over the field, one layer per 10 s
export interface Result {
  job: Job; winner: Side; time: number; tickets: Record<Side, number>; posts: number;
  heat: number[][]; // [side*BINS + bin][cell] counts of unit-seconds
  frames?: { t: number; tk: [number, number]; posts: (Side | null)[]; u: [number, number, number, number][] }[]; // u: x, z, side 0/1, kind 0 trooper 1 vehicle 2 hero
  half: number; postsAt: { x: number; z: number; name: string }[];
}

function play(job: Job): Result {
  const spec = specFor(job.sector, job.seed, job.attacker, job.hero, job.handicap);
  const b = startBattle(spec), human = job.hero !== null;
  const heat = Array.from({ length: 2 * BINS }, () => new Array<number>(GRID * GRID).fill(0));
  const frames: NonNullable<Result["frames"]> = [];
  const held = new Set<number>();
  let n = 0;
  while (!b.over && b.time < timeLimit(spec)) {
    step(b, human ? bot(b) : null);
    b.posts.forEach((p, i) => { if (p.owner === "attacker") held.add(i); });
    if (++n % 30) continue;
    const bin = Math.min(BINS - 1, Math.floor(b.time / BIN_S));
    for (const u of b.units) {
      if (u.kind === "turret") continue;
      const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((u.x + b.half) / (2 * b.half)) * GRID)));
      const gz = Math.min(GRID - 1, Math.max(0, Math.floor(((u.z + b.half) / (2 * b.half)) * GRID)));
      heat[(u.side === "attacker" ? 0 : BINS) + bin]![gz * GRID + gx]!++;
    }
    if (job.record && n % 90 === 0) frames.push({
      t: Math.round(b.time), tk: [Math.round(b.tickets.attacker), Math.round(b.tickets.defender)], posts: b.posts.map((p) => p.owner),
      u: b.units.filter((u) => u.kind !== "turret").map((u) => [Math.round(u.x), Math.round(u.z), u.side === "attacker" ? 0 : 1, u.id === b.hero.id ? 2 : u.kind === "tank" || u.kind === "walker" || u.kind === "speeder" || u.kind === "gunship" ? 1 : 0]),
    });
  }
  const winner: Side = b.over?.winner ?? (b.tickets.attacker > b.tickets.defender ? "attacker" : "defender");
  return { job, winner, time: Math.round(b.time), tickets: { attacker: Math.round(b.tickets.attacker), defender: Math.round(b.tickets.defender) }, posts: held.size, heat, ...(job.record && { frames }), half: b.half, postsAt: b.posts.map((p) => ({ x: p.x, z: p.z, name: p.name })) };
}

declare const self: Worker;
if (!isMainThread) {
  self.onmessage = (e: MessageEvent<Job[]>) => {
    for (const job of e.data) self.postMessage(play(job));
    self.postMessage("done");
  };
}
