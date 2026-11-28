// The look made in code: three.js shapes and drawn textures, no files. Every hull is built from its drawing sheet
// (`sheets.ts`, built in `ships.ts`) and every craft from its own (`craft-sheets.ts`, built in `craft.ts`). The navy
// builds sharp wedges in pale grey; the Compact flies what it could weld together, long industrial hulls in rust and
// ochre with their drives showing.
import * as THREE from "three";
import type { Side } from "../names.ts";

export const ENGINE: Record<Side, number> = { navy: 0x9fd8ff, rim: 0xffb36b };

/** A planet's skin: banded continents and cloud, drawn into a canvas from a seed. */
export function planetTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const x = c.getContext("2d")!;
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  x.fillStyle = "#1d3b52"; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = ["#3b5a3a", "#5d6b3f", "#7a6a48", "#2f4a33"][Math.floor(r() * 4)];
    x.beginPath(); x.ellipse(r() * 512, 40 + r() * 176, 10 + r() * 50, 6 + r() * 24, r() * 3, 0, Math.PI * 2); x.fill();
  }
  x.globalAlpha = 0.35; x.fillStyle = "#e8eef2";
  for (let i = 0; i < 70; i++) { x.beginPath(); x.ellipse(r() * 512, r() * 256, 20 + r() * 60, 2 + r() * 6, 0, 0, Math.PI * 2); x.fill(); }
  x.globalAlpha = 0.9; x.fillStyle = "#f4f7fa"; x.fillRect(0, 0, 512, 10); x.fillRect(0, 246, 512, 10);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft round dot for glows and explosions. */
export function dotTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d")!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.65)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
