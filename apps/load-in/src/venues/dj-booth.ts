// The DJ booth: two decks (club media players or direct-drive turntables) either side of a four-channel mixer, lined up
// on a 95 cm table the way a real booth is: the mixer centred, a deck each side with equal gaps, every front edge in
// one line and all three level, two booth monitors on stands with their drivers at the DJ's ear, aimed at the head.
// The DJ stands between the back wall and the table, facing the room; the gear's backs (and its cables) face the crowd.
// `booth(kind)` gives the placed pieces for any level; `DJ_BOOTH` is a small room with one, two powered tops on stands
// and a sub on a rack. `judgeBooth` runs the patch through packages/gear's compile and says which mixer channel each
// deck is in, so the decks (src/audio/decks.ts) know what the faders and the crossfader do. Plain data, no DOM.
import { CIRCUIT_20A, type Cable, type Compiled, type Placed, compile, gear as catalog, jackKind } from "@rustybuns/gear";
import { EYE, type Item, type Level, type World } from "../sim.ts";
import { type Cables, plugged } from "../cables/cables.ts";
import type { CrowdSpot } from "../crowd/crowd.ts";

/** The dance floor: the room in front of the sub, 80 people when it is full (8 x 9 x 3 m, painted walls, a hard floor). */
export const DANCE: CrowdSpot = {
  floor: { x0: -3.2, x1: 3.2, z0: 3.7, z1: 8.5, nx: 13, nz: 10 },
  stageZ: 3.6,
  capacity: 80,
  room: { w: 8, d: 9, h: 3, alpha: 0.12 },
  regions: [
    { name: "front", zone: { x0: -3.2, x1: 3.2, z0: 3.7, z1: 5.3 } },
    { name: "middle", zone: { x0: -3.2, x1: 3.2, z0: 5.3, z1: 6.9 } },
    { name: "back", zone: { x0: -3.2, x1: 3.2, z0: 6.9, z1: 8.5 } },
  ],
};

export type DeckKind = "media" | "vinyl";

/** Table top height, its size, and the gap between a deck and the mixer, metres. */
export const TABLE = { h: 0.95, w: 1.8, d: 0.75 };
export const GAP = 0.03;
/** How far the line of front edges sits back from the table's edge on the DJ's side. */
const LIP = 0.08;

export const DECK_GEAR: Record<DeckKind, string> = { media: "deck-media", vinyl: "turntable" };
/** The booth monitor: an 8" powered box on a stand. */
const MONITOR = "fill-8-powered";

export type Booth = {
  kind: DeckKind;
  /** The table: its centre on the floor, its size. */
  table: { x: number; z: number; w: number; d: number; h: number };
  /** Where the DJ's head is. */
  head: { x: number; y: number; z: number };
  /** Deck 1 (the DJ's left), the mixer, deck 2, the monitors and their stands. */
  items: Item[];
  /** Each monitor stand's pole height, so the driver sits at ear height. */
  stands: Record<string, number>;
};

/** Where a speaker's driver is, as a share of its box's height (hear.ts places sound there too). */
const DRIVER = 0.65;

/**
 * A booth centred on (x, z), the DJ on the -z side facing +z. Keys are prefixed with `pre` so a level can hold two.
 * Every piece on the table is turned to face the DJ (rot = pi: a model's front is its +z).
 */
export function booth(kind: DeckKind, at = { x: 0, z: 1.6 }, pre = ""): Booth {
  const deck = catalog(DECK_GEAR[kind]).size, mixer = catalog("mixer-dj").size;
  const front = at.z - TABLE.d / 2 + LIP;
  // Turned by pi, a piece's front edge is at z - d / 2: put every front edge on one line.
  const on = (key: string, gear: string, x: number, d: number): Item => ({ key: pre + key, gear, x, y: TABLE.h, z: front + d / 2, rot: Math.PI });
  const off = mixer.w / 2 + GAP + deck.w / 2;
  // Facing +z, the DJ's left is +x.
  const head = { x: at.x, y: EYE, z: front - 0.45 };
  const mon = catalog(MONITOR).size, pole = EYE - mon.h * DRIVER;
  const items: Item[] = [on("deck-1", DECK_GEAR[kind], at.x + off, deck.d), on("mixer", "mixer-dj", at.x, mixer.d), on("deck-2", DECK_GEAR[kind], at.x - off, deck.d)];
  const stands: Record<string, number> = {};
  for (const [side, s] of [["l", 1], ["r", -1]] as const) {
    const x = at.x + s * (TABLE.w / 2 + 0.4), z = at.z - 0.05;
    // Turned to look at the head: a model faces +z, and rot turns +z toward (sin rot, cos rot).
    const rot = Math.atan2(head.x - x, head.z - z);
    items.push({ key: `${pre}mon-${side}-stand`, gear: "stand-tripod", x, y: 0, z, rot: 0 }, { key: `${pre}mon-${side}`, gear: MONITOR, x, y: pole, z, rot });
    stands[`${pre}mon-${side}-stand`] = pole;
  }
  return { kind, table: { x: at.x, z: at.z, ...TABLE }, head, items, stands };
}

/** Which way a piece on the table faces, and its front edge's z (a piece turned by pi fronts at z - d / 2). */
export function frontEdge(i: Item): number {
  return i.z + Math.cos(i.rot) * (catalog(i.gear).size.d / 2);
}

/** The gaps either side of the mixer, between its edges and each deck's nearer edge. */
export function gaps(b: Booth): [number, number] {
  const [d1, m, d2] = b.items as [Item, Item, Item];
  const w = (i: Item) => catalog(i.gear).size.w / 2;
  return [d1.x - w(d1) - (m.x + w(m)), m.x - w(m) - (d2.x + w(d2))];
}

/** Where a speaker's driver is: up its box by DRIVER. */
export const driverAt = (i: Item) => ({ x: i.x, y: i.y + catalog(i.gear).size.h * DRIVER, z: i.z });

/** How far off its axis a monitor points from the DJ's head, in degrees, across and up. */
export function aimOff(i: Item, head: Booth["head"]): { h: number; v: number } {
  const d = driverAt(i), dx = head.x - d.x, dz = head.z - d.z;
  const want = Math.atan2(dx, dz), across = Math.atan2(Math.sin(want - i.rot), Math.cos(want - i.rot));
  return { h: (Math.abs(across) * 180) / Math.PI, v: (Math.abs(Math.atan2(head.y - d.y, Math.hypot(dx, dz))) * 180) / Math.PI };
}

const vinyl = booth("vinyl");
const media = booth("media");

/** The room: the booth against the back wall, the powered tops either side of it on stands, the sub on a rack, and a case of cables by the door. */
function room(b: Booth, name: string): Level {
  return {
    name,
    bounds: { x0: -3.75, x1: 3.75, z0: 0.25, z1: 8.75 },
    room: { x0: -4, x1: 4, z0: 0, z1: 9, height: 3, door: 1.8 },
    outlets: [
      { key: "wall-1", x: -1.2, y: 0.3, z: 0.01, circuit: "1", amps: 20 },
      { key: "wall-2", x: 1.2, y: 0.3, z: 0.01, circuit: "2", amps: 20 },
    ],
    start: { x: 0, z: 7.5, yaw: 0 },
    items: [
      ...b.items,
      { key: "top-l-stand", gear: "stand-tripod", x: 2.9, y: 0, z: 2.2, rot: 0 },
      { key: "top-l", gear: "top-12-powered", x: 2.9, y: 1.6, z: 2.2, rot: -0.15 },
      { key: "top-r-stand", gear: "stand-tripod", x: -2.9, y: 0, z: 2.2, rot: 0 },
      { key: "top-r", gear: "top-12-powered", x: -2.9, y: 1.6, z: 2.2, rot: 0.15 },
      { key: "sub", gear: "sub-18", x: 0, y: 0, z: 3.0, rot: 0 },
      { key: "rack", gear: "amp-rack-4u", x: -2.9, y: 0, z: 0.5, rot: 0 },
      { key: "distro", gear: "distro-box", x: 0.6, y: 0, z: 0.3, rot: 0 },
      // The cable case behind the booth on the DJ's side, where the short deck leads reach.
      { key: "case", gear: "road-case-m", x: 2.9, y: 0, z: 0.6, rot: 0 },
    ],
    caseLoad: [
      ...[1, 2].map((n) => ({ key: `rca-${n}`, kind: "rca" as const, lengthM: 3 })),
      ...[1, 2].map((n) => ({ key: `ground-${n}`, kind: "ground" as const, lengthM: 3 })),
      ...[1, 2, 3, 4, 5].map((n) => ({ key: `xlr-${n}`, kind: "xlr" as const, lengthM: 10 })),
      { key: "speaker-10", kind: "speaker" as const, lengthM: 10 },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ key: `power-${n}`, kind: "power" as const, lengthM: 5 })),
    ],
  };
}

export const DJ_BOOTH: Level = room(vinyl, "dj-booth");
export const DJ_BOOTH_MEDIA: Level = room(media, "dj-booth-media");

/** The booth a level holds, and its stands' heights (the tops' stands at 1.6 m too). */
export function boothOf(level: Level): Booth {
  const b = level === DJ_BOOTH_MEDIA ? media : vinyl;
  return { ...b, stands: { ...b.stands, "top-l-stand": 1.6, "top-r-stand": 1.6 } };
}

/** Each deck's mixer channel (1 to 4), from the RCA cable in a phono or line input; a deck with none is not in. */
export type Routing = Record<string, number>;

export type BoothJudged = Compiled & {
  routing: Routing;
  /** Decks whose channel hums (a turntable with no ground wire), and decks that distort (line level into phono). */
  hum: string[];
  distort: string[];
  /** Whether the mixer's master reaches a speaker that plays. */
  live: boolean;
  /** Decks with no power: they don't turn. */
  dead: string[];
};

/** Run a booth's patch: what is fed, what is wrong, which channel each deck is in. */
export function judgeBooth(level: Level, placed: readonly Placed[], cables: readonly Cable[]): BoothJudged {
  const outlets = level.outlets.map((o) => ({ id: o.key, circuit: o.circuit ?? level.name, breaker: CIRCUIT_20A }));
  const r = compile(placed, cables, { outlets });
  const decks = new Set(placed.filter((p) => catalog(p.gear).deck).map((p) => p.id));
  const routing: Routing = {};
  for (const c of cables) {
    if (c.kind !== "rca") continue;
    const [deck, mix] = decks.has(c.from[0]) ? [c.from, c.to] : [c.to, c.from];
    const kind = jackKind(mix[1]);
    if (decks.has(deck[0]) && (kind === "phono-in" || kind === "rca-in")) routing[deck[0]] = Number(mix[1].match(/\d+$/)?.[0] ?? 0);
  }
  const of = (kind: string, pick: (m: string) => boolean) => r.problems.filter((p) => p.kind === kind && pick(p.message)).map((p) => p.items[0]!);
  return {
    ...r, routing,
    hum: of("hum", () => true).filter((id) => decks.has(id)),
    distort: of("level", (m) => m.includes("distorts")),
    live: [...r.fed.values()].some(Boolean),
    dead: of("no-power", () => true).filter((id) => decks.has(id)),
  };
}

/** The booth's patch from the cables you have laid. */
export function judgeBoothCables(w: World, c: Cables): BoothJudged {
  const { placed, runs } = plugged(w, c);
  return judgeBooth(w.level, placed, runs);
}
