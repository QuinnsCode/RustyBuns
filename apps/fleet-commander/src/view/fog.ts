// The fog of war, drawn into two canvases the size of the theater: `explored` remembers everywhere your sensors
// have been (black until then), and `canvas` is what the table shows now: dark where you have never looked, dimmed
// where you looked once, clear inside your sensors, with the rifts and the star's heat shear tinted over the top.
// The 3D table lays `canvas` over the battle plane; the minimap draws both.
import type { Field } from "../sim/world.ts";

export interface Eye { x: number; z: number; r: number }

export class Fog {
  readonly canvas = document.createElement("canvas");
  readonly explored = document.createElement("canvas");
  readonly W: number;
  readonly H: number;
  private ex: CanvasRenderingContext2D;
  private cx: CanvasRenderingContext2D;

  constructor(readonly wide: number, readonly deep: number, px = 640) {
    this.W = px; this.H = Math.round((px * deep) / wide);
    for (const c of [this.canvas, this.explored]) { c.width = this.W; c.height = this.H; }
    this.ex = this.explored.getContext("2d")!;
    this.cx = this.canvas.getContext("2d")!;
    this.reset();
  }

  reset() {
    this.ex.globalCompositeOperation = "source-over";
    this.ex.fillStyle = "#000"; this.ex.fillRect(0, 0, this.W, this.H);
  }

  /** Canvas pixels for a sim point, and for a sim length. */
  u(x: number) { return ((x + this.wide) / (2 * this.wide)) * this.W; }
  v(z: number) { return ((z + this.deep) / (2 * this.deep)) * this.H; }
  k(r: number) { return (r / (2 * this.wide)) * this.W; }

  private holes(c: CanvasRenderingContext2D, eyes: Eye[]) {
    c.globalCompositeOperation = "destination-out";
    for (const e of eyes) {
      const x = this.u(e.x), y = this.v(e.z), r = this.k(e.r);
      const g = c.createRadialGradient(x, y, r * 0.7, x, y, r);
      g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    c.globalCompositeOperation = "source-over";
  }

  update(eyes: Eye[], f: Field, t: number) {
    this.holes(this.ex, eyes);
    const c = this.cx;
    c.clearRect(0, 0, this.W, this.H);
    c.fillStyle = "rgba(2,8,14,0.5)"; c.fillRect(0, 0, this.W, this.H);
    this.holes(c, eyes);
    c.globalAlpha = 0.55; c.drawImage(this.explored, 0, 0); c.globalAlpha = 1;
    // The veils: a rift is a slow violet whorl, the shear a hot shimmer in bands round the star.
    for (const v of f.veils) {
      const x = this.u(v.x), y = this.v(v.z), r = this.k(v.r);
      if (v.kind === "rift") {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(40,10,70,0.55)"); g.addColorStop(0.6, "rgba(110,60,200,0.22)"); g.addColorStop(1, "rgba(110,60,200,0)");
        c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "rgba(170,120,255,0.25)"; c.lineWidth = 1;
        for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(x, y, r * (0.35 + i * 0.22), t * 0.2 + i, t * 0.2 + i + 2.4); c.stroke(); }
      } else {
        for (let i = 0; i < 7; i++) {
          const rr = r * (0.45 + i * 0.09), a = 0.1 + 0.06 * Math.sin(t * 0.8 + i * 1.7);
          c.strokeStyle = `rgba(255,${120 + i * 12},50,${a})`; c.lineWidth = r * 0.05;
          c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.stroke();
        }
      }
    }
  }
}
