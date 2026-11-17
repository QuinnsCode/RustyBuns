// A person's marks (hands.ts) as a sprite over their head: a row of Lucide icons (crown leads, hand up, headphones
// listen only, speaker off muted for everyone) on the name tag's dark pill. None when they have no marks.
import * as THREE from "three";
import type { Marks } from "./hands.ts";

const PATHS = {
  crown: ["M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.29l4.27-3.66a.5.5 0 0 1 .82.5l-2.83 10.25a1 1 0 0 1-.96.75H5.8a1 1 0 0 1-.96-.75L2.02 6a.5.5 0 0 1 .82-.5l4.27 3.66a1 1 0 0 0 1.52-.29z", "M5 21h14"],
  hand: ["M18 11V6a2 2 0 0 0-4 0", "M14 10V4a2 2 0 0 0-4 0v2", "M10 10.5V6a2 2 0 0 0-4 0v8", "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"],
  headphones: ["M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"],
  muted: ["M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z", "M22 9l-6 6", "M16 9l6 6"],
} as const;

/** The icons for these marks, left to right, and the colour each is drawn in. */
function icons(m: Marks): [keyof typeof PATHS, string][] {
  const out: [keyof typeof PATHS, string][] = [];
  if (m.lead) out.push(["crown", "#f2c14e"]);
  if (m.hand) out.push(["hand", "#ff6b4a"]);
  if (m.listen) out.push(["headphones", "#a9adb4"]);
  if (m.muted) out.push(["muted", "#ff6b4a"]);
  return out;
}

export function badge(m: Marks): THREE.Sprite | null {
  const row = icons(m);
  if (!row.length) return null;
  const cell = 48, c = document.createElement("canvas");
  c.width = row.length * cell + 16; c.height = 56;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "rgba(21,23,27,0.75)"; g.beginPath(); g.roundRect(0, 0, c.width, c.height, 14); g.fill();
    g.lineWidth = 2; g.lineCap = "round"; g.lineJoin = "round";
    row.forEach(([name, color], i) => {
      g.save(); g.translate(8 + i * cell + 6, 10); g.scale(1.5, 1.5); g.strokeStyle = color;
      for (const d of PATHS[name]) g.stroke(new Path2D(d));
      g.restore();
    });
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(0.15 * (c.width / c.height), 0.15, 1);
  s.renderOrder = 2;
  return s;
}

export function dropBadge(s: THREE.Sprite) { s.removeFromParent(); s.material.map?.dispose(); s.material.dispose(); }
