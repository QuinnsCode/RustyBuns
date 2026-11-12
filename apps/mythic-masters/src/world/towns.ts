// Towns as pockets (docs/WORLD-EXPANSION.md, step 4; #3966). Each sighting board (hunts.ts) hangs in a town: on the
// open ground a gas station, a diner and a motel in a row with one door, and through it a pocket you walk around in
// rather than fight in. The diner is in the middle, the board on its back wall; the cook, the clerk, the night manager
// and whoever saw the thing are inside, each with a line for you.
// One layout for every town, in metres, the diner's front door at the origin, the street toward +z, the back wall at
// -DEEP. A town is the layout stood at its board's place and turned to face `yaw` (local +z is (sin yaw, cos yaw)).
// No three.js and no DOM: town-view.ts draws it, poi-view.ts the fronts, view.ts walks you in and out, the tests walk it.
import { sections } from "../journey.ts";
import { REGIONS } from "../regions.ts";
import { CLUES, HUNTS, type Hunt, type Spot } from "./hunts.ts";
import { poiById } from "./poi.ts";

export const DEEP = 9;       // front wall to back wall
export const CEILING = 3.2;
export const BODY = 0.4;     // how close you come to a wall, a counter or a person
export const TALK_R = 2.3;   // walk this close to someone and they say their line; this close to the board and you read it
export const OUT_Z = 0.8;    // past the doorstep by this much, you are back outside

/** An axis-aligned box on the floor (x0 < x1, z0 < z1). */
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface Room extends Rect { id: "gas" | "diner" | "motel"; name: string }
/** Something solid on the floor, `h` metres tall: a counter, a booth, a shelf, a desk. */
export interface Prop extends Rect { h: number; what: string }
export interface Person { id: string; who: string; at: Spot; room: Room["id"] }

export const ROOMS: Room[] = [
  { id: "gas", name: "The gas station", x0: -16, x1: -6, z0: -DEEP, z1: 0 },
  { id: "diner", name: "The diner", x0: -6, x1: 6, z0: -DEEP, z1: 0 },
  { id: "motel", name: "The motel office", x0: 6, x1: 16, z0: -DEEP, z1: 0 },
];
/** The way between two rooms, through the wall at x, from z0 to z1. */
export const DOORWAYS = [{ x: -6, z0: -6.2, z1: -4.2 }, { x: 6, z0: -6.2, z1: -4.2 }];
/** The front door, in the diner's front wall. */
export const FRONT = { x0: -0.9, x1: 0.9 };

export const PROPS: Prop[] = [
  { what: "counter", x0: -4, x1: 3, z0: -7.2, z1: -6.4, h: 1.05 },
  { what: "booth", x0: -5.8, x1: -3.6, z0: -2.8, z1: -0.8, h: 1.2 },
  { what: "booth", x0: 3.6, x1: 5.8, z0: -2.8, z1: -0.8, h: 1.2 },
  { what: "shelf", x0: -14.5, x1: -13.6, z0: -6.5, z1: -2, h: 1.6 },
  { what: "shelf", x0: -11.8, x1: -10.9, z0: -6.5, z1: -2, h: 1.6 },
  { what: "cooler", x0: -15.6, x1: -9, z0: -DEEP, z1: -8.3, h: 2.2 },
  { what: "till", x0: -9.4, x1: -7.2, z0: -2.4, z1: -1.6, h: 1.0 },
  { what: "desk", x0: 8, x1: 11.4, z0: -5.2, z1: -4.4, h: 1.1 },
  { what: "couch", x0: 12.4, x1: 15.4, z0: -1.4, z1: -0.5, h: 0.8 },
];
/** The sighting board on the diner's back wall, past the end of the counter, and where you stand to read it. */
export const BOARD = { x: 4.6, z: -DEEP, read: { x: 4.6, z: -7.9 } };
/** Where you stand when you walk in (and where an agent's `town(id)` puts you). */
export const DOORSTEP: Spot = { x: 0, z: -1 };

/** Who works where, and where the witness stands when they don't work here. */
const STAFF: Person[] = [
  { id: "cook", who: "Diner cook", at: { x: -0.5, z: -8.0 }, room: "diner" },
  { id: "clerk", who: "Clerk", at: { x: -8.3, z: -3.1 }, room: "gas" },
  { id: "manager", who: "Night manager", at: { x: 9.7, z: -5.9 }, room: "motel" },
];
const BY_BOARD = { x: 1.8, z: -5.9 }; // leaning on the counter

export interface Town {
  /** The board's place id, which is its contract's. */
  id: string;
  n: number;
  /** The trail section's name: the town is called after it. */
  name: string;
  /** The front door on the open ground (the board's place), and which way the street is. */
  door: Spot;
  yaw: number;
  hunt: Hunt;
  people: Person[];
}

/** A small number from a string: the same every time, different from one id to the next. */
const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
/** Which way a town faces: the same turn poi-view gives every place, from its id. */
export const yawOf = (id: string) => (hash(id) % 628) / 100;

function town(h: Hunt): Town | null {
  const p = poiById(h.id), g = REGIONS[h.n - 1];
  if (!p || !g) return null;
  // The witness is one of the staff when they work here (the cook), else they stand by the board, waiting to be asked.
  const staff = STAFF.find((s) => s.who === h.witness);
  const people = staff ? STAFF : [...STAFF, { id: "witness", who: h.witness, at: BY_BOARD, room: "diner" as const }];
  return { id: h.id, n: h.n, name: sections(g)[h.k]!.name, door: { x: p.x, z: p.z }, yaw: yawOf(p.id), hunt: h, people };
}

/** Every town, by its board's id: one per sighting board, two per playable region. */
export const TOWNS = new Map<string, Town>([...HUNTS.values()].flatMap((h) => { const t = town(h); return t ? [[h.id, t] as const] : []; }));

const LOT = 24; // metres round a town's middle kept clear of trees: its lot and the street in front
const MIDDLES = [...TOWNS.values()].map((t) => toWorld(t, { x: 0, z: -DEEP / 2 + 2 }));
/** Whether (x, z) on the open ground is on a town's lot, where nothing grows (view.ts's planting asks). */
export const onLot = (x: number, z: number) => MIDDLES.some((m) => Math.hypot(m.x - x, m.z - z) < LOT);

/** A spot in town `t` (local metres) on the open ground, and back. */
export function toWorld(t: Town, at: Spot): Spot {
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
  return { x: t.door.x + at.x * c + at.z * s, z: t.door.z - at.x * s + at.z * c };
}
export function toLocal(t: Town, at: Spot): Spot {
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw), dx = at.x - t.door.x, dz = at.z - t.door.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

const inRect = (r: Rect, x: number, z: number, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
/** The floor you can stand on: each room short of its walls, the doorways between them, and the front door out to the step. */
const FLOOR: Rect[] = [
  ...ROOMS.map((r) => ({ x0: r.x0 + BODY, x1: r.x1 - BODY, z0: r.z0 + BODY, z1: r.z1 - BODY })),
  ...DOORWAYS.map((d) => ({ x0: d.x - BODY - 0.3, x1: d.x + BODY + 0.3, z0: d.z0 + BODY, z1: d.z1 - BODY })),
  { x0: FRONT.x0 + BODY, x1: FRONT.x1 - BODY, z0: -BODY - 0.3, z1: OUT_Z + 1 },
];
/** Whether you can stand at (x, z) in town `t`: on the floor, clear of the furniture and the people. */
export function free(t: Town, x: number, z: number): boolean {
  return FLOOR.some((r) => inRect(r, x, z)) && !PROPS.some((p) => inRect(p, x, z, BODY)) && t.people.every((p) => Math.hypot(p.at.x - x, p.at.z - z) > BODY * 2);
}
/** A step by (dx, dz) from `at`: straight on if it is clear, else sliding along whatever is in the way, else not at all. */
export function step(t: Town, at: Spot, dx: number, dz: number): Spot {
  for (const [x, z] of [[at.x + dx, at.z + dz], [at.x + dx, at.z], [at.x, at.z + dz]] as const) if (free(t, x, z)) return { x, z };
  return at;
}
/** Out of the front door: past the step, you are back on the open ground. */
export const outside = (at: Spot) => at.z > OUT_Z;
/** The room you stand in. */
export const roomAt = (at: Spot): Room | undefined => ROOMS.find((r) => inRect(r, at.x, at.z));

/** What you stand beside: the board, or someone to talk to (the nearest, within TALK_R). */
export function beside(t: Town, at: Spot): { board: true } | { person: Person } | null {
  if (Math.hypot(BOARD.read.x - at.x, BOARD.read.z - at.z) < TALK_R) return { board: true };
  let best: Person | undefined, d = TALK_R;
  for (const p of t.people) { const e = Math.hypot(p.at.x - at.x, p.at.z - at.z); if (e < d) { best = p; d = e; } }
  return best ? { person: best } : null;
}

/** What someone says to you, by how far along the town's contract is (`stage` as hunts.ts keeps it). The witness only
 * ever talks about what they saw. The staff also pass on what they have heard: `rumours` are lines that open with who
 * says them ("Diner cook: ...", "Clerk: ...", "Night manager: ..."), and on every second visit (`visit` is how many
 * times you had walked into this town before this one, so 1, 3, 5...) a staff member with a rumour of their own says
 * it in place of their usual line. Which one comes from the town's and the person's ids: the same after a reload,
 * a different one in the next town. */
export function line(t: Town, p: Person, stage: number | undefined, rumours: readonly string[] = [], visit = 0): string {
  const h = t.hunt, title = h.title.replace(/^The/, "the");
  if (p.who === h.witness) {
    if (stage === undefined) return `${p.who}: I saw it. ${h.report[1]!.slice(h.witness.length + 2)} It's all on the board.`;
    if (stage < CLUES) return `${p.who}: You're going after ${title}? Follow the signs. I'm not going back out there.`;
    if (stage === CLUES) return `${p.who}: It's out there now, isn't it. Where the signs stop. Don't make me draw you a map.`;
    return `${p.who}: You got it? Then I'm sleeping tonight. First time in a week.`;
  }
  if (visit % 2 === 1) {
    const heard = rumours.filter((r) => r.startsWith(`${p.who}: `));
    if (heard.length) return heard[hash(`${t.id}:${p.id}`) % heard.length]!;
  }
  if (p.id === "cook") return stage === undefined ? `${p.who}: Coffee's on. If you're here about the sightings, the board's past the end of the counter.` : `${p.who}: Eat something before you go back out. Nobody ever does.`;
  if (p.id === "clerk") return `${p.who}: Gas is gas, the maps are free. Whatever's out by ${t.name}, it doesn't buy jerky.`;
  return stage !== undefined && stage > CLUES
    ? `${p.who}: Folks are checking in again. Word gets round when something's been seen to.`
    : `${p.who}: Rooms by the week. Nobody's checked out early since the sightings. Nobody's checked in, either.`;
}
