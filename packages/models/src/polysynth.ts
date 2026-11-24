// The keys seat's synth, grown from a seed as one of three classic 61-key instruments, each built the way the real
// family is, named by what it is:
//   wood-poly  the late-70s analog poly: walnut cheeks and a walnut strip along the back, a black panel raked a little
//              toward the player, its sections ruled in white (two oscillators, poly-mod, mixer, filter, two
//              envelopes) in small black knobs with silver caps, a row of cream program buttons with red lamps and a
//              red seven-segment display along its front edge, and a strip of red felt behind the keys.
//   fm-slab    the early-80s digital FM slab: a flat brown-black case with no wood, a long low strip of membrane
//              buttons in coloured groups, a green backlit text display, a data-entry slider and a volume slider.
//   drawbar    the stage tonewheel organ: a red case, nine drawbars standing up out of a well (two brown, two white,
//              black, white, two black and white, the way the footages go), white rocker tabs, flat-fronted keys
//              (no wheels: a half-moon lever for the rotary speaker's speed instead).
// All three on a black X stand, the white keys at `keyTop` with their near edge `POLY_KEY_FRONT` in front of the
// synth's middle (so a seated player's palms land where they did on the old box), keys toward +z, metres. Returned as
// the mono synth is (`MonoSynth`): one mesh per material slot, and the keys as two InstancedMeshes to press and light.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { type MonoSynth, into, piece } from "./monosynth.ts";
import { type Palette, type Piece, box, loft, R, part } from "./shapes.ts";

export const POLY_KINDS = ["wood-poly", "fm-slab", "drawbar"] as const;
export type PolyKind = (typeof POLY_KINDS)[number];

const KEY_W = 0.0235, KEY_D = 0.145, CHEEK = 0.03, BED_H = 0.06, WHITES = 36;
/** The white keys' near edge, in front of the synth's middle. */
export const POLY_KEY_FRONT = 0.17;

/** The poly for `seed`; `kind` picks the family (the seed does when left out), `fit` the widest it may be, `keyTop` the
 *  white keys' top above the floor. */
export function polysynth(seed: number, { fit = Infinity, keyTop = 0.82, kind }: { fit?: number; keyTop?: number; kind?: PolyKind } = {}): MonoSynth & { kind: PolyKind } {
  const rnd = mulberry32(seed >>> 0);
  const pick = <T>(l: readonly T[]) => l[Math.floor(rnd() * l.length)]!;
  kind ??= POLY_KINDS[seed % POLY_KINDS.length]!;
  const organ = kind === "drawbar", wood = kind === "wood-poly";
  const cheek = kind === "fm-slab" ? 0.018 : CHEEK, well = organ ? 0.05 : 0.08;
  const kw = Math.min(KEY_W, (fit - cheek * 2 - well - 0.02) / WHITES), keysW = WHITES * kw;
  const w = keysW + well + cheek * 2 + 0.02, d = organ ? 0.46 : kind === "fm-slab" ? 0.34 : 0.44;
  // the case's middle sits so the keys' near edge lands at POLY_KEY_FRONT: the case's front is just in front of it
  const front = POLY_KEY_FRONT + 0.02, back = front - d, mid = (front + back) / 2;
  const base = keyTop - BED_H - 0.02, keyFront = POLY_KEY_FRONT, keyZ = keyFront - KEY_D / 2, keyBack = keyFront - KEY_D;
  const kx0 = -w / 2 + cheek + well + 0.01;
  const pieces: Piece[] = [];
  const inner = w - cheek * 2;

  // ---- the case: a bed under the keys, a lip along the front, a box behind the keys that carries the panel ----
  pieces.push(box("case", [inner, BED_H, d], [0, base + BED_H / 2, mid]));
  pieces.push(box("case", [inner, 0.026, 0.016], [0, keyTop - 0.009, front - 0.008], { bevel: 0.004 }));
  const panelH = kind === "fm-slab" ? 0.035 : wood ? 0.07 : 0.05, panelBack = back, panelFront = keyBack - 0.014;
  pieces.push(box("case", [inner, keyTop + panelH - (base + BED_H), panelFront - panelBack], [0, (base + BED_H + keyTop + panelH) / 2, (panelFront + panelBack) / 2]));
  // the felt behind the keys (red on the analog poly and the organ, black on the slab)
  pieces.push(box("felt", [keysW + 0.004, 0.004, 0.01], [kx0 + keysW / 2, keyTop + 0.002, keyBack - 0.006]));
  // the well left of the keys: pitch and mod wheels, or the organ's half-moon lever
  const wellX = -w / 2 + cheek + well / 2;
  pieces.push(box("trim", [well - 0.012, 0.005, KEY_D], [wellX, keyTop - 0.006, keyZ]));
  if (organ) {
    pieces.push(box("trim", [0.034, 0.012, 0.05], [wellX, keyTop + 0.002, keyZ - 0.02], { bevel: 0.004 }));
    pieces.push(box("tab", [0.008, 0.03, 0.014], [wellX, keyTop + 0.02, keyZ - 0.02], { bevel: 0.003, rot: [0, 0, 0.4] }));
  } else for (const dx of [-0.017, 0.017]) {
    pieces.push(piece("rubber", new THREE.CylinderGeometry(0.03, 0.03, 0.014, 20).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(wellX + dx, keyTop - 0.012, keyZ - 0.01)));
    pieces.push(box("slot", [0.02, 0.004, 0.07], [wellX + dx, keyTop - 0.002, keyZ - 0.01]));
  }

  // ---- the ends: walnut cheeks (shaped, low at the front, up to the panel) or plain moulded caps ----
  const topY = keyTop + panelH + (wood ? 0.012 : 0.006);
  const prof = new THREE.Shape();
  prof.moveTo(front, base - 0.004);
  prof.lineTo(front, keyTop + 0.012);
  prof.lineTo(panelFront + 0.01, keyTop + 0.03);
  prof.lineTo(panelFront - 0.03, topY);
  prof.lineTo(back, topY);
  prof.lineTo(back, base - 0.004);
  for (const sx of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(prof, { depth: cheek, bevelEnabled: false });
    const m = new THREE.Matrix4().makeTranslation(sx * (w / 2) - (sx > 0 ? 0 : -cheek), 0, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    pieces.push(piece(wood ? "wood" : "end", geo, m));
  }
  if (wood) pieces.push(box("wood", [inner, 0.018, 0.03], [0, topY - 0.009, back + 0.015], { bevel: 0.003 }));

  // ---- the panel: built flat (face +y, its near edge at z 0 running back to -L), tilted up toward the player ----
  const L = panelFront - panelBack - (wood ? 0.04 : 0.01), rake = wood ? 0.2 : kind === "fm-slab" ? 0.06 : 0.04;
  const frame = new THREE.Matrix4().makeTranslation(0, keyTop + panelH + 0.001, panelFront).multiply(new THREE.Matrix4().makeRotationX(rake));
  const at = (x: number, z: number, y = 0) => frame.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));
  const pw = inner - 0.03;
  pieces.push(into(box("panel", [pw, 0.006, L], [0, -0.003, -L / 2]), frame));

  if (wood) {
    // sections, left to right: [columns, rows, a big knob?]; ruled between, a white title rule over each
    const sections = [[3, 2], [3, 2], [2, 2], [2, 2], [3, 2, 1], [2, 2], [2, 2], [1, 2]] as const;
    const span = pw - 0.04, unit = span / sections.reduce((n, s) => n + s[0], 0);
    const rowZ = (r: number) => -L + 0.05 + r * 0.045;
    let x = -span / 2;
    sections.forEach((s, si) => {
      for (let c = 0; c < s[0]; c++) for (let r = 0; r < s[1]; r++) knob(pieces, at(x + unit * (c + 0.5), rowZ(r)), s[2] && c === 0 && r === 0 ? 0.016 : 0.011);
      pieces.push(into(box("ink", [unit * s[0] - 0.01, 0.002, 0.0025], [x + unit * s[0] / 2, 0.001, -L + 0.022]), frame));
      x += unit * s[0];
      if (si < sections.length - 1) pieces.push(into(box("ink", [0.002, 0.002, 0.12], [x, 0.001, -L + 0.08]), frame));
    });
    // along the front edge: the program buttons with their lamps, and the display
    for (let i = 0; i < 16; i++) {
      const bx = -span / 2 + 0.03 + i * 0.03;
      pieces.push(into(box("button", [0.018, 0.008, 0.016], [bx, 0.004, -0.03], { bevel: 0.002 }), frame));
      pieces.push(into(box(i === 3 ? "lamp" : "lampOff", [0.004, 0.003, 0.004], [bx, 0.002, -0.048]), frame));
    }
    pieces.push(into(box("screen", [0.05, 0.003, 0.022], [span / 2 - 0.09, 0.002, -0.034]), frame));
  } else if (kind === "fm-slab") {
    // the long low strip: membrane buttons in two rows of 16, in coloured groups, the display and two sliders on the left
    const left = -pw / 2 + 0.03;
    pieces.push(into(box("screen", [0.1, 0.003, 0.026], [left + 0.09, 0.002, -L / 2]), frame));
    for (const [i, len] of [[0, 0.05], [1, 0.05]] as const) {
      pieces.push(into(box("slot", [0.006, 0.002, len], [left + 0.01 + i * 0.024, 0.001, -L / 2]), frame));
      pieces.push(into(box("trim", [0.014, 0.01, 0.008], [left + 0.01 + i * 0.024, 0.005, -L / 2 + (i ? 0.01 : -0.008)], { bevel: 0.002 }), frame));
    }
    const groups = ["memb1", "memb1", "memb2", "memb2", "memb2", "memb3", "memb3", "memb3", "memb3", "memb2", "memb2", "memb2", "memb1", "memb1", "memb3", "memb3"];
    const bx0 = left + 0.18, step = (pw / 2 - 0.03 - bx0) / 16;
    for (let i = 0; i < 16; i++) for (const r of [0, 1]) {
      pieces.push(into(box(groups[i]!, [step * 0.7, 0.003, 0.014], [bx0 + step * (i + 0.5), 0.0015, -L / 2 + (r ? 0.012 : -0.012)], { bevel: 0.001 }), frame));
    }
    pieces.push(into(box("ink", [pw - 0.2, 0.002, 0.002], [0.08, 0.001, -L + 0.008]), frame));
  } else {
    // the organ: nine drawbars standing out of a well, then the rocker tabs to their right
    const wellW = 0.24, wx = -pw / 2 + 0.06 + wellW / 2;
    pieces.push(into(box("slot", [wellW, 0.004, 0.06], [wx, 0.0005, -L / 2]), frame));
    const caps = ["brownBar", "brownBar", "whiteBar", "whiteBar", "blackBar", "whiteBar", "blackBar", "blackBar", "whiteBar"];
    caps.forEach((c, i) => {
      const x = wx - wellW / 2 + 0.014 + i * ((wellW - 0.028) / 8), out = 0.02 + ((seed >> i) & 3) * 0.012;
      pieces.push(into(box("trim", [0.006, out, 0.006], [x, out / 2, -L / 2]), frame));
      pieces.push(into(box(c, [0.016, 0.024, 0.012], [x, out + 0.012, -L / 2], { bevel: 0.003 }), frame));
    });
    for (let i = 0; i < 8; i++) pieces.push(into(box("tab", [0.022, 0.008, 0.036], [wx + wellW / 2 + 0.05 + i * 0.03, 0.004, -L / 2], { bevel: 0.002, rot: [i % 3 ? 0.12 : -0.12, 0, 0] }), frame));
    for (let i = 0; i < 3; i++) knob(pieces, at(pw / 2 - 0.05 - i * 0.05, -L / 2), 0.012);
  }

  // ---- the X stand ----
  for (const s of [-1, 1]) {
    // a little short of the diagonal, so the square legs' corners stay above the floor and under the case
    const sx = s * (w / 2 - 0.12), len = Math.hypot(base, d * 0.85) - 0.035, lean = Math.atan2(d * 0.85, base);
    for (const k of [-1, 1]) pieces.push(box("stand", [0.028, len, 0.028], [sx, base / 2, mid], { rot: [k * lean, 0, 0] }));
    pieces.push(box("stand", [0.04, 0.02, d * 0.85 + 0.06], [sx, 0.01, mid]));
    pieces.push(box("rubber", [0.05, 0.012, 0.03], [sx, base - 0.006, mid]));
  }

  const caseColor = organ ? pick(["#9e1f1a", "#7c1712"]) : kind === "fm-slab" ? "#16120f" : "#121315";
  const palette: Palette = {
    case: [caseColor, organ ? 0.35 : 0.55, organ ? 0.05 : 0.15], end: [kind === "fm-slab" ? "#1b1714" : "#141414", 0.5, 0.1],
    panel: [organ ? "#191919" : kind === "fm-slab" ? "#2a241f" : "#0c0d0f", 0.45, 0.25], wood: [pick(["#4a2a16", "#5a3420", "#3e2414"]), 0.5, 0],
    trim: ["#a4a7ab", 0.35, 0.85], felt: [kind === "fm-slab" ? "#111" : "#8e1a1a", 0.95, 0], slot: ["#040404", 0.9, 0], rubber: ["#1a1a1a", 0.9, 0],
    knob: ["#0b0b0c", 0.45, 0.1], cap: ["#c9ccd0", 0.3, 0.9], ink: ["#e8e4d8", 0.6, 0], button: ["#dcd3bd", 0.5, 0],
    lamp: ["#ff3a2a", 0.3, 0, 1.6], lampOff: ["#4a1210", 0.4, 0], screen: [kind === "fm-slab" ? "#8fe37a" : "#ff3324", 0.3, 0, 1.2],
    memb1: ["#6f9a6a", 0.6, 0], memb2: ["#a88f6a", 0.6, 0], memb3: ["#55708e", 0.6, 0],
    brownBar: ["#5b351d", 0.4, 0], whiteBar: ["#ece6d8", 0.4, 0], blackBar: ["#111", 0.4, 0], tab: ["#ece6d8", 0.4, 0],
    stand: ["#232427", 0.4, 0.7],
  };
  const group = part("polysynth", pieces, palette);

  // ---- the keys: white keys with a gap between, black ones raised, set back, their tops narrower than their feet ----
  const steps = [0, 1, 3, 4, 5];
  const whiteAt: [number, number, number][] = [], blackAt: [number, number, number][] = [];
  for (let i = 0; i < WHITES; i++) {
    whiteAt.push([kx0 + kw * (i + 0.5), keyTop - 0.011, keyZ]);
    if (steps.includes(i % 7) && i < WHITES - 1) blackAt.push([kx0 + kw * (i + 1), keyTop + 0.009, keyZ - KEY_D * 0.2]);
  }
  const whiteLen = KEY_D, blackLen = KEY_D * 0.6;
  const blackGeo = new THREE.BoxGeometry(kw * 0.56, 0.022, blackLen), p = blackGeo.attributes.position!;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.78); if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) - 0.008); }
  blackGeo.computeVertexNormals();
  // the organ's keys are flat-fronted (waterfall); the others have a lip under the front
  const whiteGeo = new THREE.BoxGeometry(kw - 0.0022, 0.022, whiteLen);
  const white = new THREE.InstancedMesh(whiteGeo, new THREE.MeshStandardMaterial({ color: "#e8e3d6", roughness: 0.42 }), whiteAt.length);
  const black = new THREE.InstancedMesh(blackGeo, new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.32 }), blackAt.length);
  white.name = "white-keys"; black.name = "black-keys";
  const m = new THREE.Matrix4(), blackRest = new THREE.Color("#060607");
  whiteAt.forEach((q, i) => white.setMatrixAt(i, m.makeTranslation(...q)));
  blackAt.forEach((q, i) => { black.setMatrixAt(i, m.makeTranslation(...q)); black.setColorAt(i, blackRest); });
  group.add(white, black);

  return {
    group, kind, size: { w, d, h: topY + 0.03 }, count: 61, keyTop, keyFront,
    keys: { white, black, whiteAt, blackAt, whiteLen, blackLen, blackRest, whites: WHITES },
  };
}

/** A small knob: a skirt, a fluted body and a silver cap with a pointer line, at `m` (the panel's frame moved to it). */
function knob(pieces: Piece[], m: THREE.Matrix4, r: number) {
  pieces.push(into(loft("knob", [R(0, r * 1.25), R(0.003, r * 1.25), R(0.004, r * 0.95), R(0.015, r * 0.85), R(0.017, r * 0.75)], { seg: 12 }), m));
  pieces.push(into(loft("cap", [R(0.017, r * 0.66), R(0.0185, r * 0.62), R(0.0185, 0)], { seg: 12 }), m));
  pieces.push(into(box("ink", [0.002, 0.002, r * 0.6], [0, 0.019, -r * 0.25]), m));
}
