// The zone from above: where you drop, and the rangers' radio map. Shaded
// relief from the real heightmap, the bushes and trees, the signposts, the
// ranger cabin, the closing circle, and (for rangers) where the radio says
// campers could be.

import type { Grid } from "../grid.ts";
import { possible, toGame, type Clue } from "../clues.ts";
import { circleAt, type View } from "../hunt/game.ts";
import type { Zone } from "../zones/zone.ts";

export class ZoneMap {
  private ctx: CanvasRenderingContext2D;
  private base: { id: string; canvas: HTMLCanvasElement } | null = null;
  private shade: { key: string; canvas: HTMLCanvasElement } | null = null;
  onClick: (x: number, y: number) => void = () => {};
  /** Screen <-> game: game (x, y) is at (cx + x * s, cy - y * s). */
  private t = { cx: 0, cy: 0, s: 1 };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      this.onClick((e.clientX - r.left - this.t.cx) / this.t.s, -(e.clientY - r.top - this.t.cy) / this.t.s);
    });
  }

  private bake(z: Zone): HTMLCanvasElement {
    if (this.base?.id === z.data.id) return this.base.canvas;
    const n = z.n, px = 3, size = n * px;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    const img = g.createImageData(n, n);
    let lo = Infinity, hi = -Infinity;
    for (const v of z.h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
      const i = r * n + col;
      const ex = z.h[r * n + Math.min(n - 1, col + 1)] - z.h[r * n + Math.max(0, col - 1)];
      const ey = z.h[Math.min(n - 1, r + 1) * n + col] - z.h[Math.max(0, r - 1) * n + col];
      // Light from the north-west.
      const shade = Math.max(0.35, Math.min(1.25, 0.85 + (-ex + ey) / (2 * z.step) * 0.5));
      const t = (z.h[i] - lo) / (hi - lo || 1);
      const s = Math.hypot(ex, ey) / (2 * z.step);
      const base = s > 1 ? [150, 146, 138] : [118 + t * 60, 140 + t * 25, 92 + t * 40];
      const o = ((n - 1 - r) * n + col) * 4; // canvas rows top-down (north first)
      img.data[o] = base[0] * shade; img.data[o + 1] = base[1] * shade; img.data[o + 2] = base[2] * shade; img.data[o + 3] = 255;
    }
    const small = document.createElement("canvas");
    small.width = small.height = n;
    small.getContext("2d")!.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(small, 0, 0, size, size);
    // Props as dots, at map scale.
    const k = size / (2 * z.R);
    const at = (x: number, y: number) => [(x + z.R) * k, (z.R - y) * k] as const;
    for (const p of z.props) {
      const [x, y] = at(p.x, p.y);
      if (p.kind === "bush") { g.fillStyle = "rgba(60, 110, 40, 0.9)"; g.beginPath(); g.arc(x, y, Math.max(1.2, p.size * k), 0, 7); g.fill(); }
      else if (p.kind === "pine" || p.kind === "sequoia") { g.fillStyle = p.kind === "pine" ? "rgba(25, 55, 25, 0.75)" : "rgba(120, 50, 25, 0.85)"; g.beginPath(); g.arc(x, y, Math.max(1.5, (p.kind === "pine" ? 2.2 : 4) * p.size * k), 0, 7); g.fill(); }
      else if (p.kind === "boulder") { g.fillStyle = "rgba(110, 108, 100, 0.9)"; g.beginPath(); g.arc(x, y, Math.max(1, p.r * k), 0, 7); g.fill(); }
      else if (p.kind === "tent") { g.fillStyle = "#e0702b"; g.fillRect(x - 2, y - 2, 4, 4); }
    }
    this.base = { id: z.data.id, canvas: c };
    return c;
  }

  /** Cells the radio rules out, shaded. */
  private shadeFor(g: Grid, key: string, clues: Clue[]): HTMLCanvasElement {
    if (this.shade?.key === key) return this.shade.canvas;
    const mask = possible(g, clues);
    const c = this.shade?.canvas ?? document.createElement("canvas");
    c.width = g.cols; c.height = g.rows;
    const x = c.getContext("2d")!;
    const img = x.createImageData(g.cols, g.rows);
    for (const i of g.parkCells) {
      if (mask[i]) continue;
      const col = i % g.cols, row = Math.floor(i / g.cols);
      const o = ((g.rows - 1 - row) * g.cols + col) * 4;
      img.data[o] = 30; img.data[o + 1] = 22; img.data[o + 2] = 14; img.data[o + 3] = (row + col) % 4 === 0 ? 190 : 150;
    }
    x.putImageData(img, 0, 0);
    this.shade = { key, canvas: c };
    return c;
  }

  render(v: View, z: Zone, opts: { me: { x: number; y: number; yaw: number } | null; grid: Grid | null; clues: Clue[] | null; cluesKey: string; now: number; drop: [number, number] | null; canDrop: (x: number, y: number) => boolean; hover: [number, number] | null }) {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = (Math.min(w, h) * 0.46) / z.R;
    this.t = { cx: w / 2, cy: h / 2, s };
    const X = (x: number) => w / 2 + x * s, Y = (y: number) => h / 2 - y * s;

    // The map, clipped to the zone circle.
    ctx.save();
    ctx.beginPath(); ctx.arc(X(0), Y(0), z.R * s, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(this.bake(z), X(-z.R), Y(z.R), 2 * z.R * s, 2 * z.R * s);
    if (opts.grid && opts.clues && opts.clues.length) {
      const g = opts.grid;
      const sh = this.shadeFor(g, opts.cluesKey, opts.clues);
      ctx.imageSmoothingEnabled = false;
      const x0 = toGame(g.x0), y1 = toGame(g.y0 + g.rows * g.cell);
      ctx.drawImage(sh, X(x0), Y(y1), toGame(g.cols * g.cell) * s, toGame(g.rows * g.cell) * s);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.restore();
    ctx.strokeStyle = "#2b2116"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(0), Y(0), z.R * s, 0, Math.PI * 2); ctx.stroke();

    // The closing circle and where it ends up.
    const c = v.round?.circle;
    if (c && v.phase === "hunt") {
      const k = circleAt(c, opts.now);
      ctx.strokeStyle = "rgba(255, 140, 50, 0.95)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(X(k.x), Y(k.y), k.r * s, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(255, 209, 102, 0.95)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(c.x1), Y(c.y1), c.r1 * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }

    // During the drop: the no-drop area round the cabin.
    const st = z.station;
    if (v.phase === "drop") {
      ctx.fillStyle = "rgba(170, 40, 25, 0.25)"; ctx.strokeStyle = "rgba(170, 40, 25, 0.8)"; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(X(st.x), Y(st.y), 45 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
    this.icon(X(st.x), Y(st.y), "⌂", "#7a2418", 20);
    this.label(X(st.x), Y(st.y) + 18, "Ranger station", "#7a2418");
    ctx.font = "600 11px ui-sans-serif, system-ui";
    for (const m of z.landmarks) {
      if (!z.inside(m.gx, m.gy)) continue;
      this.icon(X(m.gx), Y(m.gy), m.kind === "peak" ? "▲" : m.kind === "falls" ? "≋" : "◆", "#2b2116", 11);
      this.label(X(m.gx) + 8, Y(m.gy) - 8, m.name, "#2b2116", "left");
    }

    // Cues you can hear (rangers), and teammates.
    for (const cue of v.round?.cues ?? []) {
      if (cue.kind !== "rustle" && cue.kind !== "step") continue;
      const age = (opts.now - cue.at) / 1000;
      ctx.strokeStyle = cue.kind === "rustle" ? `rgba(120, 220, 90, ${1 - age / 5})` : `rgba(240, 200, 100, ${1 - age / 5})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(cue.x), Y(cue.y), 4 + age * 3, 0, Math.PI * 2); ctx.stroke();
    }
    for (const o of v.round?.others ?? []) {
      ctx.fillStyle = o.role === "ranger" ? "#e8c547" : o.caughtAt !== null ? "#888" : "#ffffff";
      ctx.strokeStyle = "#2b2116"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // Your drop, or where you'd drop.
    const drop = opts.drop;
    if (opts.hover && v.phase === "drop") {
      const ok = opts.canDrop(opts.hover[0], opts.hover[1]);
      ctx.strokeStyle = ok ? "rgba(255, 255, 255, 0.9)" : "rgba(220, 50, 30, 0.9)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(opts.hover[0]), Y(opts.hover[1]), 9, 0, Math.PI * 2); ctx.stroke();
    }
    if (drop) {
      const [dx, dy] = [X(drop[0]), Y(drop[1])];
      ctx.fillStyle = "#2f7d32"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx - 9, dy - 20); ctx.arc(dx, dy - 20, 9, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      this.label(dx, dy - 38, "Your drop", "#1d5420");
    }
    if (opts.me) {
      const { x, y, yaw } = opts.me;
      ctx.save();
      ctx.translate(X(x), Y(y)); ctx.rotate(yaw);
      ctx.fillStyle = "#ff5a3c"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 7); ctx.lineTo(0, 3); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // Scale bar in real metres (the park's own distances).
    const real = 200, bar = (real / 6) * s;
    ctx.fillStyle = "rgba(246, 240, 225, 0.9)"; ctx.fillRect(10, h - 30, bar + 70, 22);
    ctx.fillStyle = "#2b2116"; ctx.fillRect(16, h - 16, bar, 4);
    ctx.font = "600 11px ui-sans-serif, system-ui"; ctx.textAlign = "left"; ctx.fillText(`${real} m`, 22 + bar, h - 12);
  }

  private icon(x: number, y: number, ch: string, color: string, size: number) {
    const { ctx } = this;
    ctx.font = `${size}px ui-sans-serif, system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255, 250, 238, 0.9)"; ctx.lineJoin = "round"; ctx.strokeText(ch, x, y);
    ctx.fillStyle = color; ctx.fillText(ch, x, y);
  }

  private label(x: number, y: number, text: string, color: string, align: CanvasTextAlign = "center") {
    const { ctx } = this;
    ctx.font = "600 11px ui-sans-serif, system-ui"; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255, 250, 238, 0.9)"; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
}
