// A person in 3D from their eqosys avatar (@rustybuns/util/avatar): a jointed figure with shoulders, elbows, hands
// with fingers, knees, shoes and a face of its own (eyes that blink, brows, a nose, ears, a mouth), dressed in every
// part an avatar has (skin, hair, hat, eyes, mouth, glasses, top, colours, build). It stands, walks, sits and plays
// (hands on keys, sticks or strings). Its feet are at y 0 and it faces -z, as a camera does. Made of lofts and balls
// (shapes.ts), so it needs no DOM: the eqosys picker and Qollab Studio's rooms draw the same figure.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import type { Avatar } from "@rustybuns/util/avatar";
import { ball, box, loft, part, R, type Palette, type Piece } from "./shapes.ts";

/** What the figure is doing this frame. `walk` in m/s, `t` seconds since the page opened. */
export type CharacterPose = { walk?: number; seated?: boolean; play?: "keys" | "sticks" | "strings" | null; t: number };

export interface Character {
  group: THREE.Group;
  /** Top of the head (hair and hat included), for a name tag or a camera. */
  height: number;
  pose(p: CharacterPose): void;
  dispose(): void;
}

/** Any three.js geometry as a piece: positions only, then normals per corner, so it merges with the lofts. */
function piece(geo: THREE.BufferGeometry, slot: string, m?: THREE.Matrix4): Piece {
  for (const k of Object.keys(geo.attributes)) if (k !== "position") geo.deleteAttribute(k);
  if (m) geo.applyMatrix4(m);
  geo.computeVertexNormals();
  return { geo: geo.toNonIndexed(), slot };
}
const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: THREE.Vector3Tuple = [1, 1, 1]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));
const ring = (slot: string, r: number, tube: number, m: THREE.Matrix4, arc = Math.PI * 2, sides = 20) => piece(new THREE.TorusGeometry(r, tube, 6, sides, arc), slot, m);
const cone = (slot: string, r0: number, r1: number, h: number, m: THREE.Matrix4, seg = 16) => piece(new THREE.CylinderGeometry(r1, r0, h, seg), slot, m);
const smooth = { seg: 14, smooth: true } as const;

/** A limb hanging from its joint (y 0) down `len`, thick `a` at the top and `b` at the bottom, rounded at both ends. */
const limb = (slot: string, len: number, a: number, b: number, front = 0.9) =>
  loft(slot, [R(0.01, a * 0.55, a * 0.55 * front), R(-0.012, a, a * front), R(-len * 0.45, (a + b) / 2 * 1.04, (a + b) / 2 * front), R(-len + 0.012, b, b * front), R(-len - 0.01, b * 0.55, b * 0.55 * front)], smooth);

const pivot = (parent: THREE.Object3D, x: number, y: number, z = 0) => { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; };

/** The figure for `a`. `seed` varies the face a little (nose, ears, eye spacing): pass a hash of the name, so two people in the same look still differ. */
export function character(a: Avatar, seed = 1): Character {
  const rnd = mulberry32(seed), vary = (k: number) => 1 + (rnd() - 0.5) * k;
  const W = a.build === "round" ? 1.22 : a.build === "slim" ? 0.86 : 1, L = a.build === "tall" ? 1.1 : a.build === "short" ? 0.86 : 1;
  const T = a.build === "tall" ? 1.05 : a.build === "short" ? 0.93 : 1, belly = a.build === "round" ? 1.25 : 1;
  const thighL = 0.35 * L, shinL = 0.32 * L, ankle = 0.07, hipsY = thighL + shinL + ankle + 0.04;
  const suit = a.top === "suit", coat = a.top === "labcoat", longSleeve = suit || coat || a.top === "hoodie";
  const shell = suit ? "#2e3439" : coat ? "#f4f5f5" : a.topColor;
  const pal: Palette = {
    skin: [a.skin, 0.62, 0], hair: [a.hairColor, 0.55, 0], top: [a.topColor, 0.78, 0], shell: [shell, 0.7, 0], bottom: [a.bottomColor, 0.82, 0],
    shoe: ["#1d2024", 0.5, 0], sole: ["#e9e4da", 0.7, 0], white: ["#fbfaf7", 0.3, 0], dark: ["#15171a", 0.35, 0], lip: ["#7a2a2a", 0.5, 0],
    tongue: ["#e0697c", 0.5, 0], blue: ["#3a6bd8", 0.8, 0], orange: ["#e8590c", 0.6, 0], gold: ["#e8c24a", 0.3, 0.6], yellow: ["#f4d03a", 0.45, 0],
    purple: ["#4a3a8a", 0.7, 0], pink: ["#c23a6b", 0.6, 0], metal: ["#8a8f94", 0.35, 0.7], lens: ["#101418", 0.15, 0.3], wood: ["#c9935a", 0.6, 0],
    halo: ["#ffe27a", 0.3, 0, 0.8],
  };
  const disposers: (() => void)[] = [];
  const mesh = (parent: THREE.Object3D, name: string, pieces: Piece[]) => { if (!pieces.length) return null; const g = part(name, pieces, pal); parent.add(g); return g; };

  const group = new THREE.Group();
  group.name = "character";
  const hips = pivot(group, 0, hipsY);

  // ---- legs: thigh, knee, shin, shoe
  const legs = [-1, 1].map((s) => {
    const hip = pivot(hips, s * 0.085 * W, -0.04);
    mesh(hip, "thigh", [limb("bottom", thighL, 0.085 * W, 0.06)]);
    const knee = pivot(hip, 0, -thighL);
    mesh(knee, "shin", [limb("bottom", shinL, 0.06, 0.048)]);
    const foot = pivot(knee, 0, -shinL);
    mesh(foot, "shoe", [ball("shoe", 0.06, [0, -0.035, -0.035], { scale: [0.9, 0.62, 1.75], ...smooth, rings: 8 }), box("sole", [0.1, 0.022, 0.21], [0, -ankle + 0.011, -0.035], { bevel: 0.008 })]);
    return { hip, knee, foot };
  });

  // ---- pelvis and the skirt of a dress or a coat
  const pelvis: Piece[] = [loft("bottom", [R(0.08, 0.15 * W, 0.1 * W), R(0, 0.158 * W, 0.105 * W), R(-0.08, 0.15 * W, 0.1 * W), R(-0.12, 0.1 * W, 0.08 * W)], smooth)];
  if (a.top === "dress") pelvis.push(loft("top", [R(0.06, 0.15 * W, 0.105 * W), R(-0.1, 0.2 * W, 0.15 * W), R(-0.34 * L, 0.27 * W, 0.21 * W)], { ...smooth, caps: false }), loft("top", [R(-0.34 * L, 0.27 * W, 0.21 * W), R(-0.345 * L, 0.0, 0)], smooth));
  if (coat) pelvis.push(loft("shell", [R(0.06, 0.162 * W, 0.112 * W), R(-0.12, 0.18 * W, 0.13 * W), R(-0.36 * L, 0.2 * W, 0.15 * W)], { ...smooth, caps: false }));
  mesh(hips, "pelvis", pelvis);

  // ---- spine: the chest, its clothes, the neck
  const spine = pivot(hips, 0, 0.06);
  const sh = 0.38 * T, shW = 0.18 * W;
  const chestRings = [R(-0.02, 0.152 * W, 0.104 * W * belly), R(0.1 * T, 0.15 * W * belly, 0.11 * W * belly), R(0.24 * T, 0.165 * W, 0.112 * W), R(0.34 * T, shW, 0.11 * W), R(sh, shW * 0.96, 0.1 * W), R(sh + 0.04, 0.07, 0.06)];
  const chest: Piece[] = [loft(coat || suit ? "shell" : "top", chestRings, smooth)];
  const front = (y: number) => -(0.11 * W * (y < 0.15 * T ? belly : 1)) - 0.004;
  if (suit) chest.push(loft("white", [R(0.12 * T, 0.03, 0.01, { cz: front(0.12 * T) }), R(sh + 0.02, 0.05, 0.01, { cz: -0.085 * W })], smooth), box("top", [0.03, 0.2 * T, 0.012], [0, 0.26 * T, front(0.26 * T) - 0.01], { bevel: 0.004 }));
  if (coat) chest.push(box("top", [0.08, 0.14 * T, 0.01], [0, 0.3 * T, front(0.3 * T) + 0.002]), box("metal", [0.012, 0.3 * T, 0.008], [0, 0.18 * T, front(0.18 * T) - 0.008]), box("white", [0.06, 0.05, 0.01], [-0.08 * W, 0.24 * T, front(0.24 * T) - 0.004]));
  if (a.top === "hoodie") chest.push(loft("top", [R(sh - 0.02, 0.13, 0.09, { cz: 0.03 }), R(sh + 0.05, 0.12, 0.085, { cz: 0.04 }), R(sh + 0.1, 0.07, 0.05, { cz: 0.06 })], smooth),
    box("top", [0.15 * W, 0.09 * T, 0.02], [0, 0.08 * T, front(0.08 * T) - 0.004], { bevel: 0.008 }), box("white", [0.008, 0.08, 0.008], [-0.03, sh - 0.06, -0.1 * W]), box("white", [0.008, 0.08, 0.008], [0.03, sh - 0.06, -0.1 * W]));
  if (a.top === "overalls") chest.push(box("blue", [0.24 * W, 0.2 * T, 0.03], [0, 0.08 * T, front(0.08 * T) + 0.01], { bevel: 0.01 }),
    ...[-1, 1].map((s) => box("blue", [0.035, 0.24 * T, 0.03], [s * 0.08 * W, 0.26 * T, front(0.26 * T) + 0.006], { bevel: 0.006 })),
    ...[-1, 1].map((s) => ball("gold", 0.012, [s * 0.08 * W, 0.17 * T, front(0.17 * T) - 0.012], { seg: 8 })));
  if (a.top === "hawaiian") for (const [x, y] of [[-0.07, 0.3], [0.05, 0.24], [-0.02, 0.12], [0.09, 0.08], [-0.1, 0.18], [0.02, 0.36]] as const) {
    for (let k = 0; k < 5; k++) { const t = (k / 5) * Math.PI * 2; chest.push(ball("white", 0.011, [x * W + Math.cos(t) * 0.012, y * T + Math.sin(t) * 0.012, front(y * T) + 0.002], { scale: [1, 1, 0.4], seg: 6, rings: 4 })); }
    chest.push(ball("yellow", 0.007, [x * W, y * T, front(y * T) - 0.002], { seg: 6, rings: 4 }));
  }
  if (a.top === "lanyard") chest.push(...[-1, 1].map((s) => box("orange", [0.014, 0.18 * T, 0.008], [s * 0.04, sh - 0.08 * T, front(0.3 * T) - 0.002], { rot: [0, 0, s * 0.35] })),
    box("white", [0.07, 0.09, 0.008], [0, 0.2 * T, front(0.2 * T) - 0.008], { bevel: 0.004 }), box("dark", [0.045, 0.008, 0.004], [0, 0.21 * T, front(0.2 * T) - 0.013]));
  chest.push(loft("skin", [R(sh, 0.05, 0.048), R(sh + 0.1, 0.046, 0.044)], smooth));
  mesh(spine, "chest", chest);

  // ---- arms: shoulder, elbow, a hand with a thumb and four fingers that can each move
  const upperL = 0.27 * T, foreL = 0.24 * T;
  const fingers: THREE.Group[][] = [];
  const sticks: THREE.Object3D[] = [];
  const arms = [-1, 1].map((s) => {
    const shoulder = pivot(spine, s * (shW + 0.02), sh - 0.03);
    mesh(shoulder, "shoulder", [ball(longSleeve || a.top === "hawaiian" || a.top === "tee" || a.top === "lanyard" || a.top === "overalls" ? "shell" : "top", 0.062 * Math.sqrt(W), [0, 0, 0], { ...smooth, rings: 8 })]);
    const sleeve = suit || coat ? "shell" : "top";
    const upper: Piece[] = a.top === "dress" ? [limb("skin", upperL, 0.05, 0.042)] : longSleeve ? [limb(sleeve, upperL, 0.06, 0.05)]
      : [limb("skin", upperL, 0.05, 0.042), loft(sleeve, [R(0.02, 0.064, 0.06), R(-upperL * 0.45, 0.06, 0.056), R(-upperL * 0.5, 0.0, 0)], smooth)];
    mesh(shoulder, "upper-arm", upper);
    const elbow = pivot(shoulder, 0, -upperL);
    mesh(elbow, "forearm", [longSleeve ? limb(sleeve, foreL, 0.05, 0.045) : limb("skin", foreL, 0.043, 0.035), ...(longSleeve ? [loft("skin", [R(-foreL + 0.01, 0.033), R(-foreL - 0.01, 0.031)], smooth)] : [])]);
    const wrist = pivot(elbow, 0, -foreL - 0.005);
    mesh(wrist, "palm", [loft("skin", [R(0.005, 0.03, 0.022), R(-0.035, 0.037, 0.018), R(-0.075, 0.036, 0.016), R(-0.085, 0.02, 0.01)], { ...smooth, p: 2.6 }),
      loft("skin", [R(0, 0.013), R(-0.04, 0.011), R(-0.05, 0.0)], { ...smooth, seg: 8, m: at(-s * 0.03, -0.02, -0.012, -0.5, 0, s * 0.7) })]);
    const four = [0, 1, 2, 3].map((i) => {
      const f = pivot(wrist, (i - 1.5) * 0.017 * -s, -0.075);
      const len = [0.045, 0.052, 0.05, 0.04][i] ?? 0.05;
      mesh(f, "finger", [loft("skin", [R(0.004, 0.0085), R(-len * 0.6, 0.008), R(-len, 0.006), R(-len - 0.006, 0.0)], { ...smooth, seg: 8 })]);
      f.rotation.x = 0.25;
      return f;
    });
    fingers.push(four);
    const stick = mesh(wrist, "stick", [loft("wood", [R(0.1, 0.004), R(0.08, 0.008), R(-0.3, 0.007), R(-0.31, 0.0)], { seg: 8, smooth: true, m: at(0, -0.05, 0, -0.85, 0, -s * 0.15) })]);
    if (stick) { stick.visible = false; sticks.push(stick); }
    return { shoulder, elbow, wrist };
  });

  // ---- the head
  const neck = pivot(spine, 0, sh + 0.06);
  const head = pivot(neck, 0, 0.13);
  const hr = 0.145, fz = -hr * 0.98;
  const face: Piece[] = [
    ball("skin", hr, [0, 0.0, -0.004], { scale: [0.96, 1.08, 1], ...smooth, seg: 22, rings: 16 }),
    ball("skin", 0.019 * vary(0.4), [0, -0.012, fz - 0.012], { scale: [0.9, 1.1, 1.1], ...smooth, seg: 10, rings: 6 }),
    ...[-1, 1].map((s) => ball("skin", 0.03 * vary(0.3), [s * hr * 0.97, -0.005, 0.01], { scale: [0.45, 0.85, 0.6], ...smooth, seg: 10, rings: 6 })),
  ];
  // the mouth sits on the lower face
  const my = -0.055, mz = fz + 0.008;
  const arc = (up: boolean, w: number, slot = "lip") => ring(slot, w, 0.0055, at(0, my + (up ? -w * 0.55 : w * 0.6), mz + 0.004, -0.15, 0, up ? 0 : Math.PI), Math.PI, 12);
  if (a.mouth === "smile") face.push(arc(false, 0.026));
  else if (a.mouth === "frown") face.push(arc(true, 0.024));
  else if (a.mouth === "flat") face.push(box("lip", [0.044, 0.008, 0.008], [0, my, mz + 0.002], { bevel: 0.003 }));
  else if (a.mouth === "o") face.push(ring("lip", 0.012, 0.005, at(0, my, mz + 0.002, -0.15), Math.PI * 2, 14), ball("dark", 0.011, [0, my, mz + 0.006], { scale: [1, 1.1, 0.4], seg: 10, rings: 6 }));
  else if (a.mouth === "grin") face.push(ball("dark", 0.03, [0, my + 0.004, mz + 0.006], { scale: [1.1, 0.55, 0.35], seg: 14, rings: 6 }), box("white", [0.048, 0.012, 0.01], [0, my + 0.012, mz - 0.003], { bevel: 0.004 }));
  else if (a.mouth === "tongue") face.push(arc(false, 0.026), ball("tongue", 0.013, [0.004, my - 0.016, mz - 0.002], { scale: [1, 1.2, 0.5], ...smooth, seg: 10, rings: 6 }));
  mesh(head, "face", face);

  // the eyes are their own group, so they blink
  const eyes = pivot(head, 0, 0.012, fz + 0.012);
  const ex = 0.046 * vary(0.12), eyePieces: Piece[] = [];
  const brow = (s: number, tilt: number, lift = 0) => box("hair", [0.034, 0.008, 0.01], [s * ex, 0.035 + lift, -0.006], { bevel: 0.003, rot: [0, 0, tilt * s] });
  for (const s of [-1, 1]) {
    const shut = (a.eyes === "wink" && s === 1) || a.eyes === "happy";
    if (shut) eyePieces.push(ring("dark", 0.014, 0.0035, at(s * ex, -0.004, -0.004, -0.2), Math.PI, 10));
    else if (a.eyes === "dot") eyePieces.push(ball("dark", 0.012, [s * ex, 0, -0.004], { scale: [1, 1.2, 0.6], seg: 10, rings: 6, smooth: true }));
    else {
      eyePieces.push(ball("white", 0.022, [s * ex, 0, 0.004], { scale: [1, a.eyes === "wide" ? 1.15 : 1, 0.6], seg: 14, rings: 8, smooth: true }),
        ball("dark", a.eyes === "wide" ? 0.01 : 0.012, [s * ex, -0.002, -0.009], { scale: [1, 1.1, 0.5], seg: 10, rings: 6, smooth: true }),
        ball("white", 0.0035, [s * ex + 0.004, 0.004, -0.015], { seg: 6, rings: 4 }));
      if (a.eyes === "sleepy") eyePieces.push(ball("skin", 0.024, [s * ex, 0.004, 0.002], { scale: [1.05, 0.6, 0.66], seg: 14, rings: 8, smooth: true }));
    }
    eyePieces.push(brow(s, a.eyes === "angry" ? -0.45 : a.eyes === "sleepy" ? 0.15 : a.eyes === "happy" ? 0.1 : -0.05, a.eyes === "wide" ? 0.01 : 0));
  }
  mesh(eyes, "eyes", eyePieces);

  // ---- hair: a cap over the skull and the style's own pieces
  const H = "hair", hair: Piece[] = [];
  // an open dome tipped back: the hairline high over the brows, low at the nape. `low` is how far down it reaches.
  const cap = (r = 1.06, low = 0.62) => piece(new THREE.SphereGeometry(hr * r, 24, 12, 0, Math.PI * 2, 0, 1.05 + low * 0.8), H, at(0, 0.012, 0.004, 0.5, 0, 0, [1, 1.04, 1.02]));
  const back = (len: number, wide = 1.02) => loft(H, [R(0.04, hr * wide, hr * 0.9, { cz: 0.025 }), R(-0.06, hr * wide * 1.02, hr * 0.85, { cz: 0.03 }), R(-0.06 - len, hr * wide * 0.92, hr * 0.6, { cz: 0.05 })], { ...smooth, seg: 20 });
  switch (a.hair) {
    case "none": break;
    case "buzz": hair.push(cap(1.015, 0.35)); break;
    case "short": hair.push(cap(1.05, 0.5)); break;
    case "bob": hair.push(cap(1.08, 0.6), back(0.06, 1.08)); break;
    case "long": hair.push(cap(1.07, 0.6), back(0.22)); break;
    case "spiky": hair.push(cap(1.04, 0.45)); for (let i = 0; i < 9; i++) { const t = (i / 9) * Math.PI * 2; hair.push(cone(H, 0.03, 0, 0.09, at(Math.cos(t) * 0.07, hr + 0.02, Math.sin(t) * 0.07, Math.sin(t) * 0.6, 0, -Math.cos(t) * 0.6), 8)); } hair.push(cone(H, 0.035, 0, 0.1, at(0, hr + 0.05, 0), 8)); break;
    case "afro": hair.push(ball(H, hr * 1.32, [0, 0.075, 0.07], { scale: [1.08, 0.95, 1], seg: 20, rings: 12, jag: 0.04, smooth: true })); break;
    case "mohawk": hair.push(cap(1.01, 0.3)); for (let i = 0; i < 6; i++) { const t = -0.5 + i * 0.32; hair.push(ball(H, 0.03, [0, Math.cos(t) * hr * 1.12 + 0.02, Math.sin(t) * hr * 1.12], { scale: [0.5, 1.6, 1], seg: 8, rings: 5 })); } break;
    case "bun": hair.push(cap(1.05, 0.55), ball(H, 0.05, [0, hr + 0.03, 0.05], { ...smooth, seg: 12, rings: 8 })); break;
    case "topknot": hair.push(cap(1.04, 0.5), ball(H, 0.035, [0, hr + 0.07, 0], { ...smooth, seg: 12, rings: 8 }), loft(H, [R(hr, 0.022), R(hr + 0.045, 0.018)], smooth)); break;
    case "pigtails": hair.push(cap(1.06, 0.55)); for (const s of [-1, 1]) hair.push(loft(H, [R(0, 0.03), R(-0.04, 0.042), R(-0.16, 0.03), R(-0.19, 0)], { ...smooth, m: at(s * (hr + 0.03), 0, 0.02, 0, 0, s * 0.35) })); break;
    case "space-buns": hair.push(cap(1.05, 0.55)); for (const s of [-1, 1]) hair.push(ball(H, 0.05, [s * 0.075, hr + 0.01, 0.01], { ...smooth, seg: 12, rings: 8 })); break;
    case "mullet": hair.push(cap(1.05, 0.5), back(0.16, 0.95)); break;
    case "ponytail": hair.push(cap(1.05, 0.55), loft(H, [R(0, 0.03), R(-0.03, 0.04), R(-0.2, 0.028), R(-0.25, 0)], { ...smooth, m: at(0, 0.06, hr + 0.02, 0.4) })); break;
    case "locs": hair.push(cap(1.05, 0.55)); for (let i = 0; i < 13; i++) { const t = Math.PI * 0.2 + (i / 12) * Math.PI * 1.6; hair.push(loft(H, [R(0, 0.014), R(-0.2, 0.012), R(-0.22, 0)], { seg: 8, smooth: true, m: at(Math.cos(t + Math.PI / 2) * hr * 0.98, 0.04, Math.sin(t + Math.PI / 2) * hr * 0.98 + 0.01) })); } break;
    case "pompadour": hair.push(cap(1.04, 0.5), ball(H, 0.09, [0, hr + 0.01, -0.05], { scale: [1.05, 0.75, 1.1], ...smooth, seg: 14, rings: 8 })); break;
    case "curly": hair.push(cap(1.06, 0.55)); for (let i = 0; i < 18; i++) { const t = (i / 18) * Math.PI * 2, u = i % 2 ? 0.55 : 0.95; hair.push(ball(H, 0.035, [Math.cos(t) * hr * Math.sin(u) * 1.05, Math.cos(u) * hr * 1.05 + 0.02, Math.sin(t) * hr * Math.sin(u) * 1.05], { seg: 8, rings: 5, smooth: true })); } break;
    case "braids": hair.push(cap(1.05, 0.55)); for (const s of [-1, 1]) for (let j = 0; j < 5; j++) hair.push(ball(H, 0.024 - j * 0.0015, [s * (hr + 0.005), -0.03 - j * 0.035, 0.03], { scale: [1, 1.2, 1], seg: 8, rings: 5, smooth: true })); break;
    case "flat-top": hair.push(cap(1.02, 0.35), box(H, [hr * 1.7, 0.08, hr * 1.7], [0, hr + 0.03, 0.005], { bevel: 0.015 })); break;
  }
  mesh(head, "hair", hair);

  // ---- hats
  const hat: Piece[] = [], top = hr * 1.08;
  const dome = (slot: string, r = 1.1, low = 0.25) => piece(new THREE.SphereGeometry(hr * r, 24, 10, 0, Math.PI * 2, 0, 1.1 + low), slot, at(0, 0.03, 0.004, 0.4));
  const brim = (slot: string, r: number, y: number) => loft(slot, [R(y, r, r), R(y + 0.012, r, r), R(y + 0.012, r * 0.6, r * 0.6), R(y, r * 0.6, r * 0.6)], { seg: 24, closed: true, smooth: true });
  switch (a.hat) {
    case "none": break;
    case "cap": hat.push(dome("orange"), loft("orange", [R(0, 0.07, 0.01), R(0.008, 0.07, 0.01)], { seg: 16, m: at(0, 0.035, -hr * 1.05, -Math.PI / 2 + 0.25) }), box("orange", [0.15, 0.01, 0.1], [0, 0.03, -hr - 0.04], { bevel: 0.004, rot: [-0.15, 0, 0] })); break;
    case "beanie": hat.push(dome("blue", 1.12, 0.35), ball("white", 0.03, [0, top + 0.05, 0], { jag: 0.2, seg: 10, rings: 6 })); break;
    case "tophat": hat.push(brim("dark", hr * 1.5, top - 0.01), loft("dark", [R(top, hr * 0.8), R(top + 0.2, hr * 0.85)], { seg: 20 }), loft("pink", [R(top + 0.005, hr * 0.81), R(top + 0.04, hr * 0.815)], { seg: 20, caps: false })); break;
    case "hardhat": hat.push(dome("yellow", 1.14, 0.25), brim("yellow", hr * 1.35, 0.015), box("yellow", [0.03, 0.03, hr * 2], [0, top + 0.03, 0], { bevel: 0.01 })); break;
    case "cat-ears": for (const s of [-1, 1]) hat.push(cone(H, 0.045, 0, 0.09, at(s * 0.075, top + 0.01, 0, 0, 0, -s * 0.35), 4), cone("pink", 0.025, 0, 0.055, at(s * 0.073, top + 0.005, -0.016, 0, 0, -s * 0.35), 4)); break;
    case "halo": hat.push(ring("halo", 0.1, 0.012, at(0, top + 0.1, 0, Math.PI / 2))); break;
    case "propeller": hat.push(dome("blue"), loft("metal", [R(top + 0.01, 0.006), R(top + 0.06, 0.006)], { seg: 6 }), box("orange", [0.24, 0.006, 0.035], [0, top + 0.065, 0], { bevel: 0.002, rot: [0.2, 0.6, 0] }), ball("pink", 0.012, [0, top + 0.07, 0], { seg: 8 })); break;
    case "wizard": hat.push(brim("purple", hr * 1.6, top - 0.03), cone("purple", hr * 0.95, 0, 0.36, at(0, top + 0.15, 0.02, 0.12), 20), ball("yellow", 0.018, [0.04, top + 0.12, -0.07], { seg: 8 })); break;
    case "party": hat.push(cone("pink", hr * 0.6, 0, 0.24, at(0, top + 0.1, 0, 0, 0, 0.12), 18), ball("yellow", 0.025, [-0.03, top + 0.23, 0], { jag: 0.25, seg: 10, rings: 6 })); break;
    case "cone": hat.push(cone("orange", hr * 0.85, hr * 0.12, 0.3, at(0, top + 0.12, 0), 18), cone("white", hr * 0.62, hr * 0.47, 0.06, at(0, top + 0.13, 0), 18), box("orange", [hr * 2, 0.02, hr * 2], [0, top - 0.02, 0], { bevel: 0.006 })); break;
    case "headphones": hat.push(ring("dark", hr * 1.1, 0.012, at(0, 0.03, 0, 0, Math.PI / 2, 0), Math.PI)); for (const s of [-1, 1]) hat.push(loft("dark", [R(0, 0.04), R(0.035, 0.042), R(0.04, 0.03)], { seg: 16, smooth: true, m: at(s * (hr + 0.005), 0, 0.005, 0, 0, -s * Math.PI / 2) })); break;
    case "crown": hat.push(loft("gold", [R(top - 0.03, hr * 0.85), R(top + 0.03, hr * 0.88), R(top + 0.07, hr * 0.92, hr * 0.92, { jag: 0 })], { seg: 10, caps: false }), ...Array.from({ length: 5 }, (_, i) => { const t = (i / 5) * Math.PI * 2 + Math.PI / 2; return cone("gold", 0.025, 0, 0.05, at(Math.cos(t) * hr * 0.9, top + 0.09, Math.sin(t) * hr * 0.9), 4); }), ball("pink", 0.014, [0, top + 0.03, -hr * 0.9], { seg: 8 })); break;
    case "rubber-duck": hat.push(ball("yellow", 0.07, [0, top + 0.04, 0.01], { scale: [1, 0.75, 1.25], ...smooth, seg: 14, rings: 8 }), ball("yellow", 0.042, [0, top + 0.1, -0.04], { ...smooth, seg: 12, rings: 8 }),
      ball("orange", 0.02, [0, top + 0.095, -0.085], { scale: [1.2, 0.5, 1.2], seg: 8, rings: 5 }), ...[-1, 1].map((s) => ball("dark", 0.007, [s * 0.022, top + 0.11, -0.075], { seg: 6, rings: 4 }))); break;
    case "bucket": hat.push(cone("bottom", hr * 1.0, hr * 0.85, 0.1, at(0, top + 0.01, 0), 20), loft("bottom", [R(top - 0.04, hr * 1.0), R(top - 0.06, hr * 1.4), R(top - 0.065, hr * 1.4)], { seg: 20, caps: false, smooth: true })); break;
  }
  mesh(head, "hat", hat);

  // ---- glasses, on the front of the face
  const gl: Piece[] = [], gz = fz - 0.012, gy = 0.012;
  const frame = (slot: string, r: number, sides: number, rot = 0) => [-1, 1].map((s) => ring(slot, r, 0.004, at(s * ex, gy, gz, 0, 0, rot), Math.PI * 2, sides));
  // the arms run from the frames back along the side of the head to the ears
  const arms2 = (slot: string) => [-1, 1].map((s) => { const x0 = s * (ex + 0.03), x1 = s * hr * 1.0, dz = -gz; return box(slot, [0.006, 0.006, Math.hypot(x1 - x0, dz)], [(x0 + x1) / 2, gy + 0.004, gz / 2], { rot: [0, Math.atan2(x1 - x0, dz), 0] }); });
  switch (a.glasses) {
    case "none": break;
    case "round": gl.push(...frame("metal", 0.026, 20), box("metal", [0.03, 0.005, 0.005], [0, gy + 0.006, gz]), ...arms2("metal")); break;
    case "square": gl.push(...frame("dark", 0.03, 4, Math.PI / 4), box("dark", [0.03, 0.007, 0.007], [0, gy + 0.004, gz]), ...arms2("dark")); break;
    case "shades": gl.push(...[-1, 1].map((s) => box("lens", [0.05, 0.034, 0.008], [s * ex, gy, gz], { bevel: 0.008 })), box("dark", [0.14, 0.008, 0.008], [0, gy + 0.016, gz]), ...arms2("dark")); break;
    case "monocle": gl.push(ring("gold", 0.026, 0.004, at(ex, gy, gz)), loft("gold", [R(0, 0.0015), R(-0.12, 0.0015)], { seg: 4, m: at(ex + 0.02, gy - 0.02, gz, 0, 0, 0.5) })); break;
    case "vr": gl.push(box("dark", [0.18, 0.07, 0.07], [0, gy, gz - 0.02], { bevel: 0.015 }), box("blue", [0.15, 0.03, 0.004], [0, gy, gz - 0.057], { bevel: 0.002 }), ring("dark", hr * 1.02, 0.01, at(0, gy, 0, Math.PI / 2))); break;
    case "pixel": for (const s of [-1, 1]) for (let i = 0; i < 4; i++) gl.push(box("dark", [0.014, 0.014 - (i === 3 ? 0.006 : 0), 0.008], [s * ex + (i - 1.5) * 0.014 * s, gy - (i === 3 ? 0.006 : 0), gz]));
      gl.push(box("dark", [0.15, 0.008, 0.008], [0, gy + 0.008, gz])); break;
  }
  mesh(head, "glasses", gl);

  group.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const height = bounds.max.y;
  disposers.push(() => group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of [o.material].flat()) m.dispose(); } }));

  const seatY = 0.47 + 0.1;
  return {
    group, height,
    pose({ walk = 0, seated = false, play = null, t }) {
      const amp = seated ? 0 : Math.min(1, walk / 1.4), ph = t * (5 + 3 * amp);
      const swing = Math.sin(ph) * amp;
      hips.position.y = seated ? seatY : hipsY + Math.abs(Math.cos(ph)) * 0.025 * amp - 0.012 * amp;
      spine.rotation.x = seated ? -0.04 : -0.06 * amp;
      spine.scale.y = 1 + Math.sin(t * 2.1) * 0.006;
      for (const [i, l] of legs.entries()) {
        const s = i ? 1 : -1, w = swing * s;
        l.hip.rotation.x = seated ? Math.PI / 2 - 0.05 : w * 0.4;
        l.knee.rotation.x = seated ? -(Math.PI / 2 - 0.05) : -Math.max(0, -Math.sin(ph + (i ? 0 : Math.PI) - 0.6)) * 0.9 * amp - 0.02;
        l.foot.rotation.x = seated ? 0 : Math.max(0, w) * 0.2;
        l.hip.rotation.z = seated ? s * 0.06 : 0;
      }
      neck.rotation.x = play === "keys" ? 0.18 : play ? 0.1 : 0;
      head.rotation.y = play ? Math.sin(t * 1.3) * 0.12 : Math.sin(t * 0.5) * 0.05;
      head.rotation.z = play ? Math.sin(t * 2.4) * 0.05 : 0;
      // blink every few seconds
      const b = (t * 0.37) % 1;
      eyes.scale.y = b > 0.965 ? 0.15 : 1;
      for (const [i, arm] of arms.entries()) {
        const s = i ? 1 : -1, beat = Math.sin(t * 9 + i * Math.PI);
        let sx = -swing * s * 0.5, sz = s * 0.08, ex2 = 0.15 + amp * 0.25, wx = 0;
        if (seated && !play) { sx = 0.35; sz = s * 0.12; ex2 = 0.75; wx = -0.2; }
        if (play === "keys") { sx = 0.32; sz = s * 0.16; ex2 = 1.15; wx = -0.45; }
        if (play === "sticks") { sx = 0.5 + beat * 0.25; sz = s * 0.28; ex2 = 1.1 + beat * 0.35; wx = 0.2 + beat * 0.3; }
        if (play === "strings") {
          if (s < 0) { sx = 0.7; sz = -0.75; ex2 = 0.7; wx = 0; }
          else { sx = 0.35; sz = 0.45; ex2 = 1.45 + Math.sin(t * 11) * 0.2; wx = Math.sin(t * 11) * 0.25; }
        }
        arm.shoulder.rotation.set(sx, 0, sz);
        arm.elbow.rotation.x = ex2;
        arm.wrist.rotation.x = wx;
        for (const [k, f] of (fingers[i] ?? []).entries()) f.rotation.x = play === "keys" ? 0.2 + Math.max(0, Math.sin(t * 13 + k * 1.4 + i * 2.1)) * 0.7 : play ? 1.3 : 0.25 + k * 0.04;
        const stick = sticks[i];
        if (stick) stick.visible = play === "sticks";
      }
    },
    dispose() { for (const d of disposers) d(); },
  };
}
