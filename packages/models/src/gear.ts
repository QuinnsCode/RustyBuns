// Load In's gear, grown in code: speakers, a sub, a wedge, stands, guitar amps, a rolling amp rack, cases, a cable
// ramp, a generator, a distro box, a mixer, a mic stand and a guitar. Generic boxes named for what they are, at
// the real sizes of #4849's table (width x height x depth = x, y, z, in metres), feet on the floor at y = 0,
// centred on x and z, the front facing +z. Each app brings its own materials (`GearLook`, one per slot).
//
// Every model marks where things attach, as empty Object3Ds the app finds by name:
//   jack:<id>   a socket on its real panel, its +z pointing out of the panel (a plug comes in along -z)
//   grab        where a hand holds it to carry it
//   pole        the top of a stand or a sub's pole socket, +z up: a top's `pole-cup` sits on it
//   pole-cup    the socket under a top, +z down
//   link-a/b    a cable ramp's ends, +z out along the run, so ramps link end to end
//
// Geometry is built once per id (and stand height) and shared by every copy; each call makes new meshes only.
import * as THREE from "three";
import { clamp } from "@rustybuns/util";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Piece, R, along, box, loft } from "./shapes.ts";

export type GearId = keyof typeof GEAR_SIZES;

/** Width x height x depth in metres, from #4849's table. */
export const GEAR_SIZES = {
  "top-12-powered": [0.37, 0.6, 0.36],
  "top-15-passive": [0.45, 0.72, 0.42],
  "sub-18": [0.55, 0.7, 0.75],
  "wedge-12": [0.6, 0.35, 0.42],
  "amp-head": [0.7, 0.27, 0.25],
  "cab-4x12": [0.76, 0.76, 0.36],
  "amp-rack-4u": [0.6, 0.4, 0.65],
  "mixer-small": [0.4, 0.1, 0.35],
  "generator-7kva": [0.7, 0.6, 0.55],
  "distro-box": [0.4, 0.3, 0.25],
  "cable-ramp-2ch": [0.9, 0.08, 0.5],
  "road-case-m": [0.6, 0.5, 0.5],
  "stand-tripod": [0.9, 1.2, 0.9],
  "mic-stand": [0.6, 1.6, 0.6],
  "line-array-box": [1.0, 0.32, 0.55],
  "bar-cooler": [0.9, 0.9, 0.6],
  guitar: [0.33, 1.0, 0.05],
} as const satisfies Record<string, THREE.Vector3Tuple>;

export const GEAR_IDS = Object.keys(GEAR_SIZES) as GearId[];

const SLOTS = ["paint", "grille", "metal", "rubber", "panel", "lid", "tolex", "body", "chrome", "knob", "light"] as const;
export type GearSlot = (typeof SLOTS)[number];
/** A material per slot: paint (cabinets), grille, metal (frames, poles), rubber (feet, wheels, ramp), panel (jack
 * plates), lid (the ramp's yellow lid), tolex (guitar amps), body (the guitar), chrome, knob, light (LEDs). */
export type GearLook = Record<GearSlot, THREE.Material>;

export function gearLook(): GearLook {
  const std = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    paint: std(0x1d1e20, 0.85), grille: std(0x2c2e31, 0.55, 0.6), metal: std(0x8a8d92, 0.4, 0.8), rubber: std(0x121212, 0.95),
    panel: std(0x3a3c40, 0.6, 0.3), lid: std(0xf2c230, 0.6), tolex: std(0x161514, 0.9), body: std(0x8f1f1f, 0.3, 0.1),
    chrome: std(0xd8dade, 0.15, 1), knob: std(0x0c0c0c, 0.5), light: new THREE.MeshBasicMaterial({ color: 0x45e06a }),
  };
}

type Mark = { name: string; at: THREE.Vector3Tuple; out: THREE.Vector3Tuple };
type Build = { pieces: Piece[]; marks: Mark[] };

// ---- pieces ---------------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

/** A rod from a to b (a pole, a leg, a frame tube). */
function rod(slot: GearSlot, a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, r: number, seg = 6): Piece {
  const va = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(va), len = d.length();
  const m = new THREE.Matrix4().compose(va.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1));
  return loft(slot, [R(-len / 2, r), R(len / 2, r)], { seg, m });
}

/** A short cylinder along an axis: a wheel, a knob, a cone ring, a socket. */
function disc(slot: GearSlot, r: number, len: number, axis: "x" | "y" | "z", at: THREE.Vector3Tuple, seg = 8): Piece {
  const m = axis === "y" ? new THREE.Matrix4().makeTranslation(...at) : along(axis, at);
  return loft(slot, [R(-len / 2, r), R(len / 2, r)], { seg, m });
}

/** The convex hull of a side profile (z, y pairs) pushed `wide` across x, centred at x = cx. */
function prism(slot: GearSlot, profile: [number, number][], wide: number, cx = 0): Piece {
  const pts = profile.flatMap(([z, y]) => [new THREE.Vector3(cx - wide / 2, y, z), new THREE.Vector3(cx + wide / 2, y, z)]);
  let geo: THREE.BufferGeometry = new ConvexGeometry(pts);
  for (const k of Object.keys(geo.attributes)) if (k !== "position") geo.deleteAttribute(k);
  geo = geo.index ? geo.toNonIndexed() : geo;
  geo.computeVertexNormals();
  return { geo, slot };
}

/** A carry handle: a bar on two posts, standing out of a face along `out`. */
function handle(slot: GearSlot, at: THREE.Vector3Tuple, out: "x" | "-x" | "y" | "z" | "-z", span = 0.12, rise = 0.03): Piece[] {
  const [x, y, z] = at, s = span / 2;
  const n: THREE.Vector3Tuple = out === "x" ? [rise, 0, 0] : out === "-x" ? [-rise, 0, 0] : out === "y" ? [0, rise, 0] : out === "z" ? [0, 0, rise] : [0, 0, -rise];
  // along the face: across x for y/z faces, across z for x faces
  const t: THREE.Vector3Tuple = out === "x" || out === "-x" ? [0, 0, s] : [s, 0, 0];
  const p = (k: number, lift: number): THREE.Vector3Tuple => [x + t[0] * k + n[0] * lift, y + t[1] * k + n[1] * lift, z + t[2] * k + n[2] * lift];
  return [rod(slot, p(-1, 0), p(-1, 1), 0.008, 4), rod(slot, p(1, 0), p(1, 1), 0.008, 4), rod(slot, p(-1, 1), p(1, 1), 0.01, 6)];
}

type Face = "front" | "back" | "top" | "left" | "right";
const NORMAL: Record<Face, THREE.Vector3Tuple> = { front: [0, 0, 1], back: [0, 0, -1], top: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };

/** Sockets in a row on a face, each a ring with a mark. `at` is the face point of the first, `step` to the next. */
function jacks(b: Build, names: string[], face: Face, at: THREE.Vector3Tuple, step: THREE.Vector3Tuple, r = 0.012) {
  const out = NORMAL[face], axis = face === "top" ? "y" : face === "front" || face === "back" ? "z" : "x";
  names.forEach((name, i) => {
    const p: THREE.Vector3Tuple = [at[0] + step[0] * i, at[1] + step[1] * i, at[2] + step[2] * i];
    const c: THREE.Vector3Tuple = [p[0] + out[0] * 0.004, p[1] + out[1] * 0.004, p[2] + out[2] * 0.004];
    b.pieces.push(disc("chrome", r, 0.008, axis, c, 6));
    b.marks.push({ name: `jack:${name}`, at: [p[0] + out[0] * 0.008, p[1] + out[1] * 0.008, p[2] + out[2] * 0.008], out });
  });
}

const mark = (b: Build, name: string, at: THREE.Vector3Tuple, out: THREE.Vector3Tuple = [0, 1, 0]) => b.marks.push({ name, at, out });
const numbered = (stem: string, n: number) => Array.from({ length: n }, (_, i) => `${stem}-${i + 1}`);

// ---- the gear -------------------------------------------------------------------------------------------------

/** A speaker box: cabinet, front grille, top handle, rubber feet, a back panel and a pole cup underneath. */
function speaker([w, h, d]: readonly number[], backJacks: string[], powered: boolean): Build {
  const b: Build = { pieces: [], marks: [] }, body = h - 0.025;
  b.pieces.push(box("paint", [w, body - 0.01, d], [0, 0.01 + (body - 0.01) / 2, 0], { bevel: 0.02 }));
  b.pieces.push(box("grille", [w - 0.04, body - 0.08, 0.012], [0, 0.01 + (body - 0.01) / 2, d / 2 - 0.004], { bevel: 0.004 }));
  b.pieces.push(...handle("metal", [0, body, 0], "y", w * 0.4, 0.025));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.018, 0.01, "y", [x * (w / 2 - 0.04), 0.005, z * (d / 2 - 0.04)], 6));
  b.pieces.push(disc("metal", 0.02, 0.012, "y", [0, 0.006, 0], 8));
  const ph = powered ? h * 0.4 : h * 0.18, py = powered ? h * 0.32 : h * 0.3;
  b.pieces.push(box("panel", [w * 0.62, ph, 0.01], [0, py, -d / 2 - 0.003]));
  if (powered) b.pieces.push(disc("light", 0.004, 0.006, "z", [w * 0.22, py + ph * 0.38, -d / 2 - 0.009], 4));
  const gap = (w * 0.5) / Math.max(1, backJacks.length - 1);
  jacks(b, backJacks, "back", [-w * 0.25, py - (powered ? ph * 0.15 : 0), -d / 2 - 0.008], [gap, 0, 0]);
  mark(b, "grab", [0, body + 0.025, 0]);
  mark(b, "pole-cup", [0, 0.012, 0], [0, -1, 0]);
  return b;
}

function sub(): Build {
  const [w, h, d] = GEAR_SIZES["sub-18"], b: Build = { pieces: [], marks: [] };
  b.pieces.push(box("paint", [w, h - 0.02, d], [0, 0.01 + (h - 0.02) / 2, 0], { bevel: 0.02 }));
  b.pieces.push(box("grille", [w - 0.05, h - 0.08, 0.012], [0, h / 2, d / 2 - 0.004], { bevel: 0.004 }));
  for (const x of [-1, 1]) b.pieces.push(...handle("metal", [x * w / 2, h * 0.6, 0], x > 0 ? "x" : "-x", 0.14, 0.012));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.02, 0.01, "y", [x * (w / 2 - 0.05), 0.005, z * (d / 2 - 0.05)], 6));
  b.pieces.push(disc("metal", 0.025, 0.006, "y", [0, h - 0.008, 0], 8));
  b.pieces.push(box("panel", [w * 0.4, h * 0.16, 0.01], [0, h * 0.25, -d / 2 - 0.003]));
  jacks(b, ["speaker-in", "speaker-out"], "back", [-w * 0.08, h * 0.25, -d / 2 - 0.008], [w * 0.16, 0, 0]);
  mark(b, "grab", [w / 2 + 0.012, h * 0.6, 0], [1, 0, 0]);
  mark(b, "pole", [0, h - 0.005, 0], [0, 1, 0]);
  return b;
}

/** A floor monitor: a wedge whose long sloped face (the grille) looks up at the player. */
function wedge(): Build {
  const [w, h, d] = GEAR_SIZES["wedge-12"], b: Build = { pieces: [], marks: [] };
  const lo = 0.08, backTop = -d / 2 + 0.07;
  b.pieces.push(prism("paint", [[-d / 2, 0.01], [d / 2, 0.01], [d / 2, lo], [backTop, h], [-d / 2, h]], w));
  // the grille on the slope, from (d/2, lo) to (backTop, h)
  const dz = backTop - d / 2, dy = h - lo, len = Math.hypot(dz, dy), tilt = Math.atan2(-dz, dy);
  const n = new THREE.Vector3(0, -dz, dy).normalize().multiplyScalar(0.003);
  b.pieces.push(box("grille", [w - 0.06, 0.012, len - 0.04], [0, (lo + h) / 2 + n.y, (d / 2 + backTop) / 2 + n.z], { rot: [tilt, 0, 0] }));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.016, 0.01, "y", [x * (w / 2 - 0.05), 0.005, z * (d / 2 - 0.05)], 6));
  b.pieces.push(...handle("metal", [0, h * 0.62, -d / 2], "-z", 0.14, 0.02));
  b.pieces.push(box("panel", [w * 0.3, h * 0.2, 0.01], [w * 0.28, h * 0.25, -d / 2 - 0.003]));
  jacks(b, ["power-in", "xlr-in", "xlr-out"], "back", [w * 0.2, h * 0.25, -d / 2 - 0.008], [w * 0.08, 0, 0]);
  mark(b, "grab", [0, h * 0.62, -d / 2 - 0.02], [0, 0, -1]);
  return b;
}

function ampHead(): Build {
  const [w, h] = GEAR_SIZES["amp-head"], d = GEAR_SIZES["amp-head"][2] - 0.03, b: Build = { pieces: [], marks: [] }, body = h - 0.03;
  b.pieces.push(box("tolex", [w, body - 0.012, d], [0, 0.012 + (body - 0.012) / 2, 0], { bevel: 0.012 }));
  b.pieces.push(box("panel", [w - 0.05, body * 0.42, 0.008], [0, body * 0.32, d / 2]));
  for (let i = 0; i < 8; i++) b.pieces.push(disc("knob", 0.011, 0.018, "z", [-w * 0.3 + i * w * 0.07, body * 0.32, d / 2 + 0.009], 6));
  b.pieces.push(disc("light", 0.006, 0.01, "z", [w * 0.36, body * 0.32, d / 2 + 0.004], 4));
  b.pieces.push(...handle("rubber", [0, body, 0], "y", 0.22, 0.03));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.012, 0.012, "y", [x * (w / 2 - 0.05), 0.006, z * (d / 2 - 0.04)], 6));
  jacks(b, ["inst-in"], "front", [-w * 0.4, body * 0.32, d / 2 + 0.004], [0, 0, 0], 0.01);
  b.pieces.push(box("panel", [w * 0.4, body * 0.5, 0.008], [0, body * 0.42, -d / 2 - 0.002]));
  jacks(b, ["speaker-out-1", "speaker-out-2", "power-in"], "back", [-w * 0.12, body * 0.42, -d / 2 - 0.006], [w * 0.12, 0, 0]);
  mark(b, "grab", [0, h, 0]);
  return b;
}

function cab4x12(): Build {
  const [w, h, d] = GEAR_SIZES["cab-4x12"], b: Build = { pieces: [], marks: [] };
  b.pieces.push(box("tolex", [w, h - 0.015, d], [0, 0.015 + (h - 0.015) / 2, 0], { bevel: 0.02 }));
  b.pieces.push(box("grille", [w - 0.07, h - 0.08, 0.01], [0, h / 2, d / 2 - 0.003], { bevel: 0.003 }));
  for (const x of [-1, 1]) b.pieces.push(...handle("rubber", [x * w / 2, h * 0.62, 0], x > 0 ? "x" : "-x", 0.16, 0.012));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.015, 0.015, "y", [x * (w / 2 - 0.05), 0.0075, z * (d / 2 - 0.05)], 6));
  b.pieces.push(box("panel", [0.12, 0.08, 0.008], [0, h * 0.3, -d / 2 - 0.002]));
  jacks(b, ["speaker-in"], "back", [0, h * 0.3, -d / 2 - 0.006], [0, 0, 0]);
  mark(b, "grab", [w / 2 + 0.012, h * 0.62, 0], [1, 0, 0]);
  return b;
}

/** A rolling rack: a case on casters with its front lid off, two power amps in the rails. */
function ampRack(): Build {
  const [w, h, d] = GEAR_SIZES["amp-rack-4u"], b: Build = { pieces: [], marks: [] }, wheel = 0.035, floor = wheel * 2 + 0.005;
  const ch = h - floor;
  b.pieces.push(box("paint", [w, ch, d - 0.02], [0, floor + ch / 2, -0.01], { bevel: 0.012 }));
  for (let i = 0; i < 2; i++) {
    const y = floor + ch * (0.27 + i * 0.47);
    b.pieces.push(box("panel", [w - 0.04, ch * 0.42, 0.012], [0, y, d / 2 - 0.016]));
    for (const x of [-1, 1]) b.pieces.push(...handle("chrome", [x * (w / 2 - 0.045), y, d / 2 - 0.01], "z", ch * 0.25, 0.008));
    b.pieces.push(disc("light", 0.005, 0.006, "z", [-w * 0.3, y, d / 2 - 0.008], 4));
    for (const x of [0.1, 0.2]) b.pieces.push(disc("knob", 0.014, 0.012, "z", [x, y, d / 2 - 0.004], 6));
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.pieces.push(disc("rubber", wheel, 0.025, "x", [x * (w / 2 - 0.06), wheel, z * (d / 2 - 0.06)], 8));
    b.pieces.push(box("metal", [0.04, 0.012, 0.05], [x * (w / 2 - 0.06), floor - 0.004, z * (d / 2 - 0.06)]));
  }
  for (const x of [-1, 1]) b.pieces.push(...handle("metal", [x * w / 2, floor + ch * 0.6, 0], x > 0 ? "x" : "-x", 0.16, 0.012));
  b.pieces.push(box("panel", [w * 0.8, ch * 0.5, 0.008], [0, floor + ch * 0.5, -d / 2 - 0.012]));
  const back = -d / 2 - 0.016;
  jacks(b, numbered("xlr-in", 4), "back", [-0.21, floor + ch * 0.62, back], [0.06, 0, 0]);
  jacks(b, numbered("speaker-out", 4), "back", [0.03, floor + ch * 0.62, back], [0.06, 0, 0]);
  jacks(b, ["power-in"], "back", [0.18, floor + ch * 0.38, back], [0, 0, 0], 0.016);
  mark(b, "grab", [w / 2 + 0.012, floor + ch * 0.6, 0], [1, 0, 0]);
  return b;
}

/** A 12-channel mixer (8 mic, 4 line): a low wedge, a column of knobs and a fader per channel, jacks along the back. */
function mixer(): Build {
  const [w, h, d] = GEAR_SIZES["mixer-small"], b: Build = { pieces: [], marks: [] }, front = 0.04, back = h - 0.003;
  b.pieces.push(prism("paint", [[d / 2, 0.006], [d / 2, front], [-d / 2 + 0.05, back], [-d / 2, back], [-d / 2, 0.006]], w));
  const slope = Math.atan2(back - front, d - 0.05), yAt = (z: number) => front + (d / 2 - z) * Math.tan(slope);
  for (let i = 0; i < 12; i++) {
    const x = -w * 0.42 + i * w * 0.062;
    for (const z of [-0.08, -0.03, 0.02]) b.pieces.push(disc("knob", 0.006, 0.012, "y", [x, yAt(z) + 0.004, z], 4));
    b.pieces.push(box("knob", [0.01, 0.012, 0.018], [x, yAt(0.11) + 0.005, 0.11], { rot: [slope, 0, 0] }));
  }
  b.pieces.push(box("knob", [0.014, 0.014, 0.02], [w * 0.4, yAt(0.11) + 0.006, 0.11], { rot: [slope, 0, 0] }));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.01, 0.006, "y", [x * (w / 2 - 0.03), 0.003, z * (d / 2 - 0.03)], 6));
  const rear = -d / 2 - 0.002, y = back * 0.55;
  jacks(b, numbered("xlr-in", 8), "back", [-w * 0.42, y, rear], [w * 0.062, 0, 0], 0.009);
  jacks(b, numbered("line-in", 4), "back", [w * 0.08, y, rear], [w * 0.062, 0, 0], 0.007);
  // the mains, line outs and power sit above the inputs
  jacks(b, ["xlr-out-1", "xlr-out-2", "line-out-1", "line-out-2", "power-in"], "back", [w * 0.1, back * 0.85, rear], [w * 0.08, 0, 0], 0.007);
  mark(b, "grab", [0, back, -d / 2 + 0.03]);
  return b;
}

/** A wheeled generator: a tube frame round an engine and a tank, wheels at one end, a fold-out handle at the other. */
function generator(): Build {
  const [w, h, d] = GEAR_SIZES["generator-7kva"], b: Build = { pieces: [], marks: [] }, r = 0.014, wr = 0.1;
  const x0 = -w / 2 + wr, x1 = w / 2 - 0.08, zf = d / 2 - 0.055, y0 = 0.05, y1 = h - r;
  const corners: [number, number][] = [[x0, -zf], [x1, -zf], [x1, zf], [x0, zf]];
  corners.forEach(([x, z], i) => {
    const [nx, nz] = corners[(i + 1) % 4];
    b.pieces.push(rod("metal", [x, y0, z], [x, y1, z], r), rod("metal", [x, y1, z], [nx, y1, nz], r), rod("metal", [x, y0, z], [nx, y0, nz], r));
  });
  b.pieces.push(box("paint", [w * 0.55, h * 0.4, d * 0.6], [0, y0 + h * 0.2, 0], { bevel: 0.02 }));
  b.pieces.push(box("lid", [w * 0.5, h * 0.22, d * 0.62], [0, y1 - h * 0.13, 0], { bevel: 0.03 }));
  b.pieces.push(disc("knob", 0.03, 0.02, "y", [w * 0.12, y1 - 0.01, 0], 8));
  for (const z of [-1, 1]) {
    b.pieces.push(disc("rubber", wr, 0.06, "z", [x0, wr, z * (d / 2 - 0.03)], 10));
    b.pieces.push(disc("metal", wr * 0.45, 0.065, "z", [x0, wr, z * (d / 2 - 0.03)], 8));
    b.pieces.push(rod("rubber", [x1, y0, z * (zf - 0.03)], [x1, 0, z * (zf - 0.03)], 0.015, 4));
    b.pieces.push(rod("metal", [x1, y1 * 0.85, z * zf], [w / 2 - 0.01, y1 * 0.95, z * zf], r));
  }
  b.pieces.push(rod("rubber", [w / 2 - 0.01, y1 * 0.95, -zf], [w / 2 - 0.01, y1 * 0.95, zf], 0.018));
  b.pieces.push(box("panel", [w * 0.4, h * 0.25, d / 2 - zf], [-0.04, h * 0.48, (zf + d / 2) / 2 - 0.006]));
  jacks(b, numbered("power-out", 4), "front", [-w * 0.18, h * 0.43, d / 2 - 0.006], [w * 0.09, 0, 0], 0.014);
  b.pieces.push(disc("light", 0.006, 0.008, "z", [w * 0.08, h * 0.55, d / 2 - 0.006], 4));
  mark(b, "grab", [w / 2 - 0.01, y1 * 0.95, 0], [1, 0, 0]);
  return b;
}

function distro(): Build {
  const [w, h, d] = GEAR_SIZES["distro-box"], b: Build = { pieces: [], marks: [] }, body = h - 0.03;
  b.pieces.push(box("lid", [w, body, d], [0, body / 2, 0], { bevel: 0.015 }));
  b.pieces.push(...handle("rubber", [0, body, 0], "y", 0.16, 0.03));
  b.pieces.push(box("panel", [w - 0.06, body * 0.55, 0.008], [0, body * 0.5, d / 2]));
  jacks(b, numbered("power-out", 6), "front", [-w * 0.32, body * 0.5, d / 2 + 0.004], [w * 0.128, 0, 0], 0.016);
  jacks(b, ["power-in"], "left", [-w / 2, body * 0.5, 0], [0, 0, 0], 0.02);
  mark(b, "grab", [0, h, 0]);
  return b;
}

/** Two cable channels under a yellow lid, between rubber ramps; a tab at one end and a slot at the other link them. */
function cableRamp(): Build {
  const [w, h, d] = GEAR_SIZES["cable-ramp-2ch"], b: Build = { pieces: [], marks: [] }, body = w - 0.04, top = h - 0.006;
  b.pieces.push(prism("rubber", [[-d / 2, 0], [d / 2, 0], [0.11, top], [-0.11, top]], body, -0.02));
  b.pieces.push(box("lid", [body - 0.02, 0.006, 0.2], [-0.02, h - 0.003, 0]));
  for (const z of [-0.05, 0.05]) b.pieces.push(box("knob", [0.004, top * 0.6, 0.07], [-0.02 - body / 2 - 0.001, top * 0.4, z]), box("knob", [0.004, top * 0.6, 0.07], [-0.02 + body / 2 + 0.001, top * 0.4, z]));
  // the tab on the +x end; its slot on the -x end is the dark notch above
  for (const z of [-0.17, 0.17]) b.pieces.push(box("rubber", [0.04, 0.02, 0.06], [w / 2 - 0.02, 0.01, z]));
  mark(b, "link-a", [-w / 2, 0.01, 0], [-1, 0, 0]);
  mark(b, "link-b", [w / 2, 0.01, 0], [1, 0, 0]);
  mark(b, "grab", [-0.02, h, 0]);
  return b;
}

function roadCase(): Build {
  const [w, h, d] = GEAR_SIZES["road-case-m"], b: Build = { pieces: [], marks: [] }, wheel = 0.035, floor = wheel * 2 + 0.005;
  const ch = h - floor, cy = floor + ch / 2;
  b.pieces.push(box("paint", [w - 0.01, ch, d - 0.01], [0, cy, 0], { bevel: 0.006 }));
  b.pieces.push(box("metal", [w, 0.016, d], [0, floor + ch * 0.68, 0]));
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(box("chrome", [0.045, 0.045, 0.045], [x * (w / 2 - 0.02), cy + y * (ch / 2 - 0.02), z * (d / 2 - 0.02)], { bevel: 0.01 }));
  for (const x of [-0.18, 0.18]) for (const z of [-1, 1]) b.pieces.push(box("chrome", [0.05, 0.04, 0.012], [x, floor + ch * 0.68, z * (d / 2)]));
  for (const x of [-1, 1]) b.pieces.push(...handle("rubber", [x * (w / 2 - 0.005), floor + ch * 0.4, 0], x > 0 ? "x" : "-x", 0.14, 0.01));
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.pieces.push(disc("rubber", wheel, 0.025, "x", [x * (w / 2 - 0.07), wheel, z * (d / 2 - 0.07)], 8));
    b.pieces.push(box("metal", [0.04, 0.012, 0.05], [x * (w / 2 - 0.07), floor - 0.004, z * (d / 2 - 0.07)]));
  }
  mark(b, "grab", [w / 2 + 0.005, floor + ch * 0.4, 0], [1, 0, 0]);
  return b;
}

/** Three legs out of a hub at `hubY`, spread so the feet reach `r` from the pole: one along +z, two behind. */
function tripod(b: Build, r: number, hubY: number, legR: number) {
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3, x = Math.sin(a) * r, z = Math.cos(a) * r;
    b.pieces.push(rod("metal", [0, hubY, 0], [x, 0.012, z], legR));
    b.pieces.push(disc("rubber", legR * 1.6, 0.012, "y", [x, 0.006, z], 6));
    b.pieces.push(rod("metal", [x * 0.45, hubY * 0.45, z * 0.45], [0, hubY * 0.75, 0], legR * 0.6, 4));
  }
}

/** A speaker stand, opened out, its pole at `height` (1.2 to 2.0 m). */
function stand(height: number): Build {
  const b: Build = { pieces: [], marks: [] };
  tripod(b, 0.53, 0.45, 0.012);
  b.pieces.push(rod("metal", [0, 0.25, 0], [0, height * 0.55, 0], 0.019, 8), rod("chrome", [0, height * 0.5, 0], [0, height, 0], 0.017, 8));
  b.pieces.push(disc("knob", 0.025, 0.04, "y", [0, height * 0.55, 0], 6));
  b.pieces.push(rod("knob", [0, height * 0.55, 0], [0.05, height * 0.55, 0], 0.006, 4));
  mark(b, "pole", [0, height, 0], [0, 1, 0]);
  mark(b, "grab", [0, height * 0.45, 0], [1, 0, 0]);
  return b;
}

function micStand(): Build {
  const b: Build = { pieces: [], marks: [] }, mast = 1.05;
  tripod(b, 0.35, 0.18, 0.008);
  b.pieces.push(rod("metal", [0, 0.1, 0], [0, mast, 0], 0.011, 6));
  b.pieces.push(disc("knob", 0.016, 0.03, "y", [0, mast, 0], 6));
  // the boom: a counterweight behind, the clip up front
  const back: THREE.Vector3Tuple = [0.13, mast - 0.12, 0], tip: THREE.Vector3Tuple = [-0.24, 1.58, 0];
  b.pieces.push(rod("metal", back, tip, 0.008, 6), disc("metal", 0.018, 0.04, "x", back, 6));
  b.pieces.push(rod("knob", tip, [tip[0] - 0.012, tip[1] + 0.012, 0], 0.012, 6));
  mark(b, "mic", [tip[0] - 0.012, tip[1] + 0.014, 0], [-0.7, 0.7, 0]);
  mark(b, "grab", [0, mast * 0.7, 0], [1, 0, 0]);
  return b;
}

/** An electric guitar standing on its end: a double-bout body, a neck and a headstock. The front faces +z. */
function guitar(): Build {
  const [w, h, d] = GEAR_SIZES.guitar, b: Build = { pieces: [], marks: [] }, lower = w / 2, mid = d / 2;
  b.pieces.push(disc("body", lower, d * 0.8, "z", [0, lower * Math.cos(Math.PI / 12), 0], 12), disc("body", 0.125, d * 0.8, "z", [0.01, 0.38, 0], 10));
  b.pieces.push(box("paint", [0.05, 0.47, 0.022], [0, 0.66, 0.004]), box("paint", [0.085, 0.12, 0.016], [0, h - 0.06, 0]));
  for (let i = 0; i < 6; i++) b.pieces.push(disc("chrome", 0.005, 0.02, "x", [(i < 3 ? -1 : 1) * 0.05, h - 0.1 + (i % 3) * 0.032, 0], 4));
  for (const y of [0.23, 0.34]) b.pieces.push(box("knob", [0.075, 0.022, 0.006], [0, y, d * 0.4 + 0.002]));
  b.pieces.push(box("chrome", [0.08, 0.018, 0.008], [0, 0.15, d * 0.4 + 0.002]));
  for (const [x, y] of [[0.09, 0.12], [0.12, 0.18]]) b.pieces.push(disc("knob", 0.011, 0.012, "z", [x, y, d * 0.4 + 0.005], 6));
  jacks(b, ["line-out"], "front", [0.11, 0.07, mid * 0.8], [0, 0, 0], 0.009);
  mark(b, "grab", [0, 0.68, 0.02], [0, 0, 1]);
  return b;
}

/** The venue's back-bar cooler: a cabinet with two glass doors lit from inside, its plug at the back. */
function barCooler(): Build {
  const [w, h, d] = GEAR_SIZES["bar-cooler"], b: Build = { pieces: [], marks: [] };
  b.pieces.push(box("paint", [w, h - 0.02, d], [0, 0.01 + (h - 0.02) / 2, 0], { bevel: 0.01 }));
  for (const x of [-1, 1]) {
    b.pieces.push(box("light", [w / 2 - 0.06, h - 0.2, 0.01], [x * w / 4, h / 2 + 0.03, d / 2 + 0.002]));
    b.pieces.push(box("metal", [0.02, 0.3, 0.02], [x * 0.04, h * 0.55, d / 2 + 0.015]));
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.02, 0.01, "y", [x * (w / 2 - 0.05), 0.005, z * (d / 2 - 0.05)], 6));
  jacks(b, ["power-in"], "back", [w * 0.3, 0.15, -d / 2 - 0.004], [0, 0, 0], 0.02);
  mark(b, "grab", [0, h, 0]);
  return b;
}

const BUILDERS: Record<GearId, (height: number) => Build> = {
  "top-12-powered": () => speaker(GEAR_SIZES["top-12-powered"], ["power-in", "xlr-in", "xlr-out"], true),
  "top-15-passive": () => speaker(GEAR_SIZES["top-15-passive"], ["speaker-in", "speaker-out"], false),
  "sub-18": sub,
  "wedge-12": wedge,
  "amp-head": ampHead,
  "cab-4x12": cab4x12,
  "amp-rack-4u": ampRack,
  "mixer-small": mixer,
  "generator-7kva": generator,
  "distro-box": distro,
  "cable-ramp-2ch": cableRamp,
  "road-case-m": roadCase,
  "stand-tripod": stand,
  "mic-stand": micStand,
  "bar-cooler": barCooler,
  "line-array-box": () => speaker(GEAR_SIZES["line-array-box"], ["power-in", "xlr-in", "xlr-out"], true),
  guitar,
};

type Built = { slots: [GearSlot, THREE.BufferGeometry][]; marks: Mark[] };
const cache = new Map<string, Built>();

function built(id: GearId, height: number): Built {
  const key = id === "stand-tripod" ? `${id}@${height}` : id;
  let hit = cache.get(key);
  if (!hit) {
    const { pieces, marks } = BUILDERS[id](height);
    const slots = SLOTS.filter((s) => pieces.some((p) => p.slot === s))
      .map((s): [GearSlot, THREE.BufferGeometry] => [s, mergeVertices(mergeGeometries(pieces.filter((p) => p.slot === s).map((p) => p.geo))!)]);
    hit = { slots, marks };
    cache.set(key, hit);
  }
  return hit;
}

export type GearOptions = {
  look?: GearLook;
  /** A speaker stand's pole height, 1.2 to 2.0 m. */
  height?: number;
};

const Z = new THREE.Vector3(0, 0, 1);

/** One piece of gear: a group named for its id, a mesh per material slot, and its jacks, grab and mounts. */
export function gear(id: GearId, { look = gearLook(), height = 1.2 }: GearOptions = {}): THREE.Group {
  const h = clamp(height, 1.2, 2.0), { slots, marks } = built(id, h);
  const g = new THREE.Group();
  g.name = id;
  g.userData = { gear: id, size: id === "stand-tripod" ? [0.9, h, 0.9] : [...GEAR_SIZES[id]] };
  for (const [slot, geo] of slots) {
    const mesh = new THREE.Mesh(geo, look[slot]);
    mesh.name = `${id}-${slot}`;
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  for (const { name, at, out } of marks) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(...at);
    o.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...out).normalize());
    g.add(o);
  }
  return g;
}

/** A model's jacks, by id (`power-in`, `xlr-in-3`, ...). */
export function gearJacks(g: THREE.Object3D): Map<string, THREE.Object3D> {
  return new Map(g.children.filter((c) => c.name.startsWith("jack:")).map((c) => [c.name.slice(5), c]));
}
