// What a Qollab Studio room is: its size, its walls and floor, and the spots you sit at to play. A room is data
// (src/studio/rooms/*.ts), so a new studio is a new file, not new code. What its surfaces are made of sets how it
// sounds (sound.ts); the studio builder (builder.ts) edits one. Pure: no DOM, no three.js.
import type { Material } from "./sound.ts";

/** What a spot is for. `keys`, `bass` and `drums` play a track; `desk` and `couch` are a seat to listen from; `dj` is a DJ booth (two decks and a mixer on a table). */
export type SpotKind = "keys" | "drums" | "bass" | "desk" | "booth" | "couch" | "dj";

export interface Spot {
  /** Lowercase letters, digits and dashes: it goes on the wire as the seat someone is in. */
  id: string;
  kind: SpotKind;
  label: string;
  /** Where the seat is (x, z in metres, floor at y 0) and which way you face sitting there (yaw 0 looks down -z). */
  at: [number, number];
  yaw: number;
  /** The instrument or furniture in front of the seat, in its own frame: w across, d deep, h tall, centred `ahead` metres in front. */
  thing: { w: number; d: number; h: number; ahead: number; color: string };
  /** The FM DAW track it plays, by name (first match, any case); `drums` plays every drum track, one key each. */
  track?: string;
  /** A made instrument's seat (src/studio/instrument.ts) names its track by number instead. */
  ix?: number;
  /** A made instrument grows its model from this seed and voice (`synth` in @rustybuns/models) instead of a box. */
  made?: { seed: number; voice: "fm" | "analog" };
}

/** A wall from (x0, z0) to (x1, z1), floor to ceiling. `glass` is a window you see through but can't walk through; `gaps` are doorways, metres along it. */
export interface Wall {
  from: [number, number]; to: [number, number]; glass?: boolean; gaps?: [number, number][];
  /** What it is made of, for the sound (drywall when left out; a glass wall is glass). */
  material?: Material;
  /** The booth it is one side of, when the builder put it up: a booth's walls move and come down together. */
  booth?: string;
}

/** The outside four walls are front (+z), back (-z), left (-x) and right (+x). */
export type Side = "front" | "back" | "left" | "right";
/** What the floor, ceiling and outside walls are made of. */
export interface Materials { floor: Material; ceiling: Material; walls: Record<Side, Material> }
/** A patch of something else on an outside wall: absorbers, a curtain. Its area comes off the wall's. */
export interface Panel { wall: Side; material: Material; m2: number }

export interface StudioDef {
  id: string;
  name: string;
  /** The floor from -w/2 to w/2 across and -d/2 to d/2 deep; the ceiling `h` up. */
  size: { w: number; d: number; h: number };
  colors: { floor: string; walls: string; ceiling: string; trim: string };
  /** What it is made of and what hangs on its walls; a plain drywall room with a wooden floor when left out. */
  materials?: Materials;
  panels?: Panel[];
  /** A line on what made it, for a room after a famous kind of studio. */
  about?: string;
  /** Walls inside the room (the outside four come with the size). */
  walls: Wall[];
  spots: Spot[];
  /** Where you come in, and the way you face. */
  door: { at: [number, number]; yaw: number };
  /** What fills it besides the seats: shelves, lamps, racks, a piano. */
  props?: Prop[];
  /** Its gear wall (src/studio/gear-wall.ts): where the sesh's gear room stands in it. In the back right corner when left out. */
  gear?: GearPlace;
  /** Out under the sky instead of in a room (open-air.ts): no walls or ceiling drawn, the ground running to the horizon. */
  outdoor?: Outdoor;
}

/**
 * An open-air party's rig, drawn by open-air.ts: the speaker stacks (each a horn bin, a mid-bass horn and a mid-high horn
 * on a sand dolly, its front facing yaw's way as a seat looks), the lighting truss behind the stage with its moving heads
 * and lasers, the lantern poles round the floor, the generator off to one side, and a seed for the plants and rocks out in the dark. The size is the ground you can walk.
 */
export interface Outdoor {
  stacks: { at: [number, number]; yaw: number }[];
  truss: { at: [number, number]; yaw: number; w: number; h: number };
  generator?: { at: [number, number]; yaw: number };
  /** The carved wooden lantern poles round the dance floor: the corners of the line they stand on (x0, z0, x1, z1). */
  lanternPoles?: [number, number, number, number];
  /** Lanterns anyone can pick up and carry (src/studio/lanterns.ts): where each one starts (x, y, z: y the top it stands on). */
  lanterns?: [number, number, number][];
  seed: number;
}

/**
 * Where the sesh's gear room (src/room/room.ts: the rack on its back wall, the pedal wall on its left, the cab, the
 * guitar and the patch bay on the floor) stands in a studio: the middle of that 7 by 6 metre frame, and its turn.
 */
export interface GearPlace { at: [number, number]; yaw: number }

/** The spot's thing, as a box on the floor: its middle and half sizes, turned by the spot's yaw. */
export function thingBox(s: Spot): { cx: number; cz: number; hw: number; hd: number; turn: number } {
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  return { cx: s.at[0] + fx * s.thing.ahead, cz: s.at[1] + fz * s.thing.ahead, hw: s.thing.w / 2, hd: s.thing.d / 2, turn: s.yaw };
}

/** Where a seated player's palms go: metres ahead of the seat, and up off the floor. */
export interface Reach { ahead: number; up: number }
/** Where a player's palms go at the stage synth the page draws for a keys spot (main.ts thing(), its keys' top at
 *  thing.h and their near edge thing.d * 0.43 nearer than its middle): just over the near half of the white keys. */
export function keysReach(s: Spot): Reach | null {
  if (s.kind !== "keys" || s.made) return null;
  const t = s.thing;
  return { ahead: t.ahead - t.d * 0.43 + 0.07, up: t.h + 0.06 };
}

/** A wall as the solid pieces between its doorways, each a thin box. */
export function wallPieces(w: Wall, thick = 0.12): { cx: number; cz: number; hw: number; hd: number; turn: number }[] {
  const [x0, z0] = w.from, [x1, z1] = w.to, len = Math.hypot(x1 - x0, z1 - z0);
  const ux = (x1 - x0) / len, uz = (z1 - z0) / len, turn = -Math.atan2(uz, ux);
  const gaps = [...(w.gaps ?? [])].sort((a, b) => a[0] - b[0]);
  const runs: [number, number][] = [];
  let from = 0;
  for (const [a, b] of gaps) { if (a > from) runs.push([from, a]); from = Math.max(from, b); }
  if (from < len) runs.push([from, len]);
  return runs.map(([a, b]) => ({ cx: x0 + ux * (a + b) / 2, cz: z0 + uz * (a + b) / 2, hw: (b - a) / 2, hd: thick / 2, turn }));
}

/** Set dressing: what fills a room besides its seats. Drawn by src/studio/props.ts; it doesn't change how the room sounds. */
export const PROP_KINDS = ["shelf", "lamp", "plant", "rug", "rack", "console", "monitor", "stairs", "balcony", "window", "piano", "micStand", "panel", "frames", "sampler", "table",
  // an office's clutter: a desk with its screen and papers, a cubicle's edge, books stacked on the floor, cables, what's left on a desk, a filing cabinet
  "officeDesk", "cubicle", "books", "cables", "clutter", "cabinet",
  // a TV sound stage: a riser you stand on, the lighting grid, bleachers, a camera on its pedestal, a floor wedge, a cyc, a painted flat, the host's desk
  "riser", "grid", "bleachers", "camera", "wedge", "cyc", "flat", "hostDesk"] as const;
export type PropKind = (typeof PROP_KINDS)[number];
export interface Prop {
  kind: PropKind;
  /** Its middle on the floor (x, z in metres) and the way its front faces (yaw 0 faces -z, as a seat looks). */
  at: [number, number];
  yaw: number;
  /** w across, d deep, h tall, standing `y` metres up (a panel on a wall, a speaker on a console). */
  w: number; d: number; h: number; y?: number;
  color: string;
  /** What's on a shelf, in a rack or on a wall comes out of this seed. */
  seed?: number;
}
/** Dressing you walk round: anything standing on the floor except what's flat or thin. */
export const propBlocks = (p: Prop) => (p.y ?? 0) < 0.5 && !["rug", "panel", "frames", "window", "micStand", "lamp", "balcony", "cables", "clutter", "riser", "grid", "cyc"].includes(p.kind);
/** A prop's footprint, as a box on the floor turned by its yaw. */
export const propBox = (p: Prop) => ({ cx: p.at[0], cz: p.at[1], hw: p.w / 2, hd: p.d / 2, turn: p.yaw });
/** How high the floor is here: a riser's deck under (x, z) lifts whoever stands or sits on it, and what they play. */
export function floorAt(def: StudioDef, x: number, z: number): number {
  let y = 0;
  for (const p of def.props ?? []) {
    if (p.kind !== "riser") continue;
    const dx = x - p.at[0], dz = z - p.at[1], c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    // into the riser's own frame (three.js turns +x toward -z by yaw)
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) <= p.w / 2 && Math.abs(lz) <= p.d / 2) y = Math.max(y, (p.y ?? 0) + p.h);
  }
  return y;
}
