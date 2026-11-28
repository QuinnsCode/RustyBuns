// The night city behind the landing: isometric towers on a pixel grid (lit windows, neon roof edges, streets every
// fifth row), painted once small and scaled up sharp, with rain over it every frame. Plain canvas, no Effect: it only
// draws while the landing is on screen and sits still under reduced motion.

const PX = 3;
const NEON = ["#ff3d8b", "#21e6ff", "#ffb547", "#a67bff", "#3dffa8"];

/** A seeded stream, so everyone's city is the same city. */
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** The city at `w` x `h` pixels (one pixel is PX screen pixels). */
export function paintCity(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  const rnd = seeded(11);
  const tw = 18, th = 9, n = Math.ceil((w + h * 2) / th) + 4;
  const ox = Math.round(w * 0.62), oy = Math.round(-h * 0.55);
  x.fillStyle = "#070618";
  x.fillRect(0, 0, w, h);
  const poly = (pts: number[], fill: string) => {
    x.beginPath();
    x.moveTo(pts[0]!, pts[1]!);
    for (let k = 2; k < pts.length; k += 2) x.lineTo(pts[k]!, pts[k + 1]!);
    x.closePath();
    x.fillStyle = fill;
    x.fill();
  };
  const dot = (px: number, py: number, color: string, tall = 1) => { x.fillStyle = color; x.fillRect(Math.round(px), Math.round(py), 1, tall); };
  // Back to front: every tile on a diagonal before the next diagonal.
  for (let s = 0; s < 2 * n; s++) for (let i = 0; i <= s; i++) {
    const j = s - i;
    if (i >= n || j >= n) continue;
    const sx = ox + (i - j) * tw / 2, sy = oy + (i + j) * th / 2;
    if (sx < -tw || sx > w + tw || sy < -th * 2 || sy > h + th) continue;
    if (i % 5 === 0 || j % 5 === 0) {
      poly([sx, sy, sx + tw / 2, sy + th / 2, sx, sy + th, sx - tw / 2, sy + th / 2], "#0c0b22");
      if (rnd() < 0.05) dot(sx, sy + th / 2, NEON[Math.floor(rnd() * NEON.length)]!);
      continue;
    }
    const near = 1 - Math.min(1, Math.hypot(sx - w * 0.75, sy - h * 0.45) / (w * 0.9));
    const tall = Math.round(6 + rnd() * 30 + near * near * 70 * rnd());
    const top = sy - tall, hue = NEON[Math.floor(rnd() * NEON.length)]!;
    poly([sx - tw / 2, sy + th / 2 - tall, sx, sy + th - tall, sx, sy + th, sx - tw / 2, sy + th / 2], "#1b1840");
    poly([sx, sy + th - tall, sx + tw / 2, sy + th / 2 - tall, sx + tw / 2, sy + th / 2, sx, sy + th], "#120f2e");
    poly([sx, top, sx + tw / 2, top + th / 2, sx, top + th, sx - tw / 2, top + th / 2], "#2a2558");
    for (let ry = 4; ry < tall - 2; ry += 4) for (let dx = 2; dx < tw / 2 - 1; dx += 3) {
      if (rnd() < 0.3) dot(sx - tw / 2 + dx, sy + th / 2 - tall + dx / 2 + ry, rnd() < 0.18 ? hue : "#ffd38a", 2);
      if (rnd() < 0.22) dot(sx + dx, sy + th - tall - dx / 2 + ry, rnd() < 0.2 ? hue : "#8fd8ff", 2);
    }
    if (rnd() < 0.4) {
      x.strokeStyle = hue;
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(sx - tw / 2, top + th / 2);
      x.lineTo(sx, top + th);
      x.lineTo(sx + tw / 2, top + th / 2);
      x.stroke();
    }
    if (tall > 50 && rnd() < 0.5) { dot(sx, top + th / 2 - 8, "#3a3570", 8); dot(sx, top + th / 2 - 9, "#ff3d8b"); }
  }
  const sky = x.createLinearGradient(0, 0, 0, h * 0.5);
  sky.addColorStop(0, "rgba(40,18,70,.55)");
  sky.addColorStop(1, "rgba(40,18,70,0)");
  x.fillStyle = sky;
  x.fillRect(0, 0, w, h);
  return c;
}

/** Draw the city and its rain on `cv` for as long as `showing()` says the landing is up. */
export function startCity(cv: HTMLCanvasElement, showing: () => boolean) {
  const g = cv.getContext("2d");
  if (!g) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let city: HTMLCanvasElement | null = null, w = 0, h = 0;
  let drops: { x: number; y: number; v: number; l: number }[] = [];
  const build = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = innerWidth;
    h = innerHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    city = paintCity(Math.ceil(w / PX), Math.ceil(h / PX));
    drops = Array.from({ length: Math.round(w * h / 2400) }, () => ({ x: Math.random() * w, y: Math.random() * h, v: 7 + Math.random() * 8, l: 8 + Math.random() * 14 }));
  };
  const draw = () => {
    if (city && showing()) {
      g.drawImage(city, 0, 0, city.width * PX, city.height * PX);
      g.strokeStyle = "rgba(170,190,255,.3)";
      g.lineWidth = 1;
      g.beginPath();
      for (const d of drops) {
        g.moveTo(d.x, d.y);
        g.lineTo(d.x - 1.5, d.y + d.l);
        if (!still) { d.y += d.v; d.x -= 0.25; if (d.y > h) { d.y = -d.l; d.x = Math.random() * w; } }
      }
      g.stroke();
    }
    if (!still) requestAnimationFrame(draw);
  };
  build();
  draw();
  addEventListener("resize", () => { build(); if (still) draw(); });
}
