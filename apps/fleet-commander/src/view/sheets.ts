// The drawing sheets: every hull written down before it is built, the way a maker's drawing sets out a speaker box
// (packages/models gear.ts). Our ships are our own, so these are our drawings: overall length, beam and height in
// metres, and each named piece with its size and place. `ships.ts` builds each piece from its sheet and nothing else.
// Frame: x along the hull (+x is the nose), y up, z across (+z to starboard); the origin is the hull's middle.
// No DOM and no three.js here: a sheet is plain data, so a test or a page can read it. The craft's sheets are in
// `craft-sheets.ts`.
import type { ShipKind } from "../names.ts";
import type { Station } from "./piece.ts";

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

/** What every navy wedge is: an arrowhead slab with its drives in a stern block and the deck dressed with turrets,
 *  point defence, plates and lit windows. */
export type WedgeSheet = HullSheet & {
  /** The hull's plan, the starboard half from the nose to the stern's centre (mirrored for port). */
  plan: readonly Plan[];
  /** The hull edge's thickness, and how high the deck's roof rises over the edge at the spine (and how deep the keel
   *  falls under it). The roof climbs from the nose to full height at `roofFullAt` (x). */
  edge: number; roof: number; keel: number; roofFullAt: number;
  /** The stern block and its drive bells: square nozzles, each `[z, wide, high]`, sunk `depth` into the block. */
  drives: { block: readonly [length: number, wide: number, high: number]; bells: readonly (readonly [z: number, wide: number, high: number])[]; depth: number };
  /** Gun turrets on the deck, a pair (one each side) per `[x, across]`, `across` the share of the half beam out from
   *  the spine; each a base `base` across, a housing and two barrels `barrel` long. */
  turrets: { at: readonly (readonly [x: number, across: number])[]; base: number; barrel: number };
  /** Point-defence blisters spaced along each edge, about `pitch` apart, `size` across. */
  pointDefence: { pitch: number; size: number };
  /** Panel plates laid on the deck: `count` per side, `size` metres at most, a shade darker than the hull. */
  panels: { count: number; size: number };
  /** Lit windows on the deck, the size of the thing: `count` of them, `size` across. */
  lights: { count: number; size: number };
};

/** A spinal gun: a barrel in a trench along the deck from `from` to `to` (x), its coil rings every `ringPitch`. */
export type Spinal = { from: number; to: number; radius: number; trenchWide: number; trenchDeep: number; ringPitch: number };
/** A command fin: a swept blade standing on the deck, its foot from `foot[0]` to `foot[1]` (x), `tall` high, its top
 *  edge `topLength` long and swept back by `sweep`, `thick` across, with a lit window strip near the top. */
export type Fin = { foot: readonly [number, number]; tall: number; topLength: number; sweep: number; thick: number; windows: number };
/** The hangar slot in the belly: from `from` to `to` (x), `wide` across, with a lit lip. */
export type Hangar = { from: number; to: number; wide: number; deep: number };
/** Two masts, `tall` high, and a dish `dish` across between them. */
export type Antennae = { tall: number; dish: number };

/** The Lance-class destroyer's sheet: a wedge with a spinal gun down its middle (the lance it is named for), a swept
 *  command fin well aft and a ventral hangar slot. */
export type LanceSheet = WedgeSheet & { spinal: Spinal; fin: Fin; hangar: Hangar; antennae: Antennae };

export const LANCE: LanceSheet = {
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

/** The Sovereign-class dreadnought's sheet: the navy's longest wedge, two lances run side by side, a terraced citadel
 *  stepping up aft of the middle (lit tier by tier) and a pair of command fins out on the quarters. */
export type DreadnoughtSheet = WedgeSheet & {
  /** The two spinal guns, each `z` out from the centreline. */
  spinal: Spinal & { z: number };
  /** The citadel's terraces from the deck up, each `[x, length, wide, high]`, `windows` along each flank of each. */
  citadel: { tiers: readonly (readonly [x: number, length: number, wide: number, high: number])[]; windows: number };
  fins: Fin & { z: number };
  hangar: Hangar;
  antennae: Antennae;
};

export const SOVEREIGN: DreadnoughtSheet = {
  id: "dreadnought",
  title: "Sovereign-class dreadnought",
  side: "navy",
  length: 3900, beam: 1900, height: 920,
  gameLength: 470,
  seed: 0x50fe,
  // A plan point where the roof peaks (x = roofFullAt), so the hull's ridge is where the guns and citadel stand on it.
  plan: [[1950, 0], [900, 330], [-300, 661], [-1350, 950], [-1850, 700], [-1850, 0]],
  edge: 60, roof: 230, keel: 150, roofFullAt: -300,
  spinal: { from: -250, to: 1780, radius: 26, trenchWide: 92, trenchDeep: 36, ringPitch: 190, z: 90 },
  citadel: { tiers: [[-850, 1100, 520, 90], [-950, 780, 360, 90], [-1030, 500, 240, 90], [-1100, 240, 140, 80]], windows: 14 },
  fins: { foot: [-1200, -1660], tall: 300, topLength: 240, sweep: 190, thick: 40, windows: 8, z: 480 },
  drives: { block: [140, 980, 220], bells: [[-390, 150, 130], [-195, 170, 150], [0, 170, 150], [195, 170, 150], [390, 150, 130]], depth: 30 },
  hangar: { from: -320, to: -1150, wide: 300, deep: 50 },
  turrets: { at: [[900, 0.5], [560, 0.56], [220, 0.6], [-120, 0.6], [-460, 0.62], [-800, 0.64], [-1140, 0.66], [-1480, 0.6]], base: 70, barrel: 100 },
  pointDefence: { pitch: 170, size: 24 },
  antennae: { tall: 130, dish: 90 },
  panels: { count: 110, size: 130 },
  lights: { count: 240, size: 10 },
};

/** The Warden interdictor's sheet: a short, broad wedge that carries its gravity wells on its back: four projector
 *  domes ringed by emitter coils, each a little tower of its own, with a low bridge between them. */
export type InterdictorSheet = WedgeSheet & {
  /** The well projectors, `[x, z, radius]` each, mirrored; `coils` studs round each dome's ring. */
  wells: { at: readonly (readonly [x: number, z: number, radius: number])[]; coils: number };
  bridge: { x: number; size: readonly [length: number, high: number, wide: number]; windows: number };
};

export const WARDEN: InterdictorSheet = {
  id: "frigate",
  title: "Warden interdictor",
  side: "navy",
  length: 720, beam: 420, height: 170,
  gameLength: 90,
  seed: 0x3a2d,
  plan: [[360, 0], [250, 80], [-40, 157], [-240, 210], [-340, 170], [-340, 0]],
  edge: 16, roof: 40, keel: 34, roofFullAt: -40,
  wells: { at: [[40, 74, 46], [-170, 96, 58]], coils: 10 },
  bridge: { x: -270, size: [70, 56, 60], windows: 5 },
  drives: { block: [40, 190, 54], bells: [[-62, 46, 36], [0, 46, 36], [62, 46, 36]], depth: 9 },
  turrets: { at: [[170, 0.5]], base: 22, barrel: 30 },
  pointDefence: { pitch: 100, size: 9 },
  panels: { count: 14, size: 66 },
  lights: { count: 34, size: 4 },
};

/** The Argus sensor ship's sheet: a slim wedge built round what it listens with: a great dish on a pylon, two long
 *  booms of receiver plates out to each side, a row of aerials down the spine and whiskers off the nose. */
export type SensorSheet = WedgeSheet & {
  /** The dish: `radius` across the rim, on a pylon `lift` above the deck at x, tipped forward by `tilt` radians. */
  dish: { x: number; lift: number; radius: number; tilt: number };
  /** The booms: from the hull at x out to `span` either side, `plates` receiver plates `plate` square on each. */
  booms: { x: number; span: number; plates: number; plate: number };
  /** Aerials down the spine from `from` to `to`, `count` of them, `tall` at most. */
  aerials: { from: number; to: number; count: number; tall: number };
  /** Probe whiskers ahead of the nose, `length` long. */
  whiskers: { length: number };
};

export const ARGUS: SensorSheet = {
  id: "sensor",
  title: "Argus sensor ship",
  side: "navy",
  length: 870, beam: 460, height: 270,
  gameLength: 95,
  seed: 0xa49,
  plan: [[380, 0], [-60, 78], [-300, 120], [-380, 90], [-380, 0]],
  edge: 14, roof: 36, keel: 30, roofFullAt: -60,
  dish: { x: -120, lift: 90, radius: 120, tilt: 0.5 },
  booms: { x: -230, span: 230, plates: 4, plate: 34 },
  aerials: { from: 200, to: 20, count: 6, tall: 60 },
  whiskers: { length: 90 },
  drives: { block: [36, 130, 40], bells: [[-34, 36, 28], [34, 36, 28]], depth: 8 },
  turrets: { at: [[-320, 0.4]], base: 18, barrel: 24 },
  pointDefence: { pitch: 120, size: 8 },
  panels: { count: 12, size: 56 },
  lights: { count: 30, size: 4 },
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


/** The Compact corvette's sheet: the least ship you can weld: a short girder, an oversize gun slung under its ram and a
 *  drive far too big for it. */
export type CorvetteSheet = GirderSheet & {
  /** The gun under the keel: a barrel from `from` to `to` (x) at `y`. */
  cannon: { from: number; to: number; radius: number; y: number };
};

export const CORVETTE: CorvetteSheet = {
  id: "corvette",
  title: "Compact corvette",
  side: "rim",
  length: 540, beam: 160, height: 150,
  gameLength: 66,
  seed: 0xc0e,
  spine: { from: -160, to: 140, wide: 44, high: 48, bar: 8, bays: 7 },
  prow: { profile: [[130, -30], [196, -30], [230, -8], [230, 16], [196, 40], [130, 40]], wide: 84 },
  ribs: { from: -120, to: 90, count: 4, wide: 110, high: 100, bar: 9 },
  modules: { count: 10, size: 40 },
  tanks: { from: -120, to: 50, radius: 17, z: 52, y: -26, bands: 3 },
  bridge: { x: 90, size: [44, 24, 40], lift: 28, windows: 5 },
  guns: { at: [-40], block: 20, barrel: 52 },
  drive: { length: 56, radius: 44, bell: 52, aux: [[-62, 15], [62, 15]] },
  cannon: { from: -40, to: 270, radius: 10, y: -50 },
  patches: { count: 18, size: 22 },
  lights: { count: 12, size: 4 },
};

/** The Sower minelayer's sheet: a long, low girder tender with open racks of mines down each flank and a chute off the
 *  stern to drop them from. */
export type MinelayerSheet = GirderSheet & {
  /** The racks, one each side at `z` and `y`, from `from` to `to`, `count` mines each, `mine` metres in radius. */
  racks: { from: number; to: number; z: number; y: number; count: number; mine: number };
  /** The chute: two rails from the keel's stern, `length` long, dropping `drop`, with `count` mines on it. */
  chute: { length: number; drop: number; count: number };
};

export const SOWER: MinelayerSheet = {
  id: "minelayer",
  title: "Sower minelayer",
  side: "rim",
  length: 830, beam: 320, height: 190,
  gameLength: 100,
  seed: 0x50e4,
  spine: { from: -290, to: 270, wide: 56, high: 52, bar: 9, bays: 12 },
  prow: { profile: [[260, -36], [330, -36], [372, -10], [372, 18], [330, 44], [260, 44]], wide: 110 },
  ribs: { from: -250, to: 210, count: 6, wide: 150, high: 110, bar: 10 },
  modules: { count: 12, size: 46 },
  tanks: { from: -200, to: 140, radius: 18, z: 46, y: -40, bands: 4 },
  bridge: { x: 210, size: [56, 30, 52], lift: 36, windows: 5 },
  guns: { at: [150], block: 20, barrel: 46 },
  drive: { length: 50, radius: 40, bell: 44, aux: [[-56, 16], [56, 16]] },
  racks: { from: -230, to: 170, z: 132, y: 0, count: 8, mine: 20 },
  chute: { length: 150, drop: 70, count: 3 },
  patches: { count: 24, size: 24 },
  lights: { count: 16, size: 4 },
};

/** The Hive carrier's sheet: a heavy box keel with a slab of launch cells hung down each flank on pylons, comb on comb
 *  (the hive it is named for), a blunt head with the bridge on top and a cluster of drives. */
export type HiveSheet = HullSheet & {
  /** The keel: a box from `from` to `to` (x), `wide` by `high`, banded every `bands` metres. */
  keel: { from: number; to: number; wide: number; high: number; bands: number };
  /** The head on the keel's front: a side profile pushed `wide` across. */
  head: { profile: readonly Plan[]; wide: number };
  /** The comb slabs, one each side with its middle at `z`, and the pylons (x) that hang them. */
  combs: { from: number; to: number; z: number; wide: number; high: number; pylons: readonly number[] };
  /** Launch cells on each slab's outer face: `rows` of `columns` six-sided mouths, `radius` each. */
  cells: { rows: number; columns: number; radius: number };
  bridge: { x: number; size: readonly [length: number, high: number, wide: number]; lift: number; windows: number };
  /** Drive cylinders behind the keel, `[z, y, radius]`, `length` long. */
  drives: { at: readonly (readonly [z: number, y: number, radius: number])[]; length: number };
  patches: { count: number; size: number };
  lights: { count: number; size: number };
};

export const HIVE: HiveSheet = {
  id: "carrier",
  title: "Hive carrier",
  side: "rim",
  length: 1360, beam: 700, height: 330,
  gameLength: 165,
  seed: 0x41fe,
  keel: { from: -540, to: 460, wide: 170, high: 130, bands: 140 },
  head: { profile: [[440, -80], [600, -80], [680, -30], [680, 36], [600, 90], [440, 90]], wide: 230 },
  combs: { from: -430, to: 330, z: 270, wide: 140, high: 190, pylons: [-340, -60, 220] },
  cells: { rows: 3, columns: 11, radius: 28 },
  bridge: { x: 400, size: [130, 54, 120], lift: 60, windows: 9 },
  drives: { at: [[-56, 0, 50], [56, 0, 50], [-260, 0, 44], [260, 0, 44]], length: 130 },
  patches: { count: 60, size: 46 },
  lights: { count: 44, size: 7 },
};

/** The Tidewall bulwark's sheet: a long swollen body that looks grown more than built, a deeper belly under it, iron
 *  belts round its girth, rows of shield blisters and the horns that throw the shield. */
export type BulwarkSheet = HullSheet & {
  /** The body and the belly slung under it (its stations already placed `drop` down). */
  body: readonly Station[];
  belly: { stations: readonly Station[]; drop: number };
  /** Iron belts round the body at these stations (indices into `body`), `bar` thick. */
  belts: { at: readonly number[]; bar: number };
  /** Rings of shield blisters, `[x, count]` each, `size` in radius. */
  blisters: { rings: readonly (readonly [x: number, count: number])[]; size: number };
  /** Shield horns, a pair (one each side) per x, `tall` high. */
  horns: { at: readonly number[]; tall: number };
  guns: { at: readonly number[]; block: number; barrel: number };
  drives: { at: readonly (readonly [z: number, radius: number])[]; length: number };
  patches: { count: number; size: number };
  lights: { count: number; size: number };
};

export const TIDEWALL: BulwarkSheet = {
  id: "bulwark",
  title: "Tidewall bulwark",
  side: "rim",
  length: 1600, beam: 880, height: 540,
  gameLength: 190,
  seed: 0x71de,
  body: [[-720, 150, 100, 90], [-540, 300, 190, 130], [-200, 410, 250, 160], [200, 400, 240, 160], [520, 290, 180, 120], [720, 130, 90, 70], [800, 30, 30, 24]],
  belly: { stations: [[-560, 90, 40, 40], [-200, 220, 70, 90], [200, 210, 70, 90], [480, 70, 30, 30]], drop: 130 },
  belts: { at: [1, 2, 3, 4], bar: 26 },
  blisters: { rings: [[-460, 5], [-200, 7], [60, 7], [320, 6], [540, 4]], size: 52 },
  horns: { at: [-370, 130], tall: 150 },
  guns: { at: [-60, 420], block: 70, barrel: 160 },
  drives: { at: [[-90, 56], [90, 56]], length: 90 },
  patches: { count: 40, size: 80 },
  lights: { count: 60, size: 9 },
};

/** The Orbital bastion's sheet: a spindle with a welded ring round it (straight lengths, not a true circle), spokes
 *  out to it, whatever modules the yard could spare bolted round the rim, four docking arms, guns, and a listening
 *  dish and mast on top. It turns about its spindle. */
export type StationSheet = HullSheet & {
  spindle: { radius: number; from: number; to: number; collars: number };
  ring: { radius: number; sides: number; wide: number; high: number };
  spokes: { count: number; wide: number };
  modules: { count: number; size: number };
  /** Docking arms out past the ring, ending `reach` from the spindle. */
  docks: { count: number; reach: number; wide: number };
  guns: { count: number; block: number; barrel: number };
  dish: { radius: number; y: number };
  mast: { tall: number };
  lights: { count: number; size: number };
};

export const ORBITAL: StationSheet = {
  id: "station",
  title: "Orbital bastion",
  side: "rim",
  length: 1420, beam: 1420, height: 720,
  gameLength: 170,
  seed: 0x0b17,
  spindle: { radius: 120, from: -250, to: 250, collars: 4 },
  ring: { radius: 560, sides: 16, wide: 90, high: 70 },
  spokes: { count: 8, wide: 40 },
  modules: { count: 28, size: 110 },
  docks: { count: 4, reach: 710, wide: 50 },
  guns: { count: 8, block: 60, barrel: 130 },
  dish: { radius: 160, y: 320 },
  mast: { tall: 180 },
  lights: { count: 80, size: 10 },
};

/** Every hull's sheet, by ship kind. */
export const SHEETS = {
  dreadnought: SOVEREIGN, destroyer: LANCE, frigate: WARDEN, sensor: ARGUS,
  corvette: CORVETTE, cruiser: BASTION, carrier: HIVE, station: ORBITAL, bulwark: TIDEWALL, minelayer: SOWER,
} as const satisfies Record<ShipKind, HullSheet>;
