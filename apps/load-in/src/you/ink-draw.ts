// The ink on the skin: one canvas per forearm, laid over the arm's unwrapped rectangle (round the arm across, wrist at
// the bottom, elbow at the top). White is bare skin (the map multiplies the skin colour), ink is a soft blue-black
// with one or two flat colours, the way healed traditional flash looks.
import { FLASH, type Arm, type Look } from "./ink.ts";

const SIZE = 512;
/** How far round the sheet the top of the forearm is (the side you see), and the way up a drawing faces from your eyes. */
export const TOP_U = 0.38, FACING = Math.PI;
const INK = "rgba(22, 30, 48, 0.86)", RED = "rgba(150, 38, 32, 0.8)", GREEN = "rgba(36, 92, 70, 0.8)", GOLD = "rgba(176, 128, 28, 0.8)";

type Pen = CanvasRenderingContext2D;
const line = (g: Pen, pts: number[], close = false) => { g.beginPath(); for (let i = 0; i < pts.length; i += 2) g[i ? "lineTo" : "moveTo"](pts[i]!, pts[i + 1]!); if (close) g.closePath(); };
const ring = (g: Pen, x: number, y: number, r: number) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); };
const fill = (g: Pen, colour: string) => { g.fillStyle = colour; g.fill(); g.stroke(); };
const banner = (g: Pen, y: number) => { line(g, [-0.9, y, -0.6, y + 0.12, 0.6, y + 0.12, 0.9, y, 0.6, y + 0.36, -0.6, y + 0.36], true); fill(g, GOLD); };

/** Each rung's tattoo, drawn in a box from -1 to 1 with y down. */
const DRAW: Record<string, (g: Pen) => void> = {
  "first-gig"(g) { for (const r of [0.62, 0.46, 0.3]) { ring(g, 0, -0.2, r); g.stroke(); } line(g, [0.5, 0.18, 0.78, 0.5]); g.stroke(); banner(g, 0.5); },
  "dive-bar"(g) {
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(0.62 * s, 0.2, 0.36, 0.16, -0.7 * s, 0, Math.PI * 2); fill(g, GREEN); }
    ring(g, 0, 0, 0.5); fill(g, RED);
    for (const [x, y] of [[-0.2, -0.12], [0.2, -0.12], [0, 0.22]]) { ring(g, x!, y!, 0.07); g.fillStyle = INK; g.fill(); }
  },
  "bigger-bar"(g) { line(g, [0.2, -0.95, -0.5, 0.1, -0.05, 0.1, -0.3, 0.95, 0.55, -0.2, 0.08, -0.2], true); fill(g, GOLD); },
  park(g) { line(g, [-0.1, 0.1, -0.1, 0.5, 0.1, 0.5, 0.1, 0.1], true); fill(g, GOLD); ring(g, 0, -0.3, 0.52); fill(g, GREEN); g.strokeRect(-0.3, 0.5, 0.6, 0.42); ring(g, 0, 0.71, 0.13); g.stroke(); },
  desert(g) {
    for (let i = 0; i < 9; i++) { const a = Math.PI + (i / 8) * Math.PI; line(g, [Math.cos(a) * 0.5, -0.15 + Math.sin(a) * 0.5, Math.cos(a) * 0.82, -0.15 + Math.sin(a) * 0.82]); g.stroke(); }
    g.beginPath(); g.arc(0, -0.15, 0.4, Math.PI, 0); g.closePath(); fill(g, RED);
    for (const y of [-0.15, 0.2, 0.55]) { g.beginPath(); g.rect(-0.34, y, 0.68, 0.35); fill(g, "rgba(22, 30, 48, 0.25)"); ring(g, 0, y + 0.175, 0.11); g.stroke(); }
  },
  festival(g) { line(g, [0, -0.5, 0, -0.95]); g.stroke(); line(g, [0, -0.95, 0.4, -0.82, 0, -0.68], true); fill(g, RED); line(g, [0, -0.5, -0.85, 0.7, 0.85, 0.7], true); fill(g, GOLD); line(g, [0, -0.5, -0.22, 0.7, 0.22, 0.7], true); fill(g, RED); },
  "small-arena"(g) {
    for (const y of [-0.85, -0.5]) { g.beginPath(); g.ellipse(0, y, 0.13, 0.22, 0, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(0, -0.3); g.lineTo(0, 0.25); g.arc(-0.3, 0.3, 0.3, 0, Math.PI * 0.95); g.stroke();
    ring(g, 0, -0.18, 0.14); fill(g, GOLD);
  },
  arena(g) { for (let i = 0; i < 6; i++) { g.save(); g.translate(-0.25 + i * i * 0.022, -0.82 + i * 0.3); g.rotate(i * 0.11); g.beginPath(); g.rect(-0.42, -0.12, 0.84, 0.24); fill(g, i % 2 ? RED : "rgba(22, 30, 48, 0.25)"); g.restore(); } },
  amphitheatre(g) { ring(g, 0.05, -0.55, 0.22); fill(g, GOLD); line(g, [-0.95, 0.8, -0.7, -0.5, -0.2, 0.1, -0.05, 0.8], true); fill(g, RED); line(g, [0.95, 0.8, 0.75, -0.35, 0.3, 0.2, 0.1, 0.8], true); fill(g, RED); line(g, [-0.3, 0.8, 0.3, 0.8]); g.stroke(); },
};

/** One forearm's skin sheet: the tattoos earned that sit on this arm, and your own if it is on this arm. */
export function inkSheet(arm: Arm, levels: readonly string[], look: Look, own: CanvasImageSource | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, SIZE, SIZE);
  const place = (at: number, round: number, half: number, draw: () => void) => {
    // Twice, a sheet apart, so one that crosses the seam still wraps.
    for (const wrap of [0, -1, 1]) { g.save(); g.translate(((arm === "left" ? TOP_U + round : 1 - TOP_U - round) + wrap) * SIZE, (1 - at) * SIZE); g.rotate(FACING); g.scale(half, half); draw(); g.restore(); }
  };
  g.filter = "blur(0.7px)";
  g.lineJoin = g.lineCap = "round";
  for (const level of levels) {
    const f = FLASH[level];
    if (!f || f.arm !== arm || !DRAW[level]) continue;
    place(f.at, f.round, 66, () => { g.strokeStyle = INK; g.lineWidth = 0.085; DRAW[level]!(g); });
  }
  if (own && look.arm === arm) {
    const w = "width" in own && typeof own.width === "number" ? own.width : 1, h = "height" in own && typeof own.height === "number" ? own.height : 1;
    // Multiply, so the paper it was drawn on drops out and the ink stays.
    g.globalCompositeOperation = "multiply"; g.globalAlpha = 0.88;
    place(look.at, 0, (look.size * SIZE) / 2, () => g.drawImage(own, -1, -h / w, 2, (2 * h) / w));
  }
  return c;
}
