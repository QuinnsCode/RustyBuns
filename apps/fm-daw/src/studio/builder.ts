// The studio builder: one edit at a time to a studio definition (room.ts), the same data /jam.html walks you into.
// Each edit hands back the new studio, or the same one and why not, so a studio is never left half built: a seat
// out through a wall, a booth sticking out of the room. An edit is data (checked by `Edit`), so a sesh or an agent's
// tool can send them like the room's other ops later.
import { arr, Bad, bool, check, int, num, obj, oneOf, opt, str, type Guard } from "@rustybuns/util/guard";
import { PROP_KINDS, type Side, type Spot, type SpotKind, type StudioDef, type Wall } from "./room.ts";
import { MATERIAL_IDS, MATERIALS, type Material, PLAIN } from "./sound.ts";

export const SIZE = { w: [2, 40], d: [2, 50], h: [2.2, 20] } as const;
export const MAX_SPOTS = 16;
export const MAX_WALLS = 32;
export const MAX_PANELS = 12;
export const MAX_PROPS = 160;
/** How close two seats can be, and a seat to the outside walls, metres. */
export const SEAT_ROOM = 0.8;
export const WALL_ROOM = 0.3;

const SIDES = ["front", "back", "left", "right"] as const;
const KINDS = ["keys", "drums", "bass", "desk", "booth", "couch"] as const satisfies readonly SpotKind[];
const ID = str(32, { re: /^[a-z0-9][a-z0-9-]*$/ });
const MAT = oneOf(MATERIAL_IDS);
const XZ = (v: unknown): [number, number] => { const [x, z] = arr(num(-25, 25), 2, { min: 2 })(v); return [x, z]; };
const COLOR = str(9, { re: /^#[0-9a-f]{6}$/i });

/** A studio from the wire or this browser's storage, checked. */
export const Studio: Guard<StudioDef> = obj({
  id: ID, name: str(60, { min: 1 }), about: opt(str(400)),
  size: obj({ w: num(SIZE.w[0], SIZE.w[1]), d: num(SIZE.d[0], SIZE.d[1]), h: num(SIZE.h[0], SIZE.h[1]) }),
  colors: obj({ floor: COLOR, walls: COLOR, ceiling: COLOR, trim: COLOR }),
  materials: opt(obj({ floor: MAT, ceiling: MAT, walls: obj({ front: MAT, back: MAT, left: MAT, right: MAT }) })),
  panels: opt(arr(obj({ wall: oneOf(SIDES), material: MAT, m2: num(0.1, 400) }), MAX_PANELS)),
  walls: arr(obj({ from: XZ, to: XZ, glass: opt(bool()), gaps: opt(arr((v) => { const [a, b] = arr(num(0, 80), 2, { min: 2 })(v); return [a, b] as [number, number]; }, 4)), material: opt(MAT), booth: opt(ID) }), MAX_WALLS),
  spots: arr(obj({
    id: ID, kind: oneOf(KINDS), label: str(40), at: XZ, yaw: num(-7, 7),
    thing: obj({ w: num(0.05, 5), d: num(0.05, 5), h: num(0.05, 4), ahead: num(-3, 3), color: COLOR }), track: opt(str(40)),
  }), MAX_SPOTS),
  door: obj({ at: XZ, yaw: num(-7, 7) }),
  props: opt(arr(obj({
    kind: oneOf(PROP_KINDS), at: XZ, yaw: num(-7, 7), w: num(0.02, 40), d: num(0.01, 50), h: num(0.01, 20), y: opt(num(0, 20)), color: COLOR, seed: opt(int(0, 2 ** 31)),
  }), MAX_PROPS)),
});

/** Where this browser keeps the studio you built: /rooms.html writes it, /jam.html?studio=yours walks into it. */
export const YOURS = "qollab-studio:built";
/** The studio you built, if this browser has one that still checks out. */
export function yours(): StudioDef | null {
  try { const s = localStorage.getItem(YOURS); return s ? check(Studio, JSON.parse(s)) : null; } catch { return null; }
}

export type Surface = "floor" | "ceiling" | Side;
/**
 * What the builder does: `size` the room, make a `surface` of something, hang a `panel` on an outside wall or take
 * one off, make an inside `wall` of something, add a `spot` (a seat with its instrument), `move` or take one out,
 * put up a `booth` (four walls, glass toward the room and a door), move one or take it down, `rename` the studio.
 */
export type Edit =
  | { t: "size"; w: number; d: number; h: number }
  | { t: "surface"; surface: Surface; material: Material }
  | { t: "panel"; wall: Side; material: Material; m2: number }
  | { t: "unpanel"; index: number }
  | { t: "wall"; index: number; material: Material }
  | { t: "spot"; id: string; kind: SpotKind; at: [number, number] }
  | { t: "move"; id: string; at: [number, number] }
  | { t: "unspot"; id: string }
  | { t: "booth"; id: string; at: [number, number]; w: number; d: number }
  | { t: "moveBooth"; id: string; at: [number, number] }
  | { t: "unbooth"; id: string }
  | { t: "rename"; name: string; about: string };
const tag = <T extends string>(t: T) => oneOf([t]);
const EDITS: Guard<Edit>[] = [
  obj({ t: tag("size"), w: num(SIZE.w[0], SIZE.w[1]), d: num(SIZE.d[0], SIZE.d[1]), h: num(SIZE.h[0], SIZE.h[1]) }),
  obj({ t: tag("surface"), surface: oneOf(["floor", "ceiling", ...SIDES] as const), material: MAT }),
  obj({ t: tag("panel"), wall: oneOf(SIDES), material: MAT, m2: num(0.1, 400) }),
  obj({ t: tag("unpanel"), index: int(0, MAX_PANELS - 1) }),
  obj({ t: tag("wall"), index: int(0, MAX_WALLS - 1), material: MAT }),
  obj({ t: tag("spot"), id: ID, kind: oneOf(KINDS), at: XZ }),
  obj({ t: tag("move"), id: ID, at: XZ }),
  obj({ t: tag("unspot"), id: ID }),
  obj({ t: tag("booth"), id: ID, at: XZ, w: num(1.2, 8), d: num(1.2, 8) }),
  obj({ t: tag("moveBooth"), id: ID, at: XZ }),
  obj({ t: tag("unbooth"), id: ID }),
  obj({ t: tag("rename"), name: str(60, { min: 1 }), about: str(400) }),
];
/** A builder edit from the wire, checked. */
export const Edit: Guard<Edit> = (v) => {
  for (const g of EDITS) { const e = check(g, v); if (e) return e; }
  throw new Bad("not a studio builder edit");
};

/** A new seat's instrument, as step 1's room draws it, and the track it plays. */
const THINGS: Record<SpotKind, Pick<Spot, "label" | "thing" | "track">> = {
  keys: { label: "the keys", thing: { w: 1.4, d: 0.45, h: 0.9, ahead: 0.55, color: "#16191c" }, track: "keys" },
  drums: { label: "the kit", thing: { w: 1.6, d: 1.1, h: 0.8, ahead: 0.8, color: "#b23a2e" } },
  bass: { label: "the bass rig", thing: { w: 0.7, d: 0.5, h: 0.9, ahead: 0.75, color: "#2e3439" }, track: "bass" },
  desk: { label: "the desk", thing: { w: 2.4, d: 0.8, h: 0.85, ahead: 0.65, color: "#3a4a6b" } },
  booth: { label: "the mic", thing: { w: 0.3, d: 0.3, h: 1.6, ahead: 0.55, color: "#8a8f94" } },
  couch: { label: "the couch", thing: { w: 2, d: 0.8, h: 0.45, ahead: -0.15, color: "#6b4a2c" } },
};
export function newSpot(id: string, kind: SpotKind, at: [number, number]): Spot {
  const t = THINGS[kind];
  return { id, kind, label: t.label, at, yaw: 0, thing: { ...t.thing }, ...(t.track ? { track: t.track } : {}) };
}

/** A booth's four walls around (x, z): glass on the side facing the room's middle, a door in a side you can walk up to. */
export function boothWalls(id: string, at: [number, number], w: number, d: number, room: { w: number; d: number }): Wall[] {
  const [x, z] = at, x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  const sides: Record<Side, [[number, number], [number, number]]> = { back: [[x0, z0], [x1, z0]], right: [[x1, z0], [x1, z1]], front: [[x1, z1], [x0, z1]], left: [[x0, z1], [x0, z0]] };
  const faces: Side = Math.abs(x) > Math.abs(z) ? (x > 0 ? "left" : "right") : (z > 0 ? "back" : "front");
  const order: Side[] = ["back", "right", "front", "left"];
  // Not against an outside wall: a door there opens onto nothing.
  const clear: Record<Side, number> = { back: z0 + room.d / 2, front: room.d / 2 - z1, left: x0 + room.w / 2, right: room.w / 2 - x1 };
  const around = [1, 3, 2].map((k) => order[(order.indexOf(faces) + k) % 4]);
  const door = around.find((s) => clear[s] > 0.9) ?? faces;
  return order.map((s) => {
    const [from, to] = sides[s], len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const wall: Wall = { from, to, booth: id, material: "foam" };
    if (s === faces) wall.glass = true;
    if (s === door) wall.gaps = [[len / 2 - 0.45, len / 2 + 0.45]];
    return wall;
  });
}

/** What is wrong with a studio as it stands, in words; empty when it can be built. */
export function problems(def: StudioDef): string[] {
  const out: string[] = [], { w, d, h } = def.size;
  const inRoom = (p: readonly number[], pad: number) => Math.abs(p[0]) <= w / 2 - pad + 1e-9 && Math.abs(p[1]) <= d / 2 - pad + 1e-9;
  for (const s of SIDES) {
    const m2 = (def.panels ?? []).filter((p) => p.wall === s).reduce((t, p) => t + p.m2, 0), wall = (s === "front" || s === "back" ? w : d) * h;
    if (m2 > wall + 1e-9) out.push(`the ${s} wall's panels (${m2.toFixed(1)} m²) are bigger than the wall (${wall.toFixed(1)} m²)`);
  }
  for (const b of new Set(def.walls.map((x) => x.booth).filter((x) => x !== undefined)))
    if (def.walls.some((x) => x.booth === b && !(inRoom(x.from, 0) && inRoom(x.to, 0)))) out.push(`${b} sticks out of the room`);
  if (def.walls.some((x) => x.booth === undefined && !(inRoom(x.from, 0) && inRoom(x.to, 0)))) out.push("a wall sticks out of the room");
  const ids = new Set<string>();
  for (const s of def.spots) {
    if (ids.has(s.id)) out.push(`two spots called ${s.id}`);
    ids.add(s.id);
    if (!inRoom(s.at, WALL_ROOM)) out.push(`${s.id} is outside the room's walls`);
    else if (def.walls.some((x) => toSegment(s.at, x) < WALL_ROOM)) out.push(`${s.id} is in a wall`);
  }
  for (let i = 0; i < def.spots.length; i++) for (let j = i + 1; j < def.spots.length; j++) {
    const a = def.spots[i], b = def.spots[j];
    if (Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) < SEAT_ROOM) out.push(`${a.id} and ${b.id} are on top of each other`);
  }
  if (!inRoom(def.door.at, WALL_ROOM)) out.push("the way in is outside the room");
  return out;
}

function toSegment(p: readonly number[], wl: Wall) {
  const [x0, z0] = wl.from, [x1, z1] = wl.to, dx = x1 - x0, dz = z1 - z0, len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - z0) * dz) / len2));
  return Math.hypot(p[0] - (x0 + t * dx), p[1] - (z0 + t * dz));
}

/** The middle of a booth, from its walls. */
export function boothMiddle(def: StudioDef, id: string): [number, number] | null {
  const ws = def.walls.filter((x) => x.booth === id);
  if (!ws.length) return null;
  const xs = ws.flatMap((x) => [x.from[0], x.to[0]]), zs = ws.flatMap((x) => [x.from[1], x.to[1]]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
}

export type Built = { ok: true; def: StudioDef } | { ok: false; def: StudioDef; why: string };

/** Do `e` to `def`: the new studio, or `def` unchanged and why not. */
export function edit(def: StudioDef, e: Edit): Built {
  const no = (why: string): Built => ({ ok: false, def, why });
  const next = structuredClone(def);
  const mats = next.materials ??= structuredClone(PLAIN) as NonNullable<StudioDef["materials"]>;
  const panels = next.panels ??= [];
  switch (e.t) {
    case "size": next.size = { w: e.w, d: e.d, h: e.h }; break;
    case "surface":
      if (e.surface === "floor" || e.surface === "ceiling") mats[e.surface] = e.material; else mats.walls[e.surface] = e.material;
      // The room is drawn in what it's made of.
      next.colors = { ...next.colors, floor: MATERIALS[mats.floor].color, ceiling: MATERIALS[mats.ceiling].color, walls: MATERIALS[mats.walls.back].color };
      break;
    case "panel":
      if (panels.length >= MAX_PANELS) return no(`a room holds ${MAX_PANELS} panels`);
      panels.push({ wall: e.wall, material: e.material, m2: e.m2 });
      break;
    case "unpanel":
      if (!panels[e.index]) return no("there is no such panel");
      panels.splice(e.index, 1);
      break;
    case "wall": {
      const wl = next.walls[e.index];
      if (!wl) return no("there is no such wall");
      if (e.material === "glass") wl.glass = true; else { delete wl.glass; wl.material = e.material; }
      break;
    }
    case "spot":
      if (next.spots.some((s) => s.id === e.id)) return no(`there is already a spot called ${e.id}`);
      if (next.spots.length >= MAX_SPOTS) return no(`a room holds ${MAX_SPOTS} spots`);
      next.spots.push(newSpot(e.id, e.kind, e.at));
      break;
    case "move": {
      const s = next.spots.find((x) => x.id === e.id);
      if (!s) return no(`there is no spot ${e.id}`);
      s.at = e.at;
      break;
    }
    case "unspot":
      if (!next.spots.some((s) => s.id === e.id)) return no(`there is no spot ${e.id}`);
      next.spots = next.spots.filter((s) => s.id !== e.id);
      break;
    case "booth":
      if (next.walls.some((x) => x.booth === e.id)) return no(`there is already a booth called ${e.id}`);
      if (next.walls.length + 4 > MAX_WALLS) return no(`a room holds ${MAX_WALLS} walls`);
      next.walls.push(...boothWalls(e.id, e.at, e.w, e.d, next.size));
      break;
    case "moveBooth": {
      const from = boothMiddle(next, e.id);
      if (!from) return no(`there is no booth ${e.id}`);
      // Its walls and the seats inside go with it.
      const dx = e.at[0] - from[0], dz = e.at[1] - from[1], ws = next.walls.filter((x) => x.booth === e.id);
      const xs = ws.flatMap((x) => [x.from[0], x.to[0]]), zs = ws.flatMap((x) => [x.from[1], x.to[1]]);
      const inside = (p: number[]) => p[0] > Math.min(...xs) && p[0] < Math.max(...xs) && p[1] > Math.min(...zs) && p[1] < Math.max(...zs);
      for (const s of next.spots) if (inside(s.at)) s.at = [s.at[0] + dx, s.at[1] + dz];
      for (const x of ws) { x.from = [x.from[0] + dx, x.from[1] + dz]; x.to = [x.to[0] + dx, x.to[1] + dz]; }
      break;
    }
    case "unbooth":
      if (!next.walls.some((x) => x.booth === e.id)) return no(`there is no booth ${e.id}`);
      next.walls = next.walls.filter((x) => x.booth !== e.id);
      break;
    case "rename": next.name = e.name; next.about = e.about; break;
  }
  const wrong = problems(next);
  return wrong.length ? no(wrong[0]) : { ok: true, def: next };
}
