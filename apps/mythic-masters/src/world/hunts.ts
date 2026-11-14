// Sighting boards: a cryptid contract pinned to a corkboard. Read the report and three signs appear on the ground
// one after another (prints, tufts, a broken fence), each leading to the next and the last to a lair, where one named
// creature waits: stronger than the wild ones, with a title of its own. Two per playable region.
// A contract is data: its board (a place in poi.ts, whose id is the contract's), a creature id, a level, three clue
// spots, a lair and a few lines. Its progress lives in the journey (`hunts`): 0 taken, 1-3 signs found, DONE closed.
// No three.js and no DOM: poi-view.ts draws the signs, view.ts puts the creature at its lair, the tests walk it.
import { mulberry32 } from "@rustybuns/util";
import type { Archetype } from "../creatures.ts";
import { creature } from "../roster.ts";
import { sections, type Journey } from "../journey.ts";
import { REGIONS } from "../regions.ts";
import { PACKS, type Pack } from "../packs.ts";
import { ALL, ISLE_N, isleLair, islePlaces, POIS, type Poi } from "./poi.ts";
import { dry, onIsland, ownerAt } from "./world.ts";
import { bandAt, WORLD } from "./trail.ts";

export const CLUES = 3;
export const DONE = CLUES + 1;   // the stage of a closed contract
export const CLUE_R = 10;        // walk this close to the next sign to read it
export const STEP = 220;         // metres from the board to the first sign, sign to sign, and the last sign to the lair
export const LEVEL_UP = 4;       // levels over its section's own

export interface Spot { x: number; z: number }
export interface Hunt {
  /** The board's place id. */
  id: string;
  n: number;
  /** The trail section (0-based) the board stands in. */
  k: number;
  /** The board itself. */
  board: Spot;
  creature: string;
  level: number;
  /** Who saw it and pinned the report up: "Trucker". They are in the town (src/world/towns.ts). */
  witness: string;
  /** What it is called by the people who saw it: "The Batsto Prowler". */
  title: string;
  /** The report on the board, "Who: what", played like a tape. */
  report: string[];
  clues: { at: Spot; sign: string }[];
  lair: Spot;
}

// What each kind of creature leaves behind, and what the papers call it.
const SIGNS: Record<Archetype, [string, string, string]> = {
  skirmisher: ["Prints in the mud, far apart, as if it never walked", "A tuft of coarse fur caught on a fence wire", "Claw marks high on a trunk, still sticky with sap"],
  flyer: ["A long feather, darker than any bird's", "Scorched bark where something perched", "Three-toed prints that stop in the middle of the clearing"],
  tank: ["A broken fence, the posts pushed flat", "Prints sunk deep, the size of a skillet", "A boulder rolled from its bed, the moss still wet"],
  bruiser: ["A sapling snapped at shoulder height", "Knuckle prints between the footprints", "A deer trail torn wide, the brush thrown aside"],
};
const NAMES: Record<Archetype, string> = { skirmisher: "Prowler", flyer: "Shrieker", tank: "Crusher", bruiser: "Brute" };
const WITNESSES = ["Ranger", "Diner cook", "Trucker", "Birdwatcher", "Deputy", "Farmhand"];

/** A spot about STEP metres on from `from`, heading roughly `ang`, on dry open ground of region n's trail. */
function stepFrom(from: Spot, ang: number, n: number, rnd: () => number): { at: Spot; ang: number } | null {
  for (let tries = 0; tries < 48; tries++) {
    const a = ang + (rnd() - 0.5) * (0.8 + tries * 0.12), d = STEP * (0.85 + rnd() * 0.3);
    const at = { x: Math.round((from.x + Math.cos(a) * d) * 10) / 10, z: Math.round((from.z + Math.sin(a) * d) * 10) / 10 };
    if (ownerAt(at.x, at.z) === n && dry(WORLD, at.x, at.z, 0.8) && bandAt(at.x, at.z) > 0) return { at, ang: a };
  }
  return null;
}

function hunt(p: Poi): Hunt | null {
  const g = REGIONS[p.n - 1]!, s = sections(g)[p.k]!, rnd = mulberry32(p.n * 4241 + p.k * 97 + 5);
  const id = s.wilds[Math.floor(rnd() * s.wilds.length)] ?? s.keeper, c = creature(id);
  const clues: Hunt["clues"] = [];
  let at: Spot = p, ang = rnd() * Math.PI * 2;
  for (let i = 0; i <= CLUES; i++) {
    const next = stepFrom(at, ang, p.n, rnd);
    if (!next) return null;
    at = next.at; ang = next.ang;
    if (i < CLUES) clues.push({ at, sign: SIGNS[c.archetype][i]! });
  }
  const title = `The ${s.name} ${NAMES[c.archetype]}`, who = WITNESSES[Math.floor(rnd() * WITNESSES.length)]!;
  return {
    id: p.id, n: p.n, k: p.k, board: { x: p.x, z: p.z }, creature: id, level: s.level + LEVEL_UP, witness: who, title, lair: at, clues,
    report: [
      `${who}: Something has been out by ${s.name}. Folks are calling it ${title.replace(/^The/, "the")}.`,
      `${who}: ${SIGNS[c.archetype][0]}. Then nothing. Then more of it, further on.`,
      "Gary: We follow the signs. Calmly. In the dark. With the camera on. What could go wrong.",
    ],
  };
}

/** Every contract, by its board's id; two per playable region. */
export const HUNTS = new Map<string, Hunt>(ALL.filter((p) => p.kind === "board").flatMap((p) => { const h = hunt(p); return h ? [[p.id, h] as const] : []; }));
export const huntsIn = (n: number): Hunt[] => (POIS.get(n) ?? []).flatMap((p) => HUNTS.get(p.id) ?? []);

/** A pack's island contract, from pack.json `board`: its signs lead from the board to the pack's lair (the cave mouth),
 *  where its lair foe waits. Kept out of HUNTS: those are the ones the rooms check (scripts/dens.ts) and whose boards
 *  stand in a town (towns.ts); the island's board stands at a fish shed and its fight is the lair's. */
function isleHunt(p: Pack): Hunt | null {
  const b = p.board, board = b && islePlaces(p).find((q) => q.kind === "board" && q.name === b.place), den = isleLair(p);
  if (!b || !board || !den) return null;
  return {
    id: board.id, n: ISLE_N, k: 0, board: { x: board.x, z: board.z }, creature: p.lair.foe, level: p.lair.level, witness: b.witness, title: b.title,
    report: b.report, clues: b.signs.map((s) => ({ at: onIsland(s.at), sign: s.sign })), lair: { x: den.x, z: den.z },
  };
}
const ISLE_HUNTS = new Map(PACKS.flatMap((p) => { const h = isleHunt(p); return h ? [[p.id, h] as const] : []; }));
/** Pack p's island contracts (one, or none when it has no board). */
export const isleHunts = (p: Pick<Pack, "id">): Hunt[] => { const h = ISLE_HUNTS.get(p.id); return h ? [h] : []; };
/** A contract by its board's id, the continent's or an island's. */
export const huntOf = (id: string): Hunt | undefined => HUNTS.get(id) ?? [...ISLE_HUNTS.values()].find((h) => h.id === id);

type Log = Pick<Journey, "hunts">;
/** A contract's stage in the journey: undefined untaken, 0 taken, 1 to CLUES signs read, DONE closed. */
export const stageOf = (j: Log | null, id: string): number | undefined => j?.hunts?.[id];

/** Takes the contract on board `id`. True the first time. */
export function take(j: Log, id: string): boolean {
  if (!huntOf(id) || stageOf(j, id) !== undefined) return false;
  j.hunts = { ...j.hunts, [id]: 0 };
  return true;
}

/** The next sign of each contract under way in region n (or `among` these, an island's), where it is and what it is. */
export function nextClues(j: Log | null, n: number, among: readonly Hunt[] = huntsIn(n)): { hunt: Hunt; i: number; at: Spot; sign: string }[] {
  return among.flatMap((h) => { const s = stageOf(j, h.id); return s !== undefined && s < CLUES ? [{ hunt: h, i: s, ...h.clues[s]! }] : []; });
}

/** Reads the next sign of any contract you stand at (in region `n`, by default the one under you, or `among` these). The ones read now come back. */
export function track(j: Log, me: Spot, n = ownerAt(me.x, me.z), among: readonly Hunt[] = huntsIn(n)): { hunt: Hunt; sign: string; last: boolean }[] {
  const out: { hunt: Hunt; sign: string; last: boolean }[] = [];
  for (const c of nextClues(j, n, among)) {
    if (Math.hypot(c.at.x - me.x, c.at.z - me.z) > CLUE_R) continue;
    j.hunts = { ...j.hunts, [c.hunt.id]: c.i + 1 };
    out.push({ hunt: c.hunt, sign: c.sign, last: c.i + 1 === CLUES });
  }
  return out;
}

/** The named creatures waiting at their lairs: every sign read, not yet beaten or bound. */
export const waiting = (j: Log | null, open: ReadonlySet<number>): Hunt[] => [...HUNTS.values()].filter((h) => open.has(h.n) && stageOf(j, h.id) === CLUES);

/** Closes a contract: its creature was beaten or bound. True the first time. */
export function close(j: Log, id: string): boolean {
  if (stageOf(j, id) !== CLUES) return false;
  j.hunts = { ...j.hunts, [id]: DONE };
  return true;
}
