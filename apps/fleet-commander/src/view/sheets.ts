// The drawing sheets: every hull written down before it is built, the way a maker's drawing sets out a speaker box
// (packages/models gear.ts). Our ships are our own, so these are our drawings: overall length, beam and height in
// metres, and each named piece with its size and place. `ships.ts` builds each piece from its sheet and nothing else.
// Frame: x along the hull (+x is the nose), y up, z across (+z to starboard); the origin is the hull's middle.
// No DOM and no three.js here: a sheet is plain data, so a test or a page can read it.

/** A point in the plan (x, z), metres. */
export type Plan = readonly [x: number, z: number];

/** A hull's sheet: what it is, its overall size, the game length it is drawn at, and its pieces. */
export type HullSheet = {
  id: string;
  /** What the drawing calls it (the same words as `SHIP_NAME`). */
  title: string;
  side: "navy" | "rim";
  /** Overall length, beam and height in metres. */
  length: number; beam: number; height: number;
  /** How long the model is in the battle's units (about `HULL[kind].r * 2`). */
  gameLength: number;
  /** The seed for everything placed by chance (panel plates, lights, point-defence spacing). */
  seed: number;
};

/** The Lance-class destroyer's sheet: an arrowhead slab with a spinal gun down its middle (the lance it is named for),
 *  a swept command fin well aft, a stern block of square drive bells and a ventral hangar slot. */
export type WedgeSheet = HullSheet & {
  /** The hull's plan, the starboard half from the nose to the stern's centre (mirrored for port). */
  plan: readonly Plan[];
  /** The hull edge's thickness, and how high the deck's roof rises over the edge at the spine (and how deep the keel
   *  falls under it). The roof climbs from the nose to full height at `roofFullAt` (x). */
  edge: number; roof: number; keel: number; roofFullAt: number;
  /** The spinal gun: a barrel in a trench along the spine from `from` to `to` (x), its coil rings every `ringPitch`. */
  spinal: { from: number; to: number; radius: number; trenchWide: number; trenchDeep: number; ringPitch: number };
  /** The command fin: a swept blade standing on the spine, its foot from `foot[0]` to `foot[1]` (x), `tall` high,
   *  its top edge `topLength` long and swept back by `sweep`, `thick` across, with a lit window strip near the top. */
  fin: { foot: readonly [number, number]; tall: number; topLength: number; sweep: number; thick: number; windows: number };
  /** The stern block and its drive bells: square nozzles, each `[z, wide, high]`, sunk `depth` into the block. */
  drives: { block: readonly [length: number, wide: number, high: number]; bells: readonly (readonly [z: number, wide: number, high: number])[]; depth: number };
  /** The hangar slot in the belly: from `from` to `to` (x), `wide` across, with a lit lip. */
  hangar: { from: number; to: number; wide: number; deep: number };
  /** Gun turrets on the deck, a pair (one each side) per `[x, across]`, `across` the share of the half beam out from
   *  the spine; each a base `base` across, a housing and two barrels `barrel` long. */
  turrets: { at: readonly (readonly [x: number, across: number])[]; base: number; barrel: number };
  /** Point-defence blisters spaced along each edge, about `pitch` apart, `size` across. */
  pointDefence: { pitch: number; size: number };
  /** Two masts on the fin's top edge, `tall` high, and a dish `dish` across between them. */
  antennae: { tall: number; dish: number };
  /** Panel plates laid on the deck: `count` per side, `size` metres at most, a shade darker than the hull. */
  panels: { count: number; size: number };
  /** Lit windows on the deck, the size of the thing: `count` of them, `size` across. */
  lights: { count: number; size: number };
};

export const LANCE: WedgeSheet = {
  id: "destroyer",
  title: "Lance-class destroyer",
  side: "navy",
  length: 1600, beam: 820, height: 400,
  gameLength: 190,
  seed: 0x1a9ce,
  plan: [[800, 0], [-540, 410], [-760, 300], [-760, 0]],
  edge: 22, roof: 104, keel: 58, roofFullAt: -200,
  spinal: { from: -280, to: 720, radius: 13, trenchWide: 46, trenchDeep: 18, ringPitch: 120 },
  fin: { foot: [-330, -700], tall: 150, topLength: 220, sweep: 140, thick: 26, windows: 9 },
  drives: { block: [70, 360, 92], bells: [[-120, 70, 58], [-40, 56, 70], [40, 56, 70], [120, 70, 58]], depth: 14 },
  hangar: { from: 40, to: -260, wide: 120, deep: 20 },
  turrets: { at: [[260, 0.42], [80, 0.5], [-100, 0.52], [-280, 0.5], [-460, 0.44]], base: 34, barrel: 46 },
  pointDefence: { pitch: 120, size: 12 },
  antennae: { tall: 60, dish: 36 },
  panels: { count: 46, size: 70 },
  lights: { count: 70, size: 6 },
};

/** The Bastion cruiser's sheet: the Compact builds round a girder. A square truss keel runs stern to prow, rib frames
 *  are welded across it, an armoured ram sits on the front, and whatever plate and tankage the yard had is bolted on
 *  between the ribs. One big drive cylinder and two small ones burn orange at the back. */
export type GirderSheet = HullSheet & {
  /** The keel girder: a box truss from `from` to `to` (x), `wide` by `high`, its chords `bar` thick. */
  spine: { from: number; to: number; wide: number; high: number; bar: number; bays: number };
  /** The ram: a side profile (x, y pairs, closed) pushed `wide` across. */
  prow: { profile: readonly Plan[]; wide: number };
  /** Rib frames welded across the keel: `count` of them evenly from `from` to `to` (x), each a rectangle `wide` by
   *  `high` of flat bar `bar` thick. */
  ribs: { from: number; to: number; count: number; wide: number; high: number; bar: number };
  /** Plate and cargo blocks bolted into the bays between ribs: `count` placed by chance, up to `size` metres. */
  modules: { count: number; size: number };
  /** A long fuel tank down each flank, slung from the ribs. */
  tanks: { from: number; to: number; radius: number; z: number; y: number; bands: number };
  /** The bridge cab on stilts over the keel near the ram: `[length, high, wide]` at `x`, `lift` above the keel's top. */
  bridge: { x: number; size: readonly [number, number, number]; lift: number; windows: number };
  /** Broadside guns on sponsons at the ribs' tops, a pair (one each side) per x, each a block and one long barrel. */
  guns: { at: readonly number[]; block: number; barrel: number };
  /** The drive: a cylinder `length` long and `radius` round behind the keel, a flared bell, and two small drives. */
  drive: { length: number; radius: number; bell: number; aux: readonly (readonly [z: number, radius: number])[] };
  /** Weld patches in a lighter ochre over the plates, and lamps. */
  patches: { count: number; size: number };
  lights: { count: number; size: number };
};

export const BASTION: GirderSheet = {
  id: "cruiser",
  title: "Bastion cruiser",
  side: "rim",
  length: 1180, beam: 300, height: 250,
  gameLength: 170,
  seed: 0xb457,
  spine: { from: -470, to: 400, wide: 76, high: 84, bar: 12, bays: 14 },
  prow: { profile: [[380, -70], [500, -70], [565, -24], [565, 30], [510, 74], [380, 74]], wide: 170 },
  ribs: { from: -400, to: 300, count: 7, wide: 220, high: 190, bar: 14 },
  modules: { count: 26, size: 70 },
  tanks: { from: -380, to: 180, radius: 30, z: 98, y: -46, bands: 6 },
  bridge: { x: 290, size: [76, 36, 64], lift: 54, windows: 7 },
  guns: { at: [-280, -40, 200], block: 34, barrel: 96 },
  drive: { length: 70, radius: 66, bell: 70, aux: [[-104, 24], [104, 24]] },
  patches: { count: 40, size: 34 },
  lights: { count: 28, size: 5 },
};

/** The sheets drawn so far, by ship kind. A kind without one keeps its plain shapes in `models.ts`. */
export const SHEETS = { destroyer: LANCE, cruiser: BASTION } as const;
export type SheetKind = keyof typeof SHEETS;
