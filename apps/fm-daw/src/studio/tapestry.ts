// The tapestry over the deck table at Desert Gathering: block-printed cotton, indigo ground, a big mandala in the
// middle with a smaller one either side, bands of diamonds along the edges. Drawn onto a canvas from a seed, so
// everyone in the room sees the same cloth.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";

const DYES = ["#d9a441", "#b5502f", "#2f8f8a", "#e8dcc0", "#7a3b6b"] as const;

/** What a mandala is made of, from the seed: its rings, each a count of petals, how long they are and their dye. */
export function mandala(seed: number, rings = 5): { petals: number; reach: number; dye: string }[] {
  const r = mulberry32(seed);
  return Array.from({ length: rings }, (_, i) => ({ petals: 8 + 4 * Math.floor(r() * 4), reach: (rings - i) / rings, dye: DYES[Math.floor(r() * DYES.length)]! }));
}

/** The cloth as a texture, `w` by `h` metres. */
export function tapestry(w: number, h: number, seed: number): THREE.CanvasTexture {
  const px = 320, c = document.createElement("canvas");
  c.width = Math.round(w * px); c.height = Math.round(h * px);
  const g = c.getContext("2d")!, H = c.height, W = c.width;
  g.fillStyle = "#1c1a3c"; g.fillRect(0, 0, W, H);
  // the edges: a plain band, then a row of diamonds
  for (const y of [0, H - H * 0.07]) { g.fillStyle = DYES[1]; g.fillRect(0, y, W, H * 0.07); }
  const d = H * 0.085;
  for (const y of [H * 0.07 + d * 0.9, H * 0.93 - d * 0.9]) for (let x = d; x < W; x += d * 2) {
    g.fillStyle = DYES[Math.round(x / d / 2) % 2 ? 0 : 2];
    g.beginPath(); g.moveTo(x, y - d * 0.6); g.lineTo(x + d * 0.8, y); g.lineTo(x, y + d * 0.6); g.lineTo(x - d * 0.8, y); g.fill();
  }
  const draw = (cx: number, size: number, sd: number) => {
    for (const ring of mandala(sd)) {
      const R = size * ring.reach;
      g.fillStyle = ring.dye;
      for (let k = 0; k < ring.petals; k++) {
        const a = (k / ring.petals) * Math.PI * 2;
        g.save(); g.translate(cx, H / 2); g.rotate(a);
        g.beginPath(); g.moveTo(R * 0.45, 0); g.quadraticCurveTo(R * 0.75, R * 0.16, R, 0); g.quadraticCurveTo(R * 0.75, -R * 0.16, R * 0.45, 0); g.fill();
        g.restore();
      }
      g.strokeStyle = ring.dye; g.lineWidth = Math.max(1, size * 0.012);
      g.beginPath(); g.arc(cx, H / 2, R * 0.45, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = DYES[3]; g.beginPath(); g.arc(cx, H / 2, size * 0.07, 0, Math.PI * 2); g.fill();
  };
  const big = H * 0.34;
  draw(W / 2, big, seed);
  for (const side of [-1, 1]) { draw(W / 2 + side * W * 0.22, big * 0.7, seed + 1); draw(W / 2 + side * W * 0.4, big * 0.8, seed + 2); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
