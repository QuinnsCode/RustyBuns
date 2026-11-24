// A classic analog mono synth, grown from a seed: Qollab Studio's bass seat. Wooden cheeks either side, a raked panel
// of big skirted knobs behind the keys (controllers, three oscillators, a mixer with its rocker switches, a ladder-style
// filter with its envelope and the loudness envelope, the output), a short keybed of 37 or 44 keys, and a pitch wheel
// and a mod wheel in a well on the left, on a black X stand. The seed picks the keys, the wood, the knob caps and how
// steep the panel sits. Feet on the floor at y = 0, centred on x and z, the keys toward +z (where the player sits),
// metres. The case is one mesh per material slot (`part`); the keys are two InstancedMeshes, white and black, so an app
// can press and light them one by one (each key's middle is in `keys`).
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { type Palette, type Piece, box, loft, R, part } from "./shapes.ts";

export interface MonoKeys {
  /** The white keys and the black ones, white-tinted materials: an app gives each key its colour per instance. */
  white: THREE.InstancedMesh; black: THREE.InstancedMesh;
  /** Each key's middle, in the synth's frame, white keys left to right from the lowest C, then the black ones. */
  whiteAt: [number, number, number][]; blackAt: [number, number, number][];
  /** How long (front to back) a white key and a black key are. */
  whiteLen: number; blackLen: number;
  /** A black key's resting colour (the instance colour an app keeps it at). */
  blackRest: THREE.Color;
  /** How many white keys, from C (37 keys: 22, three octaves C to C; 44: 26, C up to G). */
  whites: number;
}
export interface MonoSynth {
  group: THREE.Group;
  size: { w: number; d: number; h: number };
  /** 37 or 44. */
  count: number;
  keys: MonoKeys;
  /** The white keys' top (y), and how far in front of the synth's middle their near edge is (z). */
  keyTop: number; keyFront: number;
}

/** Where the case sits on its stand, and a white key's width. */
export const MONO_STAND = 0.7;
const KEY_W = 0.0235, KEY_D = 0.135, CHEEK = 0.032, WELL = 0.085, CASE_D = 0.4, BED_H = 0.07;
/** The white keys' top (y) and their near edge (z, in front of the synth's middle), whatever the seed: where a player's palms go. */
export const MONO_KEY_TOP = MONO_STAND + BED_H + 0.02, MONO_KEY_FRONT = CASE_D / 2 - 0.02;
const WOODS = ["#4a2a16", "#5a3420", "#3e2414", "#64391f"];
const CAPS = ["#c9ccd0", "#d8c9a0", "#b8bcc2"];

/** A piece from any geometry: positions only, every triangle its own corners, flat normals (as `part` merges them). */
export function piece(slot: string, geo: THREE.BufferGeometry, m?: THREE.Matrix4): Piece {
  for (const k of Object.keys(geo.attributes)) if (k !== "position") geo.deleteAttribute(k);
  if (geo.index) geo = geo.toNonIndexed();
  if (m) geo.applyMatrix4(m);
  geo.computeVertexNormals();
  return { geo, slot };
}
/** A piece built in `frame` (the panel's), moved out into the synth's. */
export const into = (p: Piece, frame: THREE.Matrix4): Piece => { p.geo.applyMatrix4(frame); p.geo.computeVertexNormals(); return p; };

/** The mono synth for `seed`. `fit`: the widest it may be (metres); the keys narrow a little to fit. */
export function monosynth(seed: number, { fit = Infinity }: { fit?: number } = {}): MonoSynth {
  const rnd = mulberry32(seed >>> 0);
  const pick = <T>(l: readonly T[]) => l[Math.floor(rnd() * l.length)];
  const count = pick([37, 44] as const), whites = count === 37 ? 22 : 26;
  const kw = Math.min(KEY_W, (fit - CHEEK * 2 - WELL - 0.01) / whites), keysW = whites * kw;
  const w = keysW + WELL + CHEEK * 2 + 0.01, d = CASE_D, front = d / 2;
  const base = MONO_STAND, bedH = BED_H, keyTop = MONO_KEY_TOP;
  // the keys run from the well's right edge to the right cheek, their near edge 2 cm in from the case's front
  const kx0 = -w / 2 + CHEEK + WELL + 0.005, keyFront = MONO_KEY_FRONT, keyZ = keyFront - KEY_D / 2, keyBack = keyFront - KEY_D;
  const rake = 0.62 + rnd() * 0.2, panelL = 0.24, hingeY = keyTop + 0.025, hingeZ = keyBack - 0.012;
  const pieces: Piece[] = [];

  // ---- the case: a bed under the keys, a lip along the front, the well for the wheels, a back box under the panel ----
  pieces.push(box("case", [w - CHEEK * 2, bedH, d], [0, base + bedH / 2, 0]));
  pieces.push(box("case", [w - CHEEK * 2, 0.03, 0.018], [0, keyTop - 0.008, front - 0.009], { bevel: 0.004 }));
  const backH = hingeY - 0.014 - (base + bedH);
  pieces.push(box("case", [w - CHEEK * 2, backH, hingeZ + d / 2], [0, base + bedH + backH / 2, (hingeZ - d / 2) / 2]));
  const wellX = -w / 2 + CHEEK + WELL / 2;
  pieces.push(box("trim", [WELL - 0.01, 0.006, KEY_D], [wellX, keyTop - 0.004, keyZ]));
  // pitch and mod: two rubber wheels turning on x, standing out of slots in the well
  for (const [i, dx] of [[0, -0.02], [1, 0.02]] as const) {
    const wheel = new THREE.CylinderGeometry(0.032, 0.032, 0.016, 20).rotateZ(Math.PI / 2);
    pieces.push(piece("rubber", wheel, new THREE.Matrix4().makeTranslation(wellX + dx, keyTop - 0.01, keyZ - 0.005)));
    pieces.push(box("slot", [0.022, 0.004, 0.075], [wellX + dx, keyTop - 0.0005, keyZ - 0.005]));
    if (i === 0) pieces.push(box("ink", [0.016, 0.003, 0.004], [wellX + dx, keyTop + 0.021, keyZ - 0.005])); // the pitch wheel's centre mark
  }

  // ---- the wooden cheeks: low at the front, along the keybed, then up the panel's rake and down the back ----
  const topZ = hingeZ - Math.cos(rake) * panelL, topY = hingeY + Math.sin(rake) * panelL;
  // a back board closes the space under the panel
  pieces.push(box("case", [w - CHEEK * 2, topY - hingeY + 0.01, 0.012], [0, (topY + hingeY) / 2 - 0.01, topZ - 0.008]));
  const prof = new THREE.Shape();
  prof.moveTo(front, base - 0.005);
  prof.lineTo(front, keyTop + 0.012);
  prof.lineTo(hingeZ + 0.01, keyTop + 0.03);
  prof.lineTo(topZ + 0.005, topY + 0.025);
  prof.lineTo(topZ - 0.025, topY + 0.015);
  prof.lineTo(-d / 2, base + bedH + 0.06);
  prof.lineTo(-d / 2, base - 0.005);
  for (const sx of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(prof, { depth: CHEEK, bevelEnabled: false });
    // the shape's x is the synth's z, its y is y; extruded along the synth's x
    const m = new THREE.Matrix4().makeTranslation(sx * (w / 2) - (sx > 0 ? 0 : -CHEEK), 0, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    pieces.push(piece("wood", geo, m));
  }

  // ---- the panel: a board raked up behind the keys, its face toward the player; built flat (face +y, its near edge
  // at z 0 running back to -panelL) and turned up about its hinge ----
  const panel = new THREE.Matrix4().makeTranslation(0, hingeY, hingeZ).multiply(new THREE.Matrix4().makeRotationX(rake));
  const pw = w - CHEEK * 2;
  pieces.push(into(box("panel", [pw, 0.012, panelL], [0, -0.006, -panelL / 2]), panel));
  pieces.push(into(box("trim", [pw, 0.004, 0.012], [0, 0.002, -panelL + 0.006]), panel));
  // its sections left to right, with how many knob columns each; a hairline between them, a stripe along the top
  const sections: { cols: number; rows: number; big?: [number, number]; rockers?: number }[] = [
    { cols: 1, rows: 3 },                       // controllers: tune, glide, mod mix
    { cols: 2, rows: 3 },                       // the three oscillators: range and waveform each
    { cols: 2, rows: 3, rockers: 5 },           // the mixer: five levels and their rocker switches
    { cols: 3, rows: 3, big: [0, 0] },          // the filter (cutoff the biggest knob), its contour, the loudness contour
    { cols: 1, rows: 2 },                       // output: volume, and the A-440
  ];
  const span = pw - 0.04, unit = span / sections.reduce((n, s) => n + s.cols + (s.rockers ? 0.6 : 0), 0);
  const rowZ = (r: number, rows: number) => -panelL + 0.05 + (r * (panelL - 0.09)) / Math.max(1, rows - 1);
  const knobs: { x: number; z: number; r: number }[] = [];
  let x = -span / 2;
  sections.forEach((s, si) => {
    const cw = s.cols + (s.rockers ? 0.6 : 0);
    for (let c = 0; c < s.cols; c++) for (let r = 0; r < s.rows; r++) {
      const big = s.big && s.big[0] === c && s.big[1] === r;
      knobs.push({ x: x + unit * (c + 0.5), z: rowZ(r, s.rows), r: big ? 0.021 : 0.0145 });
    }
    if (s.rockers) for (let k = 0; k < s.rockers; k++) {
      const rz = -panelL + 0.04 + (k * (panelL - 0.07)) / (s.rockers - 1);
      pieces.push(into(box("switch", [0.012, 0.008, 0.02], [x + unit * (s.cols + 0.3), 0.004, rz], { bevel: 0.002, rot: [k % 2 ? 0.18 : -0.18, 0, 0] }), panel));
    }
    x += unit * cw;
    if (si < sections.length - 1) pieces.push(into(box("ink", [0.0025, 0.002, panelL - 0.03], [x, 0.001, -panelL / 2]), panel));
  });
  pieces.push(into(box("ink", [span, 0.002, 0.004], [0, 0.001, -panelL + 0.02]), panel));
  for (const k of knobs) {
    // a skirted knob: a wide flat skirt, a fluted body, a bright cap with a pointer line, and a label tick under it
    pieces.push(into(loft("knob", [R(0, k.r * 1.35), R(0.004, k.r * 1.35), R(0.005, k.r * 0.95), R(0.017, k.r * 0.82), R(0.019, k.r * 0.7)], { seg: 14 }), panel.clone().multiply(new THREE.Matrix4().makeTranslation(k.x, 0, k.z))));
    pieces.push(into(loft("cap", [R(0.019, k.r * 0.62), R(0.0205, k.r * 0.6), R(0.0205, 0)], { seg: 14 }), panel.clone().multiply(new THREE.Matrix4().makeTranslation(k.x, 0, k.z))));
    pieces.push(into(box("ink", [0.0025, 0.002, k.r * 0.6], [k.x, 0.021, k.z - k.r * 0.25]), panel));
    pieces.push(into(box("ink", [k.r * 1.6, 0.0015, 0.003], [k.x, 0.001, k.z + k.r * 1.35 + 0.006]), panel));
  }
  // a red lamp by the output, lit
  pieces.push(into(box("lamp", [0.012, 0.008, 0.012], [span / 2 - unit * 0.5, 0.005, -0.03], { bevel: 0.002 }), panel));

  // ---- the X stand: two crossed legs each side, a foot along the floor under each ----
  for (const s of [-1, 1]) {
    const sx = s * (w / 2 - 0.1), len = Math.hypot(base, d * 0.85), lean = Math.atan2(d * 0.85, base);
    for (const k of [-1, 1]) pieces.push(box("stand", [0.028, len, 0.028], [sx, base / 2, 0], { rot: [k * lean, 0, 0] }));
    pieces.push(box("stand", [0.04, 0.02, d * 0.85 + 0.06], [sx, 0.01, 0]));
    pieces.push(box("rubber", [0.05, 0.012, 0.03], [sx, base - 0.006, 0]));
  }

  const palette: Palette = {
    case: ["#141517", 0.6, 0.2], panel: ["#0d0e10", 0.5, 0.35], trim: ["#9da1a6", 0.35, 0.85], wood: [pick(WOODS), 0.55, 0],
    knob: ["#0b0b0c", 0.45, 0.1], cap: [pick(CAPS), 0.3, 0.9], ink: ["#e8e4d8", 0.6, 0], switch: [pick(["#e8e2d2", "#3f6fb0", "#c8402e"]), 0.4, 0],
    slot: ["#030303", 0.9, 0], rubber: ["#1a1a1a", 0.9, 0], stand: ["#232427", 0.4, 0.7], lamp: ["#ff3a2a", 0.3, 0, 1.4],
  };
  const group = part("monosynth", pieces, palette);

  // ---- the keys: white ones with a gap between each, the black ones raised and set back ----
  const steps = [0, 1, 3, 4, 5]; // a white key (in its octave) with a black one just to its right
  const whiteAt: [number, number, number][] = [], blackAt: [number, number, number][] = [];
  for (let i = 0; i < whites; i++) {
    whiteAt.push([kx0 + kw * (i + 0.5), keyTop - 0.011, keyZ]);
    if (steps.includes(i % 7) && i < whites - 1) blackAt.push([kx0 + kw * (i + 1), keyTop + 0.01, keyZ - KEY_D * 0.19]);
  }
  const whiteLen = KEY_D, blackLen = KEY_D * 0.6;
  const white = new THREE.InstancedMesh(new THREE.BoxGeometry(kw - 0.0025, 0.022, whiteLen), new THREE.MeshStandardMaterial({ color: "#e6e1d4", roughness: 0.45 }), whiteAt.length);
  const black = new THREE.InstancedMesh(new THREE.BoxGeometry(kw * 0.56, 0.022, blackLen), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35 }), blackAt.length);
  white.name = "white-keys"; black.name = "black-keys";
  const m = new THREE.Matrix4(), blackRest = new THREE.Color("#060607");
  whiteAt.forEach((p, i) => white.setMatrixAt(i, m.makeTranslation(...p)));
  blackAt.forEach((p, i) => { black.setMatrixAt(i, m.makeTranslation(...p)); black.setColorAt(i, blackRest); });
  group.add(white, black);

  return {
    group, size: { w, d, h: topY + 0.03 }, count, keyTop, keyFront,
    keys: { white, black, whiteAt, blackAt, whiteLen, blackLen, blackRest, whites },
  };
}
