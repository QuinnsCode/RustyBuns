// The craft's drawing sheets, one per side and role: the same idea as the hulls' (`sheets.ts`), but a craft is drawn
// as an `InstancedMesh` of hundreds, so its whole sheet bakes to one geometry (`craft.ts`). Metres, x along the
// craft (+x is the nose), y up, z across (+z to starboard). Plain data: no DOM and no three.js here.
import type { Role, Side } from "../names.ts";
import type { Station } from "./piece.ts";
import type { Plan } from "./sheets.ts";

/** What a part is painted: the side's plate, its second shade, its dark frame, the canopy glass or a lit nozzle. */
export type Paint = "hull" | "plate" | "dark" | "glass" | "glow";

export type CraftSheet = {
  /** The craft's name (the same word as `CRAFT_NAME`). */
  title: string;
  side: Side; role: Role;
  /** Overall length, beam and height in metres, and how long it is drawn in the battle's units (larger than life, so
   *  a wing reads at fleet scale). */
  length: number; beam: number; height: number;
  gameLength: number;
  /** Lofted bodies (stern station first), each `[z, y]` off the centreline, painted `paint`. */
  bodies: readonly { stations: readonly Station[]; z?: number; y?: number; paint: Paint }[];
  /** Wings, each the starboard plan (x, z) mirrored to port, `thick` through at height `y`, tips hung `droop` radians. */
  wings: readonly { plan: readonly Plan[]; y: number; thick: number; droop?: number; paint: Paint }[];
  /** Fins, a side profile (x, y) from height `y`, a pair at ±z leaning out `cant` radians (one alone when z is 0). */
  fins: readonly { profile: readonly Plan[]; y: number; z: number; cant: number; thick: number; paint: Paint }[];
  /** Guns, booms, torpedoes and struts: round, from (x0) to (x1) at (y, z), a pair when `mirror`. */
  rods: readonly { x0: number; x1: number; y: number; z: number; radius: number; mirror?: boolean; paint: Paint }[];
  /** Blocks: size (length, high, wide) at (x, y, z), a pair when `mirror`. */
  blocks: readonly { size: readonly [number, number, number]; at: readonly [number, number, number]; mirror?: boolean; paint: Paint }[];
  /** Drive nozzles looking aft, `[x, y, z, radius]`. */
  drives: readonly (readonly [x: number, y: number, z: number, radius: number])[];
};

/** The Dart: the navy's interceptor, a needle with a cropped delta and two canted tails. */
const DART: CraftSheet = {
  title: "Dart", side: "navy", role: "interceptor",
  length: 19, beam: 13, height: 4.4, gameLength: 17,
  bodies: [
    { stations: [[-8, 1.3, 1.1, 0.9], [-2, 1.7, 1.4, 1], [4, 1, 0.9, 0.7], [10, 0, 0, 0]], paint: "hull" },
    { stations: [[-0.5, 0.7, 0.4, 0], [2, 0.7, 0.9, 0], [4.5, 0, 0, 0]], y: 1, paint: "glass" },
  ],
  wings: [{ plan: [[2.5, 1], [-5, 6.5], [-7.5, 6.5], [-7, 1]], y: -0.2, thick: 0.45, paint: "plate" }],
  fins: [{ profile: [[-4.5, 0], [-7.8, 2.8], [-9, 2.8], [-8, 0]], y: 0.6, z: 1, cant: 0.5, thick: 0.25, paint: "hull" }],
  rods: [{ x0: -4, x1: 1.5, y: -0.4, z: 4, radius: 0.28, mirror: true, paint: "dark" }],
  blocks: [],
  drives: [[-9, 0, 0, 1]],
};

/** The Maul: the navy's bomber, deep and blunt, a torpedo hung under each short wing. */
const MAUL: CraftSheet = {
  title: "Maul", side: "navy", role: "bomber",
  length: 19, beam: 15, height: 6, gameLength: 18,
  bodies: [
    { stations: [[-8, 2.6, 2, 1.6], [-3, 3, 2.4, 1.8], [5, 2.6, 1.8, 1.6], [9, 1.3, 0.8, 0.9]], paint: "hull" },
    { stations: [[2, 1.2, 0.5, 0], [4.5, 1.2, 0.8, 0], [7, 0.6, 0.2, 0]], y: 1.6, paint: "glass" },
  ],
  wings: [{ plan: [[1, 2.4], [-3, 7.5], [-7, 7.5], [-7, 2.4]], y: 0.4, thick: 0.8, droop: 0.12, paint: "plate" }],
  fins: [{ profile: [[-4, 0], [-7, 2.4], [-9, 2.4], [-8, 0]], y: 1.8, z: 1.8, cant: 0.25, thick: 0.4, paint: "dark" }],
  rods: [{ x0: -5, x1: 6.5, y: -1.7, z: 4.4, radius: 0.85, mirror: true, paint: "dark" }],
  blocks: [{ size: [3, 1.2, 0.6], at: [-2, -0.8, 4.4], mirror: true, paint: "dark" }],
  drives: [[-9, 0, -1.5, 1.1], [-9, 0, 1.5, 1.1]],
};

/** The Warden: the navy's escort, a short pod between two booms, a gun in the nose of each. */
const WARDEN_CRAFT: CraftSheet = {
  title: "Warden", side: "navy", role: "escort",
  length: 17, beam: 13, height: 4.8, gameLength: 16,
  bodies: [
    { stations: [[-4, 1.6, 1.3, 1], [1, 1.9, 1.6, 1.1], [7, 0.5, 0.4, 0.4]], paint: "hull" },
    { stations: [[-0.5, 0.9, 0.4, 0], [1.5, 0.9, 0.9, 0], [4, 0.2, 0.1, 0]], y: 1.1, paint: "glass" },
    { stations: [[-8, 0.9, 0.9, 0.9], [2, 1.1, 1.1, 1.1], [5, 0.5, 0.5, 0.5]], z: 5, paint: "plate" },
    { stations: [[-8, 0.9, 0.9, 0.9], [2, 1.1, 1.1, 1.1], [5, 0.5, 0.5, 0.5]], z: -5, paint: "plate" },
  ],
  wings: [{ plan: [[1.5, 0], [-1, 6.4], [-4.5, 6.4], [-3, 0]], y: 0, thick: 0.5, paint: "hull" }],
  fins: [{ profile: [[-4, 0], [-6.5, 2.6], [-8.2, 2.6], [-8, 0]], y: 0.7, z: 5, cant: 0.15, thick: 0.25, paint: "dark" }],
  rods: [{ x0: 3, x1: 9, y: 0, z: 5, radius: 0.3, mirror: true, paint: "dark" }],
  blocks: [],
  drives: [[-8, 0, -5, 0.75], [-8, 0, 5, 0.75]],
};

/** The Kite: the navy's scout, a thin body with a long sensor probe, a diamond wing and a tall single fin. */
const KITE: CraftSheet = {
  title: "Kite", side: "navy", role: "scout",
  length: 23, beam: 11, height: 5, gameLength: 20,
  bodies: [
    { stations: [[-8, 0.7, 0.7, 0.6], [-1, 1.2, 1.1, 0.8], [8, 0.3, 0.3, 0.3]], paint: "hull" },
    { stations: [[1, 0.5, 0.2, 0], [3, 0.5, 0.7, 0], [5.5, 0, 0, 0]], y: 0.7, paint: "glass" },
  ],
  wings: [{ plan: [[3, 0.6], [-1.5, 5.5], [-6, 0.6]], y: 0, thick: 0.3, paint: "plate" }],
  fins: [{ profile: [[-3.5, 0], [-7, 3.6], [-8.5, 3.6], [-7.5, 0]], y: 0.6, z: 0, cant: 0, thick: 0.25, paint: "hull" }],
  rods: [{ x0: 7.5, x1: 14, y: 0, z: 0, radius: 0.18, paint: "dark" }, { x0: -2.5, x1: 0.5, y: 0, z: 5.2, radius: 0.35, mirror: true, paint: "dark" }],
  blocks: [{ size: [0.3, 1.6, 1.6], at: [11.5, 0, 0], paint: "dark" }],
  drives: [[-9, 0, 0, 0.7]],
};

/** The Hornet: the Compact's interceptor, a bare drive can with a cab on a girder ahead of it and stub wings. */
const HORNET: CraftSheet = {
  title: "Hornet", side: "rim", role: "interceptor",
  length: 17, beam: 12, height: 5, gameLength: 16,
  bodies: [
    { stations: [[-7, 2.1, 2.1, 2.1], [-2, 2.1, 2.1, 2.1], [-1, 1.2, 1.2, 1.2]], paint: "hull" },
    { stations: [[3, 1.3, 1.1, 0.9], [6, 1.5, 1.2, 1], [9, 0.6, 0.4, 0.5]], paint: "plate" },
    { stations: [[4, 0.8, 0.3, 0], [6, 0.8, 0.6, 0], [8, 0.3, 0.1, 0]], y: 1, paint: "glass" },
  ],
  wings: [{ plan: [[-2.5, 1.8], [-1.5, 6], [-4, 6], [-6.5, 1.8]], y: 0.2, thick: 0.6, droop: 0.28, paint: "plate" }],
  fins: [],
  rods: [
    { x0: -2, x1: 4, y: 0.5, z: 0.8, radius: 0.28, mirror: true, paint: "dark" },
    { x0: -3, x1: 5, y: -1.5, z: 5.4, radius: 0.4, mirror: true, paint: "dark" },
  ],
  blocks: [{ size: [1, 5.2, 0.6], at: [-4, 0, 0], paint: "dark" }],
  drives: [[-8, 0, 0, 1.8]],
};

/** The Lancer: the Compact's bomber, one huge torpedo slung under a beam, the cab bolted on to port of it. */
const LANCER: CraftSheet = {
  title: "Lancer", side: "rim", role: "bomber",
  length: 22, beam: 12, height: 6, gameLength: 18,
  bodies: [
    { stations: [[-7, 1.2, 1.2, 1.2], [8, 1.5, 1.5, 1.5], [12, 0.3, 0.3, 0.3]], y: -1.4, paint: "dark" },
    { stations: [[-4, 1.4, 1.2, 1], [1, 1.6, 1.4, 1], [4, 0.8, 0.6, 0.6]], z: -3.2, y: 1.2, paint: "hull" },
    { stations: [[0, 0.8, 0.3, 0], [1.8, 0.8, 0.7, 0], [3.4, 0.4, 0.1, 0]], z: -3.2, y: 2.4, paint: "glass" },
  ],
  wings: [{ plan: [[-1, 0], [-2, 6], [-5.5, 6], [-6, 0]], y: 0.8, thick: 0.5, paint: "plate" }],
  fins: [{ profile: [[-6, 0], [-7.5, 2.4], [-9, 2.4], [-9, 0]], y: 1, z: 0, cant: 0, thick: 0.4, paint: "hull" }],
  rods: [{ x0: -9, x1: -2, y: 0.8, z: 3.4, radius: 1.2, paint: "plate" }],
  blocks: [{ size: [11, 0.9, 1.2], at: [-3.5, 0.7, 0], paint: "dark" }, { size: [1.4, 2.4, 0.8], at: [1, -0.1, 0], paint: "dark" }],
  drives: [[-10, 0.8, 0, 0.9], [-9, 0.8, 3.4, 1.1]],
};

/** The Shrike: the Compact's escort, wings swept forward with a long gun at each tip. */
const SHRIKE: CraftSheet = {
  title: "Shrike", side: "rim", role: "escort",
  length: 18, beam: 15, height: 4.6, gameLength: 16,
  bodies: [
    { stations: [[-8, 1.8, 1.5, 1.2], [-3, 2, 1.7, 1.3], [5, 0.9, 0.8, 0.8], [7, 0.4, 0.3, 0.3]], paint: "hull" },
    { stations: [[-1, 0.9, 0.4, 0], [1, 0.9, 0.9, 0], [3.5, 0.3, 0.1, 0]], y: 1.2, paint: "glass" },
  ],
  wings: [{ plan: [[-4, 1.6], [3.5, 7], [1, 7], [-7.5, 1.6]], y: 0, thick: 0.6, paint: "plate" }],
  fins: [{ profile: [[-4.5, 0], [-5.5, 2], [-8, 2], [-8, 0]], y: 1.2, z: 1.2, cant: 0.6, thick: 0.35, paint: "dark" }],
  rods: [{ x0: -0.5, x1: 9, y: 0, z: 7, radius: 0.45, mirror: true, paint: "dark" }],
  blocks: [{ size: [3, 1.1, 1.1], at: [1.5, 0, 7], mirror: true, paint: "hull" }],
  drives: [[-9, 0, 0, 1.4]],
};

/** The Moth: the Compact's scout, nearly all wing: broad scalloped sails hung from a small body, two feelers ahead. */
const MOTH: CraftSheet = {
  title: "Moth", side: "rim", role: "scout",
  length: 17, beam: 16, height: 3.2, gameLength: 17,
  bodies: [
    { stations: [[-6, 0.5, 0.5, 0.5], [0, 1.2, 1.1, 1], [4, 0.8, 0.7, 0.7]], paint: "dark" },
    { stations: [[1.2, 0.5, 0.2, 0], [2.4, 0.5, 0.6, 0], [3.8, 0.2, 0.1, 0]], y: 0.7, paint: "glass" },
  ],
  wings: [
    { plan: [[2.5, 0.8], [3.5, 6], [1, 8.5], [-1, 6.5], [-0.5, 0.8]], y: 0.2, thick: 0.25, droop: 0.2, paint: "plate" },
    { plan: [[-1, 0.8], [-2.5, 5], [-5, 6], [-5.5, 3.5], [-4.5, 0.8]], y: 0, thick: 0.25, droop: 0.32, paint: "hull" },
  ],
  fins: [],
  rods: [{ x0: 3, x1: 10, y: 0.6, z: 1.6, radius: 0.14, mirror: true, paint: "dark" }],
  blocks: [{ size: [1, 0.8, 0.8], at: [10, 0.6, 1.6], mirror: true, paint: "hull" }],
  drives: [[-7, 0, 0, 0.7]],
};

export const CRAFT_SHEETS: Record<Side, Record<Role, CraftSheet>> = {
  navy: { interceptor: DART, bomber: MAUL, escort: WARDEN_CRAFT, scout: KITE },
  rim: { interceptor: HORNET, bomber: LANCER, escort: SHRIKE, scout: MOTH },
};
