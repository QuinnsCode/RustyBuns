// A person's avatar: a few chosen parts, saved on their profile (users.avatar, JSON) and worn
// in the code city. The worker checks what's saved (cleanAvatar), the profile editor and the
// city draw it, so build.ts bundles this file for the browser as /avatar.js. Pure: no DOM, no imports.

/** What each part can be. Colors are any #rrggbb; these are the palettes the editor offers. */
export const PARTS = {
  skin: ["#f7d6b8", "#ecbf96", "#d49a6a", "#a8693f", "#7a4a2c", "#4e2e1b", "#c9e4c5", "#bcd0f2"],
  hair: ["none", "short", "bob", "long", "spiky", "afro", "mohawk", "bun", "pigtails"],
  hairColor: ["#16191c", "#4a2f1d", "#8a5a3c", "#d8b04a", "#e8590c", "#c23a6b", "#3a6bd8", "#f4f5f5"],
  hat: ["none", "cap", "beanie", "tophat", "hardhat", "cat-ears", "halo"],
  eyes: ["dot", "wide", "sleepy", "happy", "wink", "angry"],
  mouth: ["smile", "grin", "flat", "o", "tongue", "frown"],
  glasses: ["none", "round", "square", "shades"],
  top: ["tee", "hoodie", "suit", "dress", "overalls", "hawaiian"],
  topColor: ["#16191c", "#f4f5f5", "#e8590c", "#3a6bd8", "#2f8f5a", "#c23a6b", "#8a5cff", "#f4d03a"],
  bottomColor: ["#16191c", "#2e3439", "#3a4a6b", "#6b4a2c", "#8a8f94", "#e8e0cc"],
  build: ["slim", "round", "tall", "short"],
} as const;

export type Avatar = { [K in keyof typeof PARTS]: string };

const COLORS = new Set<keyof typeof PARTS>(["skin", "hairColor", "topColor", "bottomColor"]);
const HEX = /^#[0-9a-f]{6}$/i;

/** A saved avatar as it should be: every part present and valid, or null when the input isn't one. Extra keys are dropped. */
export function cleanAvatar(x: unknown): Avatar | null {
  if (!x || typeof x !== "object") return null;
  const out: Record<string, string> = {};
  for (const k of Object.keys(PARTS) as (keyof typeof PARTS)[]) {
    const v = (x as Record<string, unknown>)[k];
    if (typeof v !== "string") return null;
    if (COLORS.has(k) ? !HEX.test(v) : !(PARTS[k] as readonly string[]).includes(v)) return null;
    out[k] = COLORS.has(k) ? v.toLowerCase() : v;
  }
  return out as Avatar;
}

/** One at random from `r` (a 0..1 source), so a seeded one is the same for everyone. Hats and glasses are rarer. */
export function randomAvatar(r: () => number): Avatar {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const out: Record<string, string> = {};
  for (const k of Object.keys(PARTS) as (keyof typeof PARTS)[]) out[k] = pick(PARTS[k]);
  if (r() < 0.6) out.hat = "none";
  if (r() < 0.6) out.glasses = "none";
  return out as Avatar;
}

/** What someone who never made one wears: from their name, so they're still themselves. */
export function defaultAvatar(name: string): Avatar {
  let a = 2166136261;
  for (let i = 0; i < name.length; i++) a = Math.imul(a ^ name.charCodeAt(i), 16777619);
  a >>>= 0;
  return randomAvatar(() => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; });
}

type Ctx = { [k: string]: any };

/** The avatar head to toe on a 2D canvas context at (x, y) (its feet, centred), `h` tall: the editor's preview. */
export function drawAvatar(g: Ctx, a: Avatar, x: number, y: number, h: number) {
  const u = h / 100, w = a.build === "round" ? 34 : a.build === "slim" ? 24 : 28, legH = a.build === "tall" ? 30 : a.build === "short" ? 16 : 24;
  const box = (px: number, py: number, pw: number, ph: number, c: string, r = 0) => { g.fillStyle = c; g.beginPath(); g.roundRect(x + px * u, y + py * u, pw * u, ph * u, r * u); g.fill(); };
  const headY = -(legH + 26 + 36), cy = headY + 18;
  // legs and shoes
  box(-w / 2 + 2, -legH, w / 2 - 3, legH, a.bottomColor, 2); box(1, -legH, w / 2 - 3, legH, a.bottomColor, 2);
  box(-w / 2, -3, w / 2 - 1, 3, "#16191c", 1.5); box(1, -3, w / 2 - 1, 3, "#16191c", 1.5);
  // body, arms
  const by = -(legH + 26);
  box(-w / 2, by, w, 26, a.top === "suit" ? "#2e3439" : a.topColor, a.top === "dress" ? 8 : 5);
  if (a.top === "dress") box(-w / 2 - 3, by + 18, w + 6, 12, a.topColor, 4);
  if (a.top === "overalls") { box(-w / 2, by + 12, w, 14, "#3a6bd8", 3); box(-w / 2 + 3, by, 3, 12, "#3a6bd8"); box(w / 2 - 6, by, 3, 12, "#3a6bd8"); }
  if (a.top === "suit") { box(-1.5, by, 3, 26, "#f4f5f5"); box(-1, by + 3, 2, 12, "#e8590c"); }
  if (a.top === "hoodie") box(-w / 3, by - 2, w * 0.66, 5, a.topColor, 3);
  if (a.top === "hawaiian") for (const [dx, dy] of [[-8, 5], [4, 11], [-3, 18], [9, 4]]) { g.fillStyle = "#f4f5f5"; g.beginPath(); g.arc(x + dx * u, y + (by + dy) * u, 2 * u, 0, 7); g.fill(); }
  box(-w / 2 - 5, by + 2, 5, 18, a.top === "suit" ? "#2e3439" : a.topColor, 2.5); box(w / 2, by + 2, 5, 18, a.top === "suit" ? "#2e3439" : a.topColor, 2.5);
  box(-w / 2 - 5, by + 19, 5, 5, a.skin, 2.5); box(w / 2, by + 19, 5, 5, a.skin, 2.5);
  // hair behind, head, face
  const hc = a.hairColor;
  if (a.hair === "long") box(-21, headY + 8, 42, 40, hc, 12);
  if (a.hair === "bob") box(-21, headY + 8, 42, 26, hc, 12);
  if (a.hair === "pigtails") { box(-30, headY + 20, 10, 24, hc, 5); box(20, headY + 20, 10, 24, hc, 5); }
  if (a.hair === "afro") { g.fillStyle = hc; g.beginPath(); g.arc(x, y + (headY + 14) * u, 27 * u, 0, 7); g.fill(); }
  box(-18, headY, 36, 36, a.skin, 15);
  // hair on top
  g.fillStyle = hc;
  if (a.hair === "short" || a.hair === "bob" || a.hair === "long" || a.hair === "pigtails" || a.hair === "bun") box(-19, headY - 2, 38, 13, hc, 8);
  if (a.hair === "bun") { g.beginPath(); g.arc(x, y + (headY - 6) * u, 7 * u, 0, 7); g.fill(); }
  if (a.hair === "spiky") for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(x + (i * 7 - 4) * u, y + (headY + 6) * u); g.lineTo(x + i * 7 * u, y + (headY - 10 - (2 - Math.abs(i)) * 2) * u); g.lineTo(x + (i * 7 + 4) * u, y + (headY + 6) * u); g.fill(); }
  if (a.hair === "mohawk") box(-4, headY - 12, 8, 20, hc, 3);
  if (a.hair === "afro") box(-19, headY, 38, 8, hc, 6);
  drawFace(g, a, x, y + cy * u, u);
  // hats
  if (a.hat === "cap") { box(-20, headY - 5, 40, 12, "#e8590c", 8); box(2, headY + 3, 24, 4, "#e8590c", 2); }
  else if (a.hat === "beanie") { box(-20, headY - 8, 40, 16, "#3a6bd8", 9); box(-3, headY - 14, 6, 6, "#f4f5f5", 3); }
  else if (a.hat === "tophat") { box(-24, headY - 2, 48, 5, "#16191c", 2); box(-14, headY - 24, 28, 24, "#16191c", 2); box(-14, headY - 8, 28, 4, "#c23a6b"); }
  else if (a.hat === "hardhat") { box(-21, headY - 6, 42, 13, "#f4d03a", 9); box(-4, headY - 10, 8, 6, "#f4d03a", 2); }
  else if (a.hat === "cat-ears") for (const s of [-1, 1]) { g.fillStyle = a.hairColor; g.beginPath(); g.moveTo(x + s * 18 * u, y + (headY + 2) * u); g.lineTo(x + s * 14 * u, y + (headY - 14) * u); g.lineTo(x + s * 3 * u, y + (headY - 1) * u); g.fill(); }
  else if (a.hat === "halo") { g.strokeStyle = "#f4d03a"; g.lineWidth = 3 * u; g.beginPath(); g.ellipse(x, y + (headY - 8) * u, 14 * u, 4 * u, 0, 0, 7); g.stroke(); }
}

/** Eyes, mouth and glasses, centred on (x, cy) with `u` pixels a unit: the face of the 2D figure, and the texture on the 3D head. */
export function drawFace(g: Ctx, a: Avatar, x: number, cy: number, u: number) {
  g.fillStyle = "#16191c"; g.strokeStyle = "#16191c"; g.lineWidth = 2 * u; g.lineCap = "round";
  for (const s of [-1, 1]) {
    const ex = x + s * 8 * u, ey = cy - 2 * u;
    if (a.eyes === "dot") { g.beginPath(); g.arc(ex, ey, 2.2 * u, 0, 7); g.fill(); }
    else if (a.eyes === "wide") { g.fillStyle = "#fff"; g.beginPath(); g.arc(ex, ey, 4 * u, 0, 7); g.fill(); g.fillStyle = "#16191c"; g.beginPath(); g.arc(ex, ey, 2 * u, 0, 7); g.fill(); }
    else if (a.eyes === "sleepy") { g.beginPath(); g.moveTo(ex - 3 * u, ey); g.lineTo(ex + 3 * u, ey); g.stroke(); }
    else if (a.eyes === "happy") { g.beginPath(); g.arc(ex, ey + 1.5 * u, 3 * u, Math.PI, 0); g.stroke(); }
    else if (a.eyes === "wink") { if (s < 0) { g.beginPath(); g.arc(ex, ey, 2.2 * u, 0, 7); g.fill(); } else { g.beginPath(); g.moveTo(ex - 3 * u, ey); g.lineTo(ex + 3 * u, ey); g.stroke(); } }
    else { g.beginPath(); g.arc(ex, ey, 2 * u, 0, 7); g.fill(); g.beginPath(); g.moveTo(ex - 4 * u, ey + (s < 0 ? -5 : -2) * u); g.lineTo(ex + 4 * u, ey + (s < 0 ? -2 : -5) * u); g.stroke(); }
  }
  const my = cy + 9 * u;
  if (a.mouth === "smile") { g.beginPath(); g.arc(x, my - 3 * u, 5 * u, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
  else if (a.mouth === "grin") { g.fillStyle = "#fff"; g.beginPath(); g.arc(x, my - 3 * u, 6 * u, 0, Math.PI); g.fill(); g.stroke(); }
  else if (a.mouth === "flat") { g.beginPath(); g.moveTo(x - 4 * u, my); g.lineTo(x + 4 * u, my); g.stroke(); }
  else if (a.mouth === "o") { g.beginPath(); g.arc(x, my, 2.8 * u, 0, 7); g.stroke(); }
  else if (a.mouth === "tongue") { g.beginPath(); g.arc(x, my - 3 * u, 5 * u, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); g.fillStyle = "#e8590c"; g.beginPath(); g.arc(x + 2 * u, my + 3 * u, 2.4 * u, 0, 7); g.fill(); }
  else { g.beginPath(); g.arc(x, my + 3 * u, 5 * u, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke(); }
  // glasses
  if (a.glasses !== "none") {
    g.strokeStyle = a.glasses === "shades" ? "#16191c" : "#2e3439"; g.lineWidth = 1.6 * u;
    for (const s of [-1, 1]) {
      const ex = x + s * 8 * u, ey = cy - 2 * u;
      if (a.glasses === "round") { g.beginPath(); g.arc(ex, ey, 5.5 * u, 0, 7); g.stroke(); }
      else if (a.glasses === "square") g.strokeRect(ex - 5.5 * u, ey - 4.5 * u, 11 * u, 9 * u);
      else { g.fillStyle = "#16191c"; g.fillRect(ex - 6 * u, ey - 4 * u, 12 * u, 8 * u); }
    }
    g.beginPath(); g.moveTo(x - 3 * u, cy - 2 * u); g.lineTo(x + 3 * u, cy - 2 * u); g.stroke();
  }
}
