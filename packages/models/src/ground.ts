// Ground you can paint once and tile: a desert floor that people have walked on, shared by Qollab Studio's Desert
// Gathering and Sound Guy Simulator's desert. Packed silt in soft patches, wind ripples only in short broken runs (a
// few centimetres apart and barely raised), gravel scattered through it, each stone lit on top and shadowed under,
// and the scuffs of feet. Browser only (a canvas).
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";

const css = (c: THREE.Color, k = 1) => `rgb(${Math.min(255, c.r * 255 * k) | 0},${Math.min(255, c.g * 255 * k) | 0},${Math.min(255, c.b * 255 * k) | 0})`;

/** Paint the desert floor onto `g`, `n` pixels square (a tile about 3 m across), in `base`'s colour. */
export function paintDesertFloor(g: CanvasRenderingContext2D, n: number, rnd: () => number, base: THREE.Color) {
  g.fillStyle = css(base); g.fillRect(0, 0, n, n);
  // soft patches, lighter and darker, wrapping round the tile's edges
  for (let i = 0; i < 40; i++) {
    const x = rnd() * n, y = rnd() * n, r = n * (0.05 + rnd() * 0.2), dark = rnd() < 0.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, dark ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.07)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) { g.save(); g.translate(dx, dy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }
  // wind ripples: ~7 cm apart (the tile is 3 m), in patches the feet haven't reached
  const wave = n / 42;
  for (let p = 0; p < 9; p++) {
    const cx = rnd() * n, cy = rnd() * n, R = n * (0.06 + rnd() * 0.1), bend = rnd() * 6;
    for (let k = -R; k < R; k += wave) {
      const run = Math.sqrt(Math.max(0, R * R - k * k));
      for (const [dy, shade, a] of [[0, 0.82, 0.22], [wave * 0.3, 1.1, 0.16]] as const) {
        g.strokeStyle = css(base, shade); g.globalAlpha = a * (0.5 + rnd() * 0.5); g.lineWidth = wave * 0.28;
        g.beginPath();
        for (let x = -run; x <= run; x += 6) { const y = cy + k + dy + Math.sin((x / n) * Math.PI * 2 * bend) * wave * 0.5; if (x > -run) g.lineTo(cx + x, y); else g.moveTo(cx + x, y); }
        g.stroke();
      }
    }
  }
  // scuffs: dragged heels, darker where the crust broke
  for (let i = 0; i < 70; i++) {
    const x = rnd() * n, y = rnd() * n, a = rnd() * Math.PI, l = n * (0.008 + rnd() * 0.02);
    g.globalAlpha = 0.08 + rnd() * 0.1; g.strokeStyle = css(base, 0.75); g.lineWidth = n * 0.006; g.lineCap = "round";
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.lineCap = "butt";
  // gravel: grit everywhere, a few pebbles, each with its shadow on the far side from the moon
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * n, y = rnd() * n, big = rnd() < 0.06, r = big ? 1.6 + rnd() * 3 : 0.5 + rnd() * 1.1, tone = 0.55 + rnd() * 0.75;
    g.globalAlpha = big ? 0.55 : 0.4;
    g.fillStyle = "rgba(0,0,0,0.6)"; g.beginPath(); g.ellipse(x + r * 0.35, y + r * 0.45, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = css(base, tone); g.beginPath(); g.ellipse(x, y, r, r * 0.78, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  // and the finest grain over all of it
  for (let i = 0; i < 60000; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.12 * rnd()})` : `rgba(255,255,255,${0.12 * rnd()})`;
    g.fillRect(rnd() * n, rnd() * n, 1.1 * (0.5 + rnd()), 1.1 * (0.5 + rnd()));
  }
}

/** The desert floor as a tiling texture (and a matching bump), one tile `metres` across: set the geometry's UVs in
 *  metres, or repeat it over a plane yourself. */
export function desertFloor({ color = "#a88a66", seed = 7, metres = 3, n = 1024 }: { color?: string; seed?: number; metres?: number; n?: number } = {}): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const c = document.createElement("canvas");
  c.width = c.height = n;
  paintDesertFloor(c.getContext("2d")!, n, mulberry32(seed), new THREE.Color(color));
  const map = new THREE.CanvasTexture(c), bump = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / metres, 1 / metres); t.anisotropy = 8; }
  return { map, bump };
}
