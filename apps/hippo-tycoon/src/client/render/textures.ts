// Every surface is drawn here at startup: brick, cobbles, riveted iron. Canvas
// 2D, a seeded RNG, no files. The same canvas serves as colour and as bump.
import * as THREE from "three";

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, rx: number, ry: number, color = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function brick(rx = 3, ry = 1): THREE.CanvasTexture {
  const [c, g] = canvas(512), r = rng(7);
  g.fillStyle = "#2a1c16"; g.fillRect(0, 0, 512, 512);          // mortar
  const rows = 16, bw = 64, bh = 512 / rows;
  for (let y = 0; y < rows; y++) for (let x = -1; x < 9; x++) {
    const ox = (y % 2) * (bw / 2), shade = 0.75 + r() * 0.5;
    const R = Math.round(122 * shade), G = Math.round(56 * shade), B = Math.round(40 * shade);
    g.fillStyle = `rgb(${R},${G},${B})`;
    g.fillRect(x * bw + ox + 2, y * bh + 2, bw - 4, bh - 4);
    for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(0,0,0,${r() * 0.18})`; g.fillRect(x * bw + ox + 2 + r() * (bw - 6), y * bh + 2 + r() * (bh - 6), 2 + r() * 4, 2); }
  }
  return finish(c, rx, ry);
}

export function cobble(rx = 8, ry = 8): THREE.CanvasTexture {
  const [c, g] = canvas(512), r = rng(11);
  g.fillStyle = "#14100d"; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 520; i++) {
    const x = r() * 512, y = r() * 512, rad = 14 + r() * 10, l = 20 + r() * 14;
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      const grd = g.createRadialGradient(x + dx - 3, y + dy - 3, 1, x + dx, y + dy, rad);
      grd.addColorStop(0, `hsl(24 12% ${l + 10}%)`); grd.addColorStop(1, `hsl(24 10% ${l - 14}%)`);
      g.fillStyle = grd; g.beginPath(); g.ellipse(x + dx, y + dy, rad, rad * (0.75 + r() * 0.25), r() * 3, 0, Math.PI * 2); g.fill();
    }
  }
  return finish(c, rx, ry);
}

/** Cast-iron plate: scratches, wear and a polished oily sheen toward the middle. */
export function iron(): THREE.CanvasTexture {
  const [c, g] = canvas(1024), r = rng(3);
  const base = g.createRadialGradient(512, 512, 40, 512, 512, 520);
  base.addColorStop(0, "#3d3a38"); base.addColorStop(0.7, "#2c2a29"); base.addColorStop(1, "#1d1c1b");
  g.fillStyle = base; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 900; i++) {                                  // scratches
    const a = r() * Math.PI * 2, d = r() * 480, len = 8 + r() * 40;
    g.strokeStyle = `rgba(255,255,255,${r() * 0.07})`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(512 + Math.cos(a) * d, 512 + Math.sin(a) * d); g.lineTo(512 + Math.cos(a + 1.4) * d + len, 512 + Math.sin(a + 1.4) * d); g.stroke();
  }
  g.strokeStyle = "rgba(201,151,28,0.55)"; g.lineWidth = 3;           // brass inlay rings
  for (const rad of [140, 280, 420]) { g.beginPath(); g.arc(512, 512, rad, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = "rgba(201,151,28,0.28)"; g.lineWidth = 2;           // and spokes
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.beginPath(); g.moveTo(512 + Math.cos(a) * 60, 512 + Math.sin(a) * 60); g.lineTo(512 + Math.cos(a) * 500, 512 + Math.sin(a) * 500); g.stroke(); }
  for (let i = 0; i < 24; i++) {                                    // rivets round the middle plate
    const a = (i / 24) * Math.PI * 2;
    g.fillStyle = "#5a5551"; g.beginPath(); g.arc(512 + Math.cos(a) * 140, 512 + Math.sin(a) * 140, 5, 0, Math.PI * 2); g.fill();
  }
  const t = finish(c, 1, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Soft smoke blob, white with alpha, tinted per use. */
export function puff(): THREE.CanvasTexture {
  const [c, g] = canvas(64);
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, "rgba(255,255,255,0.9)"); grd.addColorStop(0.5, "rgba(255,255,255,0.35)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return finish(c, 1, 1);
}
