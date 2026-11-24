// The studio builder: one edit at a time to a studio definition (room.ts), the same data /jam.html walks you into.
// Each edit hands back the new studio, or the same one and why not, so a studio is never left half built: a seat
// out through a wall, a booth sticking out of the room. An edit is data (checked by `Edit`), so a sesh or an agent's
// tool can send them like the room's other ops later.
import { arr, Bad, bool, check, int, num, obj, oneOf, opt, str, type Guard } from "@rustybuns/util/guard";
import { PROP_KINDS, propBlocks, propBox, thingBox, type Prop, type Side, type Spot, type SpotKind, type StudioDef, type Wall } from "./room.ts";
import { footprint, inFootprint } from "./gear-wall.ts";
import { MAX_LANTERNS } from "../lanterns.ts";
import { MATERIAL_IDS, MATERIALS, type Material, PLAIN } from "./sound.ts";
import { POLY_KINDS } from "@rustybuns/models/polysynth";
import { SYSTEM_IDS, type SystemId } from "@rustybuns/gear";

export const SIZE = { w: [2, 40], d: [2, 50], h: [2.2, 20] } as const;
export const MAX_SPOTS = 16;
export const MAX_WALLS = 32;
export const MAX_PANELS = 12;
export const MAX_PROPS = 160;
/** How close two seats can be, and a seat to the outside walls, metres. */
export const SEAT_ROOM = 0.8;
export const WALL_ROOM = 0.3;

const SIDES = ["front", "back", "left", "right"] as const;
const KINDS = ["keys", "drums", "bass", "desk", "booth", "couch", "dj"] as const satisfies readonly SpotKind[];
const ID = str(32, { re: /^[a-z0-9][a-z0-9-]*$/ });
const MAT = oneOf(MATERIAL_IDS);
const XZ = (v: unknown): [number, number] => { const [x, z] = arr(num(-25, 25), 2, { min: 2 })(v); return [x, z]; };
const COLOR = str(9, { re: /^#[0-9a-f]{6}$/i });

/** What the builder's Decorate tool puts down, each at its real size and in its usual colour (drawn by props.ts). */
export const DECOR: Record<string, Pick<Prop, "w" | "d" | "h" | "color">> = {
  shelf: { w: 1.2, d: 0.35, h: 1.9, color: "#5a3a24" },
  lamp: { w: 0.4, d: 0.4, h: 1.6, color: "#c9a66b" },
  plant: { w: 0.6, d: 0.6, h: 1.4, color: "#3e6b3a" },
  rug: { w: 2.4, d: 1.7, h: 0.012, color: "#7a2e2a" },
  rack: { w: 0.6, d: 0.6, h: 1.2, color: "#1d1d1f" },
  piano: { w: 1.5, d: 2.0, h: 1.0, color: "#111111" },
  micStand: { w: 0.5, d: 0.5, h: 1.8, color: "#222222" },
  table: { w: 1.2, d: 0.7, h: 0.75, color: "#6b4a2c" },
  cabinet: { w: 0.5, d: 0.6, h: 1.3, color: "#7a7d82" },
  books: { w: 0.5, d: 0.35, h: 0.4, color: "#7a2e2a" },
  drumMachine: { w: 0.62, d: 0.3, h: 0.08, color: "#8c8f90" },
  modular: { w: 0.84, d: 0.16, h: 0.3, color: "#5a3a22" },
  // a studio monitor on its stand, a floor wedge, and a stage riser to stand the band on
  monitor: { w: 0.6, d: 0.5, h: 1.4, color: "#2a2420" },
  wedge: { w: 0.55, d: 0.45, h: 0.32, color: "#161618" },
  riser: { w: 2.4, d: 1.8, h: 0.4, color: "#0c0c0e" },
  // out of doors only: a camper van and a fire pit
  van: { w: 1.9, d: 4.9, h: 2.05, color: "#2f6f73" },
  firePit: { w: 1.2, d: 1.2, h: 0.6, color: "#6d655c" },
};
/** The decor that only stands out of doors. */
export const OUTDOOR_DECOR: readonly DecorKind[] = ["van", "firePit"];
export const DECOR_KINDS = Object.keys(DECOR) as DecorKind[];
export type DecorKind = "shelf" | "lamp" | "plant" | "rug" | "rack" | "piano" | "micStand" | "table" | "cabinet" | "books" | "drumMachine" | "modular" | "monitor" | "wedge" | "riser" | "van" | "firePit";


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
  gear: opt(obj({ at: XZ, yaw: num(-7, 7) })),
  bass: opt(oneOf(["mono", "box"] as const)),
  keys: opt(oneOf(POLY_KINDS)),
  outdoor: opt(obj({
    stacks: arr(obj({ at: XZ, yaw: num(-7, 7) }), 16),
    rig: opt(oneOf(SYSTEM_IDS)),
    mono: opt(bool()),
    truss: opt(obj({ at: XZ, yaw: num(-7, 7), w: num(2, 40), h: num(2, 12) })),
    generator: opt(obj({ at: XZ, yaw: num(-7, 7) })),
    fire: opt(obj({ at: XZ })),
    vans: opt(arr(obj({ at: XZ, yaw: num(-7, 7), awning: opt(bool()) }), 8)),
    festoons: opt(arr(obj({
      points: arr((v): [number, number, number] => { const [x, y, z] = arr(num(-25, 25), 3, { min: 3 })(v); return [x, y, z]; }, 8, { min: 2 }),
      posts: opt(arr(bool(), 8)),
    }), 8)),
    lanternPoles: opt(arr(obj({ at: XZ, yaw: num(-7, 7) }), 32)),
    lanterns: opt(arr((v): [number, number, number] => { const [x, y, z] = arr(num(-25, 25), 3, { min: 3 })(v); return [x, y, z]; }, MAX_LANTERNS)),
    carry: opt(bool()),
    rugs: opt(arr(obj({ at: XZ, yaw: num(-7, 7), w: num(0.5, 6), d: num(0.5, 6) }), 16)),
    seed: int(0, 2 ** 31),
  })),
});

/** Where this browser keeps the studio you built: /rooms.html writes it, /jam.html?studio=yours walks into it. */
export const YOURS = "qollab-studio:built";
/** The studio you built, if this browser has one that still checks out. */
export function yours(): StudioDef | null {
  try { const s = localStorage.getItem(YOURS); return s ? check(Studio, JSON.parse(s)) : null; } catch { return null; }
}

/**
 * The harness's way into a room you built (#5843): a probe's fresh browser has none of the page's storage, so
 * /rooms.html's `qrooms.enter()` hands out this link with the room in `built`. Only `?studio=yours` reads it, and
 * nothing a player clicks makes one: without `built`, "yours" is this browser's room as always.
 */
export function builtLink(origin: string, def: StudioDef, room = "built-room"): string {
  const u = new URL("/jam.html", origin);
  u.searchParams.set("room", room);
  u.searchParams.set("studio", "yours");
  u.searchParams.set("built", JSON.stringify(def));
  return u.href;
}
/** The room a `builtLink` carries, if it still checks out. */
export function fromBuilt(search: string): StudioDef | null {
  const s = new URLSearchParams(search).get("built");
  try { return s ? check(Studio, JSON.parse(s)) : null; } catch { return null; }
}

export type Surface = "floor" | "ceiling" | Side;
/**
 * What the builder does: `size` the room, make a `surface` of something, hang a `panel` on an outside wall or take
 * one off, make an inside `wall` of something, add a `spot` (a seat with its instrument), `move` or take one out,
 * put up a `booth` (four walls, glass toward the room and a door), move one or take it down, move the gear wall
 * (`moveGear`, its middle and a quarter turn at a time), `rename` the studio. Build mode's tools draw an inside wall
 * (`addWall`, from one point to another, on the floor's grid), knock a doorway through the middle of one or brick it
 * up again (`door`), take one down (`unwall`), and `turn` a seat an eighth of a turn at a time.
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
  | { t: "moveGear"; at: [number, number]; turns?: number }
  | { t: "rename"; name: string; about: string }
  | { t: "addWall"; from: [number, number]; to: [number, number]; material?: Material }
  | { t: "unwall"; index: number }
  | { t: "door"; index: number }
  | { t: "turn"; id: string; by: number }
  | { t: "addProp"; kind: DecorKind; at: [number, number]; yaw?: number }
  | { t: "moveProp"; index: number; at: [number, number] }
  | { t: "turnProp"; index: number; by: number }
  | { t: "unprop"; index: number }
  | { t: "window"; side: Side; along: number }
  | { t: "moveDoor"; at: [number, number] }
  | { t: "instruments"; keys?: (typeof POLY_KINDS)[number]; bass?: "mono" | "box"; rig?: SystemId };
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
  obj({ t: tag("moveGear"), at: XZ, turns: opt(int(-3, 3)) }),
  obj({ t: tag("rename"), name: str(60, { min: 1 }), about: str(400) }),
  obj({ t: tag("addWall"), from: XZ, to: XZ, material: opt(MAT) }),
  obj({ t: tag("unwall"), index: int(0, MAX_WALLS - 1) }),
  obj({ t: tag("door"), index: int(0, MAX_WALLS - 1) }),
  obj({ t: tag("turn"), id: ID, by: int(-7, 7) }),
  obj({ t: tag("addProp"), kind: oneOf(DECOR_KINDS), at: XZ, yaw: opt(num(-7, 7)) }),
  obj({ t: tag("moveProp"), index: int(0, MAX_PROPS - 1), at: XZ }),
  obj({ t: tag("turnProp"), index: int(0, MAX_PROPS - 1), by: int(-7, 7) }),
  obj({ t: tag("unprop"), index: int(0, MAX_PROPS - 1) }),
  obj({ t: tag("window"), side: oneOf(SIDES), along: num(-25, 25) }),
  obj({ t: tag("moveDoor"), at: XZ }),
  obj({ t: tag("instruments"), keys: opt(oneOf(POLY_KINDS)), bass: opt(oneOf(["mono", "box"] as const)), rig: opt(oneOf(SYSTEM_IDS)) }),
];

/** The shortest inside wall, and a doorway's width, metres. */
export const MIN_WALL = 0.5, DOORWAY = 0.9;
/** A builder edit from the wire, checked. */
export const Edit: Guard<Edit> = (v) => {
  for (const g of EDITS) { const e = check(g, v); if (e) return e; }
  throw new Bad("not a studio builder edit");
};

/** A new seat's instrument, as step 1's room draws it, and the track it plays. */
const THINGS: Record<SpotKind, Pick<Spot, "label" | "thing" | "track">> = {
  keys: { label: "the keys", thing: { w: 1.4, d: 0.45, h: 0.82, ahead: 0.48, color: "#16191c" }, track: "keys" },
  drums: { label: "the kit", thing: { w: 1.6, d: 1.1, h: 0.8, ahead: 0.8, color: "#b23a2e" } },
  bass: { label: "the bass synth", thing: { w: 0.7, d: 0.5, h: 0.9, ahead: 0.75, color: "#2e3439" }, track: "bass" },
  desk: { label: "the desk", thing: { w: 2.4, d: 0.8, h: 0.85, ahead: 0.65, color: "#3a4a6b" } },
  booth: { label: "the mic", thing: { w: 0.3, d: 0.3, h: 1.6, ahead: 0.55, color: "#8a8f94" } },
  couch: { label: "the couch", thing: { w: 2, d: 0.8, h: 0.45, ahead: -0.15, color: "#6b4a2c" } },
  // Load In's booth table (95 cm, 1.8 by 0.75 m): two media decks either side of a four-channel mixer
  dj: { label: "the decks", thing: { w: 1.8, d: 0.75, h: 0.95, ahead: 0.55, color: "#141518" } },
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
  out.push(...gearProblems(def));
  return out;
}

/** What is in the gear wall's way: the room's walls, a seat or what it plays, furniture you walk round, the way in. */
function gearProblems(def: StudioDef): string[] {
  const { w, d } = def.size, near = (x: number, z: number, pad: number) => inFootprint(def, x, z, pad);
  if (footprint(def).some(([x, z]) => Math.abs(x) > w / 2 + 1e-6 || Math.abs(z) > d / 2 + 1e-6)) return ["the gear wall sticks out of the room"];
  const out: string[] = [];
  for (const s of def.spots) { const b = thingBox(s); if (near(s.at[0], s.at[1], 0.5) || near(b.cx, b.cz, Math.max(b.hw, b.hd))) out.push(`${s.id} is in the gear wall's way`); }
  if (def.walls.some((x) => Array.from({ length: 51 }, (_, i) => i / 50).some((t) => near(x.from[0] + (x.to[0] - x.from[0]) * t, x.from[1] + (x.to[1] - x.from[1]) * t, 0.1)))) out.push("a wall runs through the gear wall");
  for (const p of (def.props ?? []).filter(propBlocks)) { const b = propBox(p); if (near(b.cx, b.cz, Math.min(b.hw, b.hd))) out.push(`a ${p.kind} is in the gear wall's way`); }
  if (near(def.door.at[0], def.door.at[1], 0.6)) out.push("the gear wall blocks the way in");
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
    case "moveGear": {
      // a quarter turn at a time, so the rack and the pedal wall can stand square against the room's walls
      const yaw = (next.gear?.yaw ?? 0) + (e.turns ?? 0) * (Math.PI / 2);
      next.gear = { at: e.at, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)) };
      break;
    }
    case "rename": next.name = e.name; next.about = e.about; break;
    case "addWall": {
      if (next.walls.length >= MAX_WALLS) return no(`a room holds ${MAX_WALLS} walls`);
      if (Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) < MIN_WALL) return no(`a wall is at least ${MIN_WALL * 100} cm long`);
      next.walls.push({ from: e.from, to: e.to, ...(e.material === "glass" ? { glass: true } : { material: e.material ?? "drywall" }) });
      break;
    }
    case "unwall": {
      const wl = next.walls[e.index];
      if (!wl) return no("there is no such wall");
      if (wl.booth) return no(`that wall is part of ${wl.booth}: take the booth down instead`);
      next.walls.splice(e.index, 1);
      break;
    }
    case "door": {
      const wl = next.walls[e.index];
      if (!wl) return no("there is no such wall");
      const len = Math.hypot(wl.to[0] - wl.from[0], wl.to[1] - wl.from[1]);
      if (wl.gaps?.length) delete wl.gaps;
      else if (len < DOORWAY + 0.2) return no("that wall is too short for a doorway");
      else wl.gaps = [[len / 2 - DOORWAY / 2, len / 2 + DOORWAY / 2]];
      break;
    }
    case "addProp": {
      const props = next.props ??= [];
      if (props.length >= MAX_PROPS) return no(`a room holds ${MAX_PROPS} things`);
      if (OUTDOOR_DECOR.includes(e.kind) && !next.outdoor) return no("that stands out of doors");
      props.push({ kind: e.kind, at: e.at, yaw: e.yaw ?? 0, ...DECOR[e.kind]!, seed: props.length * 97 + 13 });
      break;
    }
    case "moveProp": case "turnProp": case "unprop": {
      const props = next.props ?? [], p = props[e.index];
      if (!p) return no("there is no such thing");
      if (e.t === "moveProp") p.at = e.at;
      else if (e.t === "turnProp") { const yaw = p.yaw + (e.by * Math.PI) / 4; p.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); }
      else props.splice(e.index, 1);
      break;
    }
    case "window": {
      // a window 1.4 by 1.2 m, its sill a metre up, set in the outside wall `side` at `along` metres from its middle,
      // facing into the room (a prop's front faces -z before its turn)
      const props = next.props ??= [], { w, d } = next.size, len = e.side === "front" || e.side === "back" ? w : d;
      if (props.length >= MAX_PROPS) return no(`a room holds ${MAX_PROPS} things`);
      if (Math.abs(e.along) > len / 2 - 0.8) return no("a window needs 80 cm of wall either side of it");
      const at: [number, number] = e.side === "front" ? [e.along, d / 2 - 0.06] : e.side === "back" ? [e.along, -d / 2 + 0.06] : e.side === "left" ? [-w / 2 + 0.06, e.along] : [w / 2 - 0.06, e.along];
      const yaw = e.side === "front" ? 0 : e.side === "back" ? Math.PI : e.side === "left" ? -Math.PI / 2 : Math.PI / 2;
      props.push({ kind: "window", at, yaw, w: 1.4, d: 0.1, h: 1.2, y: 1, color: "#e8e2d4" });
      break;
    }
    case "moveDoor": next.door = { ...next.door, at: e.at }; break;
    // what stands at the keys and bass seats (gear-models.ts): one of the classic families, the big mono or the box
    case "instruments": {
      if (e.rig && !next.outdoor) return no("a rig stands out of doors");
      if (e.keys) next.keys = e.keys;
      if (e.bass) next.bass = e.bass;
      if (e.rig && next.outdoor) next.outdoor = { ...next.outdoor, rig: e.rig };
      break;
    }
    case "turn": {
      const sp = next.spots.find((x) => x.id === e.id);
      if (!sp) return no(`there is no spot ${e.id}`);
      const yaw = sp.yaw + (e.by * Math.PI) / 4;
      sp.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      break;
    }
  }
  const wrong = problems(next);
  return wrong.length ? no(wrong[0]) : { ok: true, def: next };
}

/**
 * Dress a studio the way a working one usually is, as edits the builder does one by one (each that wouldn't fit is
 * left out): a rug under the kit, a lamp in each free corner, a plant either side of the way in, a shelf of records
 * along the back wall and a rack of outboard gear by the desk, and absorbers on any wall that's still bare.
 */
export function furnish(def: StudioDef): { def: StudioDef; done: Edit[] } {
  const { w, d } = def.size, want: Edit[] = [];
  for (const s of def.spots.filter((x) => x.kind === "drums")) { const b = thingBox(s); want.push({ t: "addProp", kind: "rug", at: [b.cx, b.cz], yaw: s.yaw }); }
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) want.push({ t: "addProp", kind: "lamp", at: [x * (w / 2 - 0.45), z * (d / 2 - 0.45)] });
  const [dx, dz] = def.door.at;
  for (const k of [-1, 1]) want.push({ t: "addProp", kind: "plant", at: [dx + k * 1.1, Math.max(-d / 2 + 0.5, Math.min(d / 2 - 0.5, dz - 0.2))] });
  want.push({ t: "addProp", kind: "shelf", at: [0, -d / 2 + 0.3], yaw: Math.PI });
  for (const s of def.spots.filter((x) => x.kind === "desk")) { const b = thingBox(s); want.push({ t: "addProp", kind: "rack", at: [b.cx + b.hw + 0.5, b.cz], yaw: s.yaw }); }
  const mats = def.materials ?? PLAIN;
  for (const side of SIDES) {
    const bare = !(def.panels ?? []).some((p) => p.wall === side) && !["foam", "panel", "curtain", "carpet"].includes(mats.walls[side]);
    if (bare) want.push({ t: "panel", wall: side, material: "panel", m2: Math.round((side === "front" || side === "back" ? w : d) * 0.8) });
  }
  let now = def;
  const done: Edit[] = [];
  for (const e of want) { const r = edit(now, e); if (r.ok) { now = r.def; done.push(e); } }
  return { def: now, done };
}
