// The rainy city, one of the "Try one now" worlds (worlds.ts): a small isometric rain city on a 2D canvas, in two
// files. It was the starter before the night desert (starter.ts). Plain strings: these are the files.

const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My world</title>
<style>
  html, body { margin: 0; height: 100%; background: #05060f; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; image-rendering: pixelated; }
  h1 { position: fixed; left: 24px; bottom: 20px; margin: 0; font: 700 28px ui-monospace, Menlo, monospace; color: #fff; text-shadow: 0 0 8px #21e6ff, 0 0 24px #21e6ff; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<h1>My world</h1>
<script src="world.js"></script>
</body>
</html>
`;

const world = `// An isometric night city, drawn small on a pixel grid and scaled up sharp, with rain over it.
// Change anything: the towers, the colors, the sign. Or replace it all with a three.js scene.
const PX = 3, NEON = ["#ff3d8b", "#21e6ff", "#ffb547", "#a67bff", "#3dffa8"];
const cv = document.getElementById("c"), g = cv.getContext("2d");
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let city, W, H, drops;

function paint(w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d");
  seed = 11;
  const tw = 18, th = 9, n = Math.ceil((w + h * 2) / th) + 4, ox = Math.round(w * 0.6), oy = Math.round(-h * 0.5);
  x.fillStyle = "#070618"; x.fillRect(0, 0, w, h);
  const poly = (p, fill) => { x.beginPath(); x.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) x.lineTo(p[k], p[k + 1]); x.closePath(); x.fillStyle = fill; x.fill(); };
  for (let s = 0; s < 2 * n; s++) for (let i = 0; i <= s; i++) {
    const j = s - i; if (i >= n || j >= n) continue;
    const sx = ox + (i - j) * tw / 2, sy = oy + (i + j) * th / 2;
    if (sx < -tw || sx > w + tw || sy < -th * 2 || sy > h + th) continue;
    if (i % 5 === 0 || j % 5 === 0) { poly([sx, sy, sx + tw / 2, sy + th / 2, sx, sy + th, sx - tw / 2, sy + th / 2], "#0c0b22"); continue; }
    const tall = Math.round(6 + rnd() * 30 + rnd() * 50), top = sy - tall, hue = NEON[Math.floor(rnd() * NEON.length)];
    poly([sx - tw / 2, sy + th / 2 - tall, sx, sy + th - tall, sx, sy + th, sx - tw / 2, sy + th / 2], "#1b1840");
    poly([sx, sy + th - tall, sx + tw / 2, sy + th / 2 - tall, sx + tw / 2, sy + th / 2, sx, sy + th], "#120f2e");
    poly([sx, top, sx + tw / 2, top + th / 2, sx, top + th, sx - tw / 2, top + th / 2], "#2a2558");
    for (let ry = 4; ry < tall - 2; ry += 4) for (let dx = 2; dx < tw / 2 - 1; dx += 3) {
      if (rnd() < 0.3) { x.fillStyle = rnd() < 0.2 ? hue : "#ffd38a"; x.fillRect(Math.round(sx - tw / 2 + dx), Math.round(sy + th / 2 - tall + dx / 2 + ry), 1, 2); }
    }
    if (rnd() < 0.4) { x.strokeStyle = hue; x.beginPath(); x.moveTo(sx - tw / 2, top + th / 2); x.lineTo(sx, top + th); x.lineTo(sx + tw / 2, top + th / 2); x.stroke(); }
  }
  return c;
}

function build() {
  W = innerWidth; H = innerHeight;
  if (!W || !H) return;
  cv.width = W; cv.height = H; g.imageSmoothingEnabled = false;
  city = paint(Math.ceil(W / PX), Math.ceil(H / PX));
  drops = Array.from({ length: Math.round(W * H / 2400) }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 7 + Math.random() * 8, l: 8 + Math.random() * 14 }));
}

function draw() {
  // The frame can be 0 wide on its first tick: paint once it has a size, and again when the size changes.
  if (innerWidth !== W || innerHeight !== H) build();
  if (!W || !H) return requestAnimationFrame(draw);
  g.drawImage(city, 0, 0, city.width * PX, city.height * PX);
  g.strokeStyle = "rgba(170,190,255,.3)"; g.beginPath();
  for (const d of drops) { g.moveTo(d.x, d.y); g.lineTo(d.x - 1.5, d.y + d.l); d.y += d.v; if (d.y > H) { d.y = -d.l; d.x = Math.random() * W; } }
  g.stroke();
  requestAnimationFrame(draw);
}

draw();
`;

export const RAIN_CITY_FILES: Readonly<Record<string, string>> = { "index.html": index, "world.js": world };
