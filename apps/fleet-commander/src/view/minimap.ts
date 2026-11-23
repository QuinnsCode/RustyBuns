// The minimap: the whole theater in a corner, drawn in 2D from the sim and the fog. Your ships and wings, the Compact
// ones your sensors see, the strongpoints by owner, the wells, and the box the camera sees. A click on it moves the
// view there; the page turns a right-click into an order at that point.
import type { World } from "../sim/world.ts";
import type { Fog } from "./fog.ts";

export class Minimap {
  private cx: CanvasRenderingContext2D;
  constructor(readonly canvas: HTMLCanvasElement) { this.cx = canvas.getContext("2d")!; }

  /** The sim point under a pixel of the minimap (CSS pixels from its top-left). */
  toSim(w: World, px: number, py: number) {
    const f = w.field!, r = this.canvas.getBoundingClientRect();
    return { x: (px / r.width) * 2 * f.wide - f.wide, z: (py / r.height) * 2 * f.deep - f.deep };
  }

  draw(w: World, fog: Fog | null, sel: Set<number>, target: number, view: { x: number; z: number }[] | null, ghosts?: Map<number, { x: number; z: number }>) {
    const f = w.field;
    if (!f) return;
    const c = this.cx, cv = this.canvas, dpr = Math.min(2, devicePixelRatio);
    const bw = Math.round(cv.clientWidth * dpr), bh = Math.round(cv.clientHeight * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const W = cv.width, H = cv.height;
    const u = (x: number) => ((x + f.wide) / (2 * f.wide)) * W, v = (z: number) => ((z + f.deep) / (2 * f.deep)) * H, k = (r: number) => (r / (2 * f.wide)) * W;
    const dot = (x: number, z: number, r: number, color: string) => { c.fillStyle = color; c.beginPath(); c.arc(u(x), v(z), r * dpr, 0, Math.PI * 2); c.fill(); };
    c.fillStyle = "#020b12"; c.fillRect(0, 0, W, H);
    for (const g of f.wells) {
      c.strokeStyle = g.kind === "rift" ? "rgba(150,110,255,0.35)" : "rgba(60,140,190,0.3)"; c.lineWidth = dpr;
      c.beginPath(); c.arc(u(g.x), v(g.z), k(g.r), 0, Math.PI * 2); c.stroke();
      if (g.core) { c.fillStyle = g.kind === "star" ? "#ffb050" : "#3a6a8a"; c.beginPath(); c.arc(u(g.x), v(g.z), Math.max(2 * dpr, k(g.core)), 0, Math.PI * 2); c.fill(); }
    }
    if (fog) c.drawImage(fog.canvas, 0, 0, W, H);
    const sees = f.sees.navy;
    for (const p of f.points) {
      const s = 5 * dpr, x = u(p.x), y = v(p.z);
      c.fillStyle = p.owner === "navy" ? "#63e6ff" : p.owner === "rim" ? "#ff9a4d" : "#8a96a3";
      c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s, y); c.lineTo(x, y + s); c.lineTo(x - s, y); c.closePath(); c.fill();
    }
    for (const m of f.mines) if (sees.has(m.id)) dot(m.x, m.z, 1.2, "#ff7a2a");
    dot(w.lane.x, w.lane.z, 4, "rgba(140,120,230,0.6)");
    for (const g of w.wings) {
      if (g.state !== "out" || !g.craft.some((cr) => !cr.dead)) continue;
      if (g.side === "rim" && !sees.has(g.id)) continue;
      dot(g.x, g.z, 1.6, g.side === "navy" ? (sel.has(g.id) ? "#ffffff" : "#9fd8ff") : "#ffb070");
    }
    for (const s of w.ships) {
      if (s.dead || (s.side === "rim" && !sees.has(s.id))) continue;
      const r = s.kind === "destroyer" || s.kind === "dreadnought" || s.kind === "bulwark" || s.kind === "station" ? 3.4 : 2.4;
      dot(s.x, s.z, r, s.side === "navy" ? (sel.has(s.id) ? "#ffffff" : "#63e6ff") : s.id === target ? "#ff5a4a" : "#ff9a4d");
    }
    // Last-known positions of Compact hulls your sensors lost: hollow rings.
    for (const [id, g] of ghosts ?? []) if (!sees.has(id)) { c.strokeStyle = "rgba(255,154,77,0.55)"; c.lineWidth = dpr; c.beginPath(); c.arc(u(g.x), v(g.z), 3 * dpr, 0, Math.PI * 2); c.stroke(); }
    if (view) {
      c.strokeStyle = "rgba(240,246,255,0.8)"; c.lineWidth = dpr;
      c.beginPath(); view.forEach((p, i) => (i ? c.lineTo(u(p.x), v(p.z)) : c.moveTo(u(p.x), v(p.z)))); c.closePath(); c.stroke();
    }
  }
}
