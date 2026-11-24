// The bass-line box, the bass seat's other instrument: the small silver early-80s box with a one-octave keyboard of
// square buttons (the naturals along the front, the sharps in a row behind them), a row of big black knobs over it
// (tuning, cutoff, resonance, envelope depth, decay, accent, tempo, volume) and a strip of little pattern keys with
// their lamps, on a small black stand. Its voice is the gliding, squelching diode-ladder bass (fm-daw's bass seat).
// Built as the mono synth is, and returned as one (`MonoSynth`): one mesh per material slot, and its keys as two
// InstancedMeshes to press and light, the naturals' tops at `keyTop` and their near edge `BOX_KEY_FRONT` in front of
// its middle. Feet on the floor at y = 0, centred on x and z, the keys toward +z, metres.
import * as THREE from "three";
import { type MonoSynth, into, piece } from "./monosynth.ts";
import { type Palette, type Piece, box, loft, R, part } from "./shapes.ts";

const W = 0.36, D = 0.26, H = 0.055, BUTTON = 0.02, PITCH = 0.034;
/** The naturals' near edge, in front of the box's middle. */
export const BOX_KEY_FRONT = D / 2 - 0.03;

export function bassbox(seed: number, { keyTop = 0.79 }: { keyTop?: number } = {}): MonoSynth {
  const pieces: Piece[] = [];
  // the box sits on its stand so the buttons' tops land at keyTop
  const top = keyTop - 0.004, base = top - H;
  pieces.push(box("case", [W, H - 0.006, D], [0, base + (H - 0.006) / 2, 0], { bevel: 0.004 }));
  pieces.push(box("panel", [W - 0.008, 0.003, D - 0.008], [0, top - 0.0045, 0], { bevel: 0.001 }));
  // the keyboard's dark strip along the front, the knobs' row behind it
  pieces.push(box("strip", [W - 0.03, 0.001, 0.07], [0, top - 0.002, D / 2 - 0.05]));
  const panel = new THREE.Matrix4().makeTranslation(0, top - 0.003, 0);
  for (let i = 0; i < 8; i++) {
    const x = -W / 2 + 0.03 + i * ((W - 0.06) / 7), z = -D / 2 + 0.06, r = 0.011;
    pieces.push(into(loft("knob", [R(0, r * 1.2), R(0.003, r * 1.2), R(0.004, r), R(0.014, r * 0.92), R(0.0155, r * 0.8)], { seg: 14 }), panel.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0, z))));
    pieces.push(into(box("ink", [0.0018, 0.002, r * 0.7], [x, 0.0165, z - r * 0.35]), panel));
    pieces.push(into(box("ink", [r * 1.8, 0.0008, 0.002], [x, 0.0004, z + r * 1.6]), panel));
  }
  // the pattern keys and their lamps, between the knobs and the keyboard
  for (let i = 0; i < 8; i++) {
    const x = -W / 2 + 0.035 + i * 0.03, z = -0.01;
    pieces.push(into(box("button", [0.016, 0.005, 0.01], [x, 0.0025, z], { bevel: 0.0015 }), panel));
    pieces.push(into(box(i === ((seed >>> 0) % 8) ? "lamp" : "lampOff", [0.004, 0.002, 0.004], [x, 0.001, z - 0.011]), panel));
  }
  // its stand: a small black table on four legs, a crossbar low down
  const legH = base;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pieces.push(box("stand", [0.025, legH, 0.025], [sx * (W / 2 - 0.02), legH / 2, sz * (D / 2 - 0.02)]));
  for (const sz of [-1, 1]) pieces.push(box("stand", [W - 0.04, 0.02, 0.02], [0, 0.12, sz * (D / 2 - 0.02)]));
  pieces.push(box("stand", [W + 0.02, 0.014, D + 0.02], [0, base - 0.007, 0]));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pieces.push(piece("rubber", new THREE.CylinderGeometry(0.016, 0.016, 0.01, 10), new THREE.Matrix4().makeTranslation(sx * (W / 2 - 0.02), 0.005, sz * (D / 2 - 0.02))));

  const palette: Palette = {
    case: ["#b9bcbf", 0.32, 0.85], panel: ["#cfd2d4", 0.28, 0.9], strip: ["#2a2b2e", 0.6, 0.2], knob: ["#0e0e0f", 0.45, 0.1],
    ink: ["#151515", 0.6, 0], button: ["#e4e2dc", 0.45, 0], lamp: ["#ff3a2a", 0.3, 0, 1.6], lampOff: ["#4a1210", 0.4, 0],
    stand: ["#1b1c1f", 0.5, 0.6], rubber: ["#141414", 0.9, 0],
  };
  const group = part("bassbox", pieces, palette);

  // the keys: eight naturals (C up to C) along the front, the five sharps in the row behind, each a square button
  const steps = [0, 1, 3, 4, 5], whiteAt: [number, number, number][] = [], blackAt: [number, number, number][] = [];
  const kx0 = -((7 * PITCH) / 2), keyZ = BOX_KEY_FRONT - BUTTON / 2;
  for (let i = 0; i < 8; i++) {
    whiteAt.push([kx0 + i * PITCH, keyTop - 0.003, keyZ]);
    if (steps.includes(i % 7) && i < 7) blackAt.push([kx0 + (i + 0.5) * PITCH, keyTop - 0.003, keyZ - 0.028]);
  }
  const whiteLen = BUTTON, blackLen = BUTTON;
  const white = new THREE.InstancedMesh(new THREE.BoxGeometry(BUTTON, 0.006, BUTTON), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.45 }), whiteAt.length);
  const black = new THREE.InstancedMesh(new THREE.BoxGeometry(BUTTON, 0.006, BUTTON), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 }), blackAt.length);
  white.name = "white-keys"; black.name = "black-keys";
  const m = new THREE.Matrix4(), whiteRest = new THREE.Color("#dcdad3"), blackRest = new THREE.Color("#303134");
  whiteAt.forEach((q, i) => { white.setMatrixAt(i, m.makeTranslation(...q)); white.setColorAt(i, whiteRest); });
  blackAt.forEach((q, i) => { black.setMatrixAt(i, m.makeTranslation(...q)); black.setColorAt(i, blackRest); });
  group.add(white, black);
  return {
    group, size: { w: W + 0.02, d: D + 0.02, h: keyTop + 0.03 }, count: 13, keyTop, keyFront: BOX_KEY_FRONT,
    keys: { white, black, whiteAt, blackAt, whiteLen, blackLen, blackRest, whiteRest, whites: 8 },
  };
}
