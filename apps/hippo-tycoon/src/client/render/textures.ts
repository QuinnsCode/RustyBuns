// Every surface is drawn here at startup: basalt, planks, thatch, bark, fronds,
// moss. Canvas 2D, a seeded RNG, no files.
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

/** The volcanic basin floor: wet black basalt with ochre petroglyph rings, oil-slicked toward the vent. */
export function basalt(): THREE.CanvasTexture {
  const [c, g] = canvas(1024), r = rng(3);
  const base = g.createRadialGradient(512, 512, 30, 512, 512, 520);
  base.addColorStop(0, "#2a2724"); base.addColorStop(0.6, "#22201f"); base.addColorStop(1, "#171918");
  g.fillStyle = base; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 2600; i++) {                                  // grit and vesicles
    g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${r() * 0.1})`;
    g.fillRect(r() * 1024, r() * 1024, 1 + r() * 3, 1 + r() * 3);
  }
  for (let i = 0; i < 40; i++) {                                    // faint rainbow oil film
    const x = 512 + (r() - 0.5) * 700, y = 512 + (r() - 0.5) * 700;
    const grd = g.createRadialGradient(x, y, 4, x, y, 60 + r() * 90);
    grd.addColorStop(0, `hsla(${180 + r() * 140},60%,50%,0.07)`); grd.addColorStop(1, "hsla(0,0%,0%,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 1024);
  }
  g.strokeStyle = "rgba(214,160,60,0.55)"; g.lineWidth = 4;           // carved, ochre-filled rings
  for (const rad of [150, 290, 430]) { g.beginPath(); g.arc(512, 512, rad, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = "rgba(214,160,60,0.5)";                               // a ring of chevrons, like old tapa cloth
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2, rad = 362;
    g.save(); g.translate(512 + Math.cos(a) * rad, 512 + Math.sin(a) * rad); g.rotate(a + Math.PI / 2);
    g.beginPath(); g.moveTo(-10, 10); g.lineTo(0, -12); g.lineTo(10, 10); g.closePath(); g.fill(); g.restore();
  }
  for (let i = 0; i < 12; i++) {                                      // and sun-dots on the inner one
    const a = (i / 12) * Math.PI * 2;
    g.beginPath(); g.arc(512 + Math.cos(a) * 220, 512 + Math.sin(a) * 220, 6, 0, Math.PI * 2); g.fill();
  }
  const t = finish(c, 1, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function planks(rx = 2, ry = 1, hue = 28): THREE.CanvasTexture {
  const [c, g] = canvas(256), r = rng(9);
  const n = 8, w = 256 / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = `hsl(${hue + r() * 6} ${34 + r() * 10}% ${22 + r() * 10}%)`; g.fillRect(i * w, 0, w, 256);
    for (let k = 0; k < 18; k++) { g.strokeStyle = `rgba(0,0,0,${0.06 + r() * 0.12})`; g.lineWidth = 1; g.beginPath(); const x = i * w + r() * w; g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 6, 256); g.stroke(); }
    g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(i * w, 0, 2, 256);
  }
  return finish(c, rx, ry);
}

export function thatch(): THREE.CanvasTexture {
  const [c, g] = canvas(256), r = rng(5);
  g.fillStyle = "#8a7238"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const x = r() * 256, y = r() * 256, l = 30 + r() * 50, s = (r() - 0.5) * 0.18;
    g.strokeStyle = `hsl(${40 + r() * 12} ${30 + r() * 25}% ${28 + r() * 26}%)`; g.lineWidth = 1 + r() * 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * l, y + l); g.stroke();
  }
  return finish(c, 3, 2);
}

/** Palm bark: pale grey-brown with the ring scars palms have. */
export function bark(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256), r = rng(13);
  g.fillStyle = "#7a6c58"; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? "30,24,16" : "170,155,130"},${r() * 0.25})`; g.lineWidth = 1; g.beginPath(); const x = r() * 128; g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 8, 256); g.stroke(); }
  for (let y = 6; y < 256; y += 18) { g.fillStyle = "rgba(40,30,18,0.5)"; g.fillRect(0, y, 128, 3); g.fillStyle = "rgba(190,175,145,0.25)"; g.fillRect(0, y + 3, 128, 2); }
  return finish(c, 1, 3);
}

/** A palm frond on a transparent card: a midrib and drooping leaflets. */
export function frond(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 512), r = rng(21);
  g.clearRect(0, 0, 256, 512);
  g.strokeStyle = "#5c7a2a"; g.lineWidth = 5; g.beginPath(); g.moveTo(128, 512); g.lineTo(128, 6); g.stroke();
  for (let y = 500; y > 14; y -= 8) {
    const t = 1 - y / 512, len = 112 * Math.sin(Math.min(1, t * 3.6) * Math.PI * 0.5) * (1 - t * 0.55);
    for (const s of [-1, 1]) {
      const g2 = g.createLinearGradient(128, y, 128 + s * len, y + len * 0.55);
      g2.addColorStop(0, "#35591d"); g2.addColorStop(1, `hsl(${92 + r() * 22} 55% ${26 + r() * 14}%)`);
      g.strokeStyle = g2; g.lineWidth = 3.2;
      g.beginPath(); g.moveTo(128, y); g.quadraticCurveTo(128 + s * len * 0.6, y - 6, 128 + s * len, y + len * 0.5); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function moss(rx = 40, ry = 40): THREE.CanvasTexture {
  const [c, g] = canvas(512), r = rng(17);
  g.fillStyle = "#1c2a14"; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 700; i++) {
    const x = r() * 512, y = r() * 512, rad = 10 + r() * 38;
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      const hue = r() < 0.25 ? 28 : 88 + r() * 30;
      const grd = g.createRadialGradient(x + dx, y + dy, 1, x + dx, y + dy, rad);
      grd.addColorStop(0, `hsla(${hue},${30 + r() * 25}%,${12 + r() * 12}%,0.55)`); grd.addColorStop(1, "hsla(100,40%,20%,0)");
      g.fillStyle = grd; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    }
  }
  return finish(c, rx, ry);
}

/** Soft smoke blob, white with alpha, tinted per use. */
export function puff(): THREE.CanvasTexture {
  const [c, g] = canvas(64);
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, "rgba(255,255,255,0.9)"); grd.addColorStop(0.5, "rgba(255,255,255,0.35)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return finish(c, 1, 1);
}
