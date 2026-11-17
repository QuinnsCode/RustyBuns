// A keyboard synth on an X stand, grown from a seed: Qollab Studio's made instruments (an agent's or a person's
// `make_instrument`), so a new FM DAW track is something you walk up to and play. The seed picks the size (25 to
// 61 keys), the panel's colour and how its controls sit; the voice picks the panel: an analog one has wooden
// cheeks and rows of knobs, an FM one a glowing display and a bank of sliders. Feet on the floor at y = 0,
// centred on x and z, the keys toward +z (where the player sits), metres. Materials come from its own palette.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { type Palette, type Piece, box, part } from "./shapes.ts";

export type SynthVoice = "fm" | "analog";
export interface Synth { group: THREE.Group; size: { w: number; d: number; h: number }; keys: number }

const KEY_W = 0.0235;              // a white key's width
const STAND_H = 0.74;              // where the case sits
const PANELS = ["#1d2026", "#e9e4d8", "#b23a2e", "#2f5d7c", "#3f5a3a", "#c98b2b", "#6b4a7a"];

/** The synth for `seed` with `voice`'s panel. The same seed always grows the same synth. */
export function synth(seed: number, voice: SynthVoice): Synth {
  const rnd = mulberry32(seed >>> 0);
  const pick = <T>(l: readonly T[]) => l[Math.floor(rnd() * l.length)];
  const octaves = pick([2, 3, 4, 5] as const), whites = octaves * 7 + 1, keys = octaves * 12 + 1;
  const cheek = voice === "analog" ? 0.05 : 0.02, keysW = whites * KEY_W, w = keysW + cheek * 2 + 0.04;
  const d = 0.3 + rnd() * 0.1, caseH = 0.09 + rnd() * 0.03, top = STAND_H + caseH;
  const keyD = 0.14, keyZ = d / 2 - keyD / 2 - 0.01;
  const pieces: Piece[] = [];
  // the case, its panel behind the keys raked toward you, and the keys in their bed
  pieces.push(box("case", [w, caseH, d], [0, STAND_H + caseH / 2, 0], { bevel: 0.008 }));
  pieces.push(box("panel", [keysW, 0.012, d - keyD - 0.05], [0, top + 0.004, keyZ - keyD / 2 - (d - keyD - 0.05) / 2 - 0.01], { rot: [0.08, 0, 0] }));
  for (let i = 0; i < whites; i++) pieces.push(box("white", [KEY_W - 0.002, 0.02, keyD], [-keysW / 2 + KEY_W * (i + 0.5), top - 0.012, keyZ]));
  for (let i = 0; i < whites - 1; i++) {
    if ([2, 6].includes(i % 7)) continue;            // no black key between E-F and B-C
    pieces.push(box("black", [KEY_W * 0.55, 0.018, keyD * 0.6], [-keysW / 2 + KEY_W * (i + 1), top + 0.004, keyZ - keyD * 0.2]));
  }
  if (voice === "analog") {
    for (const s of [-1, 1]) pieces.push(box("wood", [cheek, caseH + 0.05, d], [s * (w / 2 - cheek / 2), STAND_H + (caseH + 0.05) / 2, 0], { bevel: 0.006 }));
    const rows = 2 + Math.floor(rnd() * 2), cols = Math.max(6, Math.floor(keysW / (0.05 + rnd() * 0.03)));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      pieces.push(box("knob", [0.022, 0.02, 0.022], [-keysW / 2 + (keysW * (c + 0.5)) / cols, top + 0.02, -d / 2 + 0.04 + r * 0.045], { bevel: 0.005 }));
    }
  } else {
    pieces.push(box("screen", [Math.min(0.24, keysW * 0.35), 0.006, 0.05], [-keysW / 4, top + 0.014, -d / 2 + 0.06]));
    const n = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) pieces.push(box("knob", [0.012, 0.03, 0.02], [keysW / 8 + i * 0.03, top + 0.02, -d / 2 + 0.06]));
  }
  // the X stand: two crossed legs each side, a foot along the floor under each
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.12), len = Math.hypot(STAND_H, d * 0.9), lean = Math.atan2(d * 0.9, STAND_H);
    for (const k of [-1, 1]) pieces.push(box("stand", [0.03, len, 0.03], [x, STAND_H / 2, 0], { rot: [k * lean, 0, 0] }));
    pieces.push(box("stand", [0.04, 0.02, d * 0.9 + 0.06], [x, 0.01, 0]));
  }
  const palette: Palette = {
    case: [pick(PANELS), 0.55, 0.1], panel: ["#202227", 0.7, 0], white: ["#f4f1ea", 0.45, 0], black: ["#121316", 0.5, 0],
    wood: ["#6b4426", 0.7, 0], knob: [pick(["#d8d4cc", "#c8a46a", "#16191c"]), 0.4, 0.5], screen: [pick(["#58e0a8", "#f0a040", "#7ac8ff"]), 0.3, 0, 1.2],
    stand: ["#2a2c30", 0.4, 0.7],
  };
  const group = part(`synth-${voice}`, pieces, palette);
  return { group, size: { w, d, h: top + 0.03 }, keys };
}
