// What a Qollab Studio room is: its size, its walls and floor, and the spots you sit at to play. A room is data
// (src/studio/rooms/*.ts), so a new studio is a new file, not new code. Pure: no DOM, no three.js.

/** What a spot is for. `keys`, `bass` and `drums` play a track; `desk` and `couch` are a seat to listen from. */
export type SpotKind = "keys" | "drums" | "bass" | "desk" | "booth" | "couch";

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
}

/** A wall from (x0, z0) to (x1, z1), floor to ceiling. `glass` is a window you see through but can't walk through; `gaps` are doorways, metres along it. */
export interface Wall { from: [number, number]; to: [number, number]; glass?: boolean; gaps?: [number, number][] }

export interface StudioDef {
  id: string;
  name: string;
  /** The floor from -w/2 to w/2 across and -d/2 to d/2 deep; the ceiling `h` up. */
  size: { w: number; d: number; h: number };
  colors: { floor: string; walls: string; ceiling: string; trim: string };
  /** Walls inside the room (the outside four come with the size). */
  walls: Wall[];
  spots: Spot[];
  /** Where you come in, and the way you face. */
  door: { at: [number, number]; yaw: number };
}

/** The spot's thing, as a box on the floor: its middle and half sizes, turned by the spot's yaw. */
export function thingBox(s: Spot): { cx: number; cz: number; hw: number; hd: number; turn: number } {
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  return { cx: s.at[0] + fx * s.thing.ahead, cz: s.at[1] + fz * s.thing.ahead, hw: s.thing.w / 2, hd: s.thing.d / 2, turn: s.yaw };
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
