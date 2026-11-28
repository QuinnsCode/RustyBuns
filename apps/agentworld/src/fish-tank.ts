// The "Fish tank" ready-made world (src/worlds.ts): a pixel-art aquarium on a 2D canvas with no libraries.
// Plain strings: these are the files. world.js stays short and plain, because an AI reads it to change it.

const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fish tank</title>
<style>
  html, body { margin: 0; height: 100%; background: #0b0f1e; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; image-rendering: pixelated; touch-action: none; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script src="world.js"></script>
</body>
</html>
`;

const world = `// Fish tank, in pixel art: one 16-colour palette, every sprite a text grid, drawn small and scaled up in whole pixels.
// To add a creature, add a row to KINDS: a grid of PAL letters facing right ("." is clear; the dark outline is drawn for you).
const PAL = { k: "#0b0f1e", n: "#0f2747", b: "#17507a", c: "#2683a3", t: "#6fd0c8", w: "#f2efd8", y: "#ffcf5a", o: "#f2843f",
  r: "#d8435a", p: "#9a5cc8", g: "#2e8a4a", l: "#97df57", s: "#e3c48c", d: "#a07648", m: "#4f5a72", h: "#98a2b6" };

// n: how many; speed: pixels a second; y: the depth band they like (0 the surface, 1 the sand). Columns 0-1 are the tail.
const KINDS = [
  { name: "clownfish", n: 4, speed: 12, y: [0.35, 0.75], grid: [
    "....oowoo...",
    "o..ooowoowoo",
    "oooooowoowko",
    "oooooowoowoo",
    "o..ooowoowo.",
    "....oowoo..."] },
  { name: "tetra", n: 11, speed: 18, y: [0.05, 0.5], grid: [
    "t..tttt..",
    "tttttttkt",
    "ttrrrrrrr",
    "t..rrrr.."] },
  { name: "angelfish", n: 3, speed: 8, y: [0.2, 0.6], grid: [
    "....y.....",
    "...yy.....",
    "..ywyw....",
    "y.ywywyy..",
    "yyywywyky.",
    "y.ywywyyyy",
    "..ywyw....",
    "...yy.....",
    "....y....."] },
  { name: "royal", n: 4, speed: 15, y: [0.25, 0.7], grid: [
    "....yyppp..",
    "yy.yyyppppp",
    "yyyyyypppkp",
    "yy.yyyppppp",
    "....yyppp.."] },
  { name: "puffer", n: 2, speed: 6, y: [0.55, 0.95], grid: [
    "...yyyy..",
    "..ydydyy.",
    "y.yyyyyky",
    "yyywwwyyy",
    "y.wwwwwy.",
    "...www..."] },
];
const CRAB = [["r..w.w..r", "rr.r.r.rr", ".rrrrrrr.", "..rrrrr..", ".r.r.r.r."],
              ["rr.w.w.rr", ".r.r.r.r.", ".rrrrrrr.", "..rrrrr..", "r.r...r.r"]];
const CASTLE = [
  "h.h.h.............h.h.h",
  "hhhhh.............hhhhm",
  "hmhhm.............hhhmm",
  "hkhhm....h.h.h....hhkhm",
  "hkhhm....hhhhm....hhkhm",
  "hhhhm....hhkhm....hhhhm",
  "hhmhm....hhkhm....hhmhm",
  "hhhhhhhhhhhhhhhhhhhhhhm",
  "hhhhhmhhhhhhhhhhhmhhhhm",
  "hkhhhhhhhhhhhhhhhhhhhkm",
  "hkhhhhhhhkkkkkhhhhhhhkm",
  "hhhhhhhhkkkkkkkhhhhhhhm",
  "hhmhhhhkkkkkkkkkhhhhmhm",
  "hhhhhhhkkkkkkkkkhhhhhhm",
  "hghhhhhkkkkkkkkkhhhhhgm",
  "gghhhhhkkkkkkkkkhhhhggg",
  "ggghhhhkkkkkkkkkhhhgggg"];
const CHEST = ["..dddddddddd..", ".dyddddddddyd.", "dyddddddddddyd", "yyyyyyyyyyyyyy", "dyddddyyddddyd",
  "dydddykkydddyd", "dyddddyyddddyd", "dyddddddddddyd", "yyyyyyyyyyyyyy"];
const CORAL = ["r...r...r", "r.r.r.r.r", "rrr.rrr.r", ".r...r.rr", ".rr..rrr.", "..rr.rr..", "...rrr...", "....r....", "....r...."];
const FAN = ["..p.p.p.p.p..", ".ppppppppppp.", "pppwppwppwppp", "ppppppppppppp", ".ppwppwppwpp.", "..ppppppppp..",
  "....ppppp....", ".....ppp.....", "......p......", "......p......"];
const BRAIN = ["...ooooo...", ".ooyoyoyoo.", "ooyoooooyoo", "oyooyoyooyo", "ooyoooooyoo", "oooyoyoyooo"];
const ROCK = [".....hhhh......", "...hhhhhhhm....", ".hhhhhhhmmmmm..", "hhhhhhmmmmmmmm.", "hhhmmmmmmmmmmmm", "hmmmmmmmmmmmmmm"];
const PEBBLE = [".hhh.", "hhhmm", "hmmmm"];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], bay = (x, y) => BAYER[(y & 3) * 4 + (x & 3)] / 16;
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const px = (c, x, y, ch, n = 1) => { c.fillStyle = PAL[ch]; c.fillRect(x, y, n, 1); };

// A grid becomes a little canvas, with a dark outline around everything that isn't ".".
function sprite(rows) {
  const c = document.createElement("canvas"), x = c.getContext("2d"), W = rows[0].length, H = rows.length;
  c.width = W + 2; c.height = H + 2;
  const on = (i, j) => j >= 0 && j < H && i >= 0 && i < W && rows[j][i] !== ".";
  for (let j = -1; j <= H; j++) for (let i = -1; i <= W; i++) {
    const ch = on(i, j) ? rows[j][i] : on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1) ? "k" : "";
    if (ch) px(x, i + 1, j + 1, ch);
  }
  return c;
}
// The second swim frame: the tail (columns 0-1) pulled in toward the middle row.
const flap = (rows) => rows.map((r, j) => [...r].map((ch, i) => i > 1 ? ch : (rows[j + Math.sign(j - (rows.length - 1) / 2)] || ".")[i] || ".").join(""));
for (const k of KINDS) { k.img = [sprite(k.grid), sprite(flap(k.grid))]; k.ph = rnd() * 6; k.wait = 0; }
const CRAB_IMG = CRAB.map(sprite);

const cv = document.getElementById("c"), g = cv.getContext("2d"), SURF = 8;
const layer = (W, H) => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
let S = 2, w = 0, h = 0, sand = 0, low, water, deco, shafts, weeds = [], vents = [], fish = [], bubbles = [], crab, fright = null, last = 0;

// Everything that doesn't move is drawn once per window size: water, light shafts, sand, pebbles, rocks, coral, castle.
function build() {
  seed = 7; weeds = []; vents = [];
  low = layer(w, h); water = layer(w, h); deco = layer(w, h); shafts = layer(w + 16, h);
  const wc = water.getContext("2d"), dc = deco.getContext("2d"), sc = shafts.getContext("2d");
  const deep = (x, y) => { const v = Math.max(0, (y - SURF) / (sand - SURF)) * 2, f = Math.min(1, Math.max(0, (v % 1 - 0.3) * 2.5));
    return Math.min(2, Math.floor(v) + (bay(x, y) < f ? 1 : 0)); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(wc, x, y, "cbn"[deep(x, y)]);
  for (let x = 0; x < w; x++) {                                   // a far ridge, hazy in the deep water
    const top = sand - Math.round(9 + Math.sin(x * 0.045) * 5 + Math.sin(x * 0.13 + 1) * 2);
    for (let y = top; y < sand; y++) if (bay(x, y) < (y === top ? 0.25 : 0.5)) px(wc, x, y, "b");
  }
  for (let i = -3; i * 56 < w; i++) {                              // light shafts leaning down from the surface
    const x0 = i * 56 + rnd() * 30, wd = 6 + rnd() * 10;
    for (let y = SURF; y < sand; y++) for (let u = 0; u < wd; u++) {
      const x = Math.round(x0 + y * 0.3 + u), a = 0.55 * (1 - (y - SURF) / (sand - SURF)) * (1 - Math.abs(2 * u / wd - 1));
      if (bay(x, y) < a) px(sc, x, y, "tcb"[deep(x, y)]);
    }
  }
  for (let x = 0; x < w; x++) {                                   // sand: a lit top edge, darker as it goes down
    const top = sand + Math.round(Math.sin(x * 0.06) * 1.5 + Math.sin(x * 0.17) * 0.8);
    for (let y = top; y < h; y++) px(wc, x, y, y === top ? (bay(x, y) < 0.5 ? "w" : "s") : bay(x, y) < ((y - top) / (h - top) - 0.35) * 1.3 || (x + 2 * y + Math.round(Math.sin(x * 0.2) * 2)) % 13 === 0 ? "d" : "s");
  }
  for (let i = 0; i < w / 3; i++) {
    const x = Math.floor(rnd() * w), y = Math.floor(sand + 3 + rnd() * (h - sand - 4));
    px(wc, x, y, "mhdow"[Math.floor(rnd() * 5)], 1 + Math.floor(rnd() * 2)); px(wc, x, y + 1, "d");
  }
  const place = (rows, fx, sink = 3) => { const img = sprite(rows), x = Math.round(fx * w - img.width / 2), y = sand + sink - img.height;
    dc.drawImage(img, x, y); return { x, y, img }; };
  for (let x = 4; x < w; x += 14 + rnd() * 22) weeds.push({ x: Math.round(x), len: Math.round(12 + rnd() * Math.min(45, sand * 0.35)), ph: rnd() * 6, front: rnd() < 0.3 });
  place(ROCK, 0.07); place(CORAL, 0.16); place(BRAIN, 0.45, 2); place(PEBBLE, 0.53); place(FAN, 0.6); place(CORAL, 0.88); place(ROCK, 0.95);
  const castle = place(CASTLE, 0.74, 4), chest = place(CHEST, 0.31);
  vents.push({ x: castle.x + 3, y: castle.y + 2, every: 0.5, n: 1, wait: 0 }, { x: castle.x + 21, y: castle.y + 2, every: 0.9, n: 1, wait: 0 },
    { x: chest.x + 8, y: chest.y + 2, every: 7, n: 9, wait: 3 }, { x: Math.round(w * 0.03), y: sand, every: 0.15, n: 1, wait: 0 });
}

function fit() {
  const W = innerWidth, H = innerHeight;
  if (!W || !H) return false;                                     // the frame can be 0 wide on its first tick
  if (W === cv.width && H === cv.height) return true;
  cv.width = W; cv.height = H;
  S = Math.max(2, Math.round(Math.min(W, H) / (W < H ? 130 : 180))); // whole steps, chunkier when tall
  w = Math.ceil(W / S); h = Math.ceil(H / S);
  sand = h - Math.max(18, Math.round(h * 0.13));
  build();
  if (!fish.length) for (const k of KINDS) for (let i = 0; i < k.n; i++)
    fish.push({ k, x: 20 + Math.random() * (w - 40), y: SURF + 10 + Math.random() * (sand - SURF - 20), vx: (Math.random() < 0.5 ? -1 : 1) * k.speed, vy: 0,
      ox: (Math.random() - 0.5) * (k.n > 5 ? 30 : 90), oy: (Math.random() - 0.5) * 16, ph: Math.random() * 6, tick: Math.random() * 2, fear: 0, face: 1 });
  crab = crab || { x: w * 0.4, dir: 1, wait: 0, tick: 0 };
  return true;
}

// Anything can frighten the fish: scare(x, y) and every fish near that spot bolts away. A tap does it; so could a shark.
function scare(x, y) { fright = { x, y, left: 0.6 }; }
cv.addEventListener("pointerdown", (e) => { scare(e.clientX / S, e.clientY / S); blow(e.clientX / S, e.clientY / S, 6); });
const blow = (x, y, n) => { for (let i = 0; i < n && bubbles.length < 300; i++)
  bubbles.push({ x: x + Math.random() * 4 - 2, y: y - Math.random() * 6, big: Math.random() < 0.3, ph: Math.random() * 6, v: 10 + Math.random() * 12 }); };

// Each kind swims toward a spot that moves now and then; each fish keeps near its own kind, out of the others' way, off the glass.
function swim(f, t, dt) {
  const k = f.k, top = SURF + 8, bot = sand - 6;
  let ax = 0, ay = 0, cx = 0, cy = 0, vx = 0, vy = 0, n = 0;
  for (const o of fish) {
    const dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy;
    if (o === f || d2 > 900) continue;
    if (d2 < 49) { ax -= dx * 4; ay -= dy * 4; }
    if (o.k === k) { cx += dx; cy += dy; vx += o.vx; vy += o.vy; n++; }
  }
  if (n) { ax += cx / n * 0.4 + (vx / n - f.vx) * 0.8; ay += cy / n * 0.4 + (vy / n - f.vy) * 0.8; }
  const gx = k.gx + f.ox - f.x, gy = k.gy + f.oy - f.y, gd = Math.hypot(gx, gy) || 1;
  ax += gx / gd * k.speed * 1.2; ay += gy / gd * k.speed * 0.8;
  ax += Math.max(0, 16 - f.x) * 5 - Math.max(0, f.x - (w - 16)) * 5;
  ay += Math.max(0, top - f.y) * 6 - Math.max(0, f.y - bot) * 6;
  if (fright) { const dx = f.x - fright.x, dy = f.y - fright.y, d = Math.hypot(dx, dy) || 1;
    if (d < 45) { ax += dx / d * 600; ay += dy / d * 600; f.fear = 1; } }
  f.fear = Math.max(0, f.fear - dt * 0.6);
  f.vx += ax * dt; f.vy += ay * dt;
  const want = k.speed * (0.55 + 0.45 * Math.sin(t * 0.5 + f.ph * 2)) * (1 + f.fear * 3);
  const sp = Math.hypot(f.vx, f.vy) || 1, s = sp + (want - sp) * Math.min(1, dt * 3);
  f.vx *= s / sp; f.vy = Math.max(-4 - Math.abs(f.vx), Math.min(4 + Math.abs(f.vx), f.vy * s / sp));
  f.x += f.vx * dt; f.y += f.vy * dt;
  if (f.vx > 2) f.face = 1; else if (f.vx < -2) f.face = -1;
  f.tick += dt * (1.5 + s * 0.25);
}

function scuttle(c, dt) {
  let sp = 8;
  if (fright && Math.abs(fright.x - c.x) < 30 && fright.y > sand - 30) { c.dir = fright.x < c.x ? 1 : -1; c.wait = 0; sp = 30; }
  if (c.wait > 0) c.wait -= dt;
  else { c.x += c.dir * sp * dt; c.tick += dt * sp * 0.6; if (Math.random() < dt * 0.3) c.wait = 1 + Math.random() * 3; }
  if (c.x < 8) c.dir = 1; else if (c.x > w - 8) c.dir = -1; else if (Math.random() < dt * 0.08) c.dir *= -1;
}

function weed(l, s, t) {
  for (let i = 0; i < s.len; i++) {
    const x = s.x + Math.round(Math.sin(t * 1.1 + s.ph + i * 0.18) * 3 * i / s.len), y = sand + 2 - i;
    px(l, x - 1, y, "k"); px(l, x, y, "g"); px(l, x + 1, y, i % 4 ? "g" : "l"); px(l, x + 2, y, "k");
    if (i % 6 === 3) { const side = i % 12 < 6 ? 2 : -2; px(l, x + side, y, "l"); px(l, x + side * 1.5, y, "k"); }
    if (i === s.len - 1) px(l, x, y - 1, "k", 2);
  }
}

function draw(l, t, dt) {
  for (const k of KINDS) if ((k.wait -= dt) < 0) {
    const top = SURF + 8, bot = sand - 6;
    k.gx = 24 + Math.random() * (w - 48); k.gy = top + (bot - top) * (k.y[0] + Math.random() * (k.y[1] - k.y[0])); k.wait = 4 + Math.random() * 6;
  }
  if (fright && (fright.left -= dt) < 0) fright = null;
  l.drawImage(water, 0, 0);
  l.drawImage(shafts, Math.round(Math.sin(t * 0.2) * 5) - 8, 0);
  for (const s of weeds) if (!s.front) weed(l, s, t);
  l.drawImage(deco, 0, 0);
  for (const v of vents) if ((v.wait -= dt) < 0) { blow(v.x, v.y, v.n); v.wait = v.every * (0.6 + Math.random() * 0.8); }
  bubbles = bubbles.filter((b) => (b.y -= b.v * dt) > SURF + 2);
  for (const b of bubbles) {
    const x = Math.round(b.x + Math.sin(t * 3 + b.ph) * 1.2), y = Math.round(b.y);
    if (b.big) { px(l, x, y - 1, "t"); px(l, x - 1, y, "t"); px(l, x + 1, y, "t"); px(l, x, y + 1, "t"); px(l, x - 1, y - 1, "w"); }
    else px(l, x, y, "w");
  }
  scuttle(crab, dt);
  const ci = CRAB_IMG[crab.wait > 0 ? 0 : Math.floor(crab.tick) % 2];
  l.drawImage(ci, Math.round(crab.x - ci.width / 2), sand + 4 - ci.height);
  for (const f of fish) {
    swim(f, t, dt);
    const img = f.k.img[Math.floor(f.tick) % 2], x = Math.round(f.x - img.width / 2), y = Math.round(f.y - img.height / 2);
    if (f.face > 0) l.drawImage(img, x, y);
    else { l.save(); l.scale(-1, 1); l.drawImage(img, -x - img.width, y); l.restore(); }
  }
  for (const s of weeds) if (s.front) weed(l, s, t);
  for (let x = 0; x < w; x++) {                                   // the wavy water line, air above it
    const y = SURF + Math.round(Math.sin(x * 0.15 + t * 1.8) * 1.2 + Math.sin(x * 0.05 - t * 0.9));
    l.fillStyle = PAL.n; l.fillRect(x, 0, 1, y);
    px(l, x, y, "w"); if ((x + Math.floor(t * 4)) % 3) px(l, x, y + 1, "t");
  }
}

// The browser stops calling frame while the tab is hidden, so the tank pauses; a long gap counts as one short step.
function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000, dt = Math.min(0.05, Math.max(0, t - last)); last = t;
  if (!fit()) return;
  draw(low.getContext("2d"), t, dt);
  g.imageSmoothingEnabled = false;
  g.drawImage(low, 0, 0, w * S, h * S);
}
requestAnimationFrame(frame);
`;

export const FISH_TANK_FILES: Readonly<Record<string, string>> = { "index.html": index, "world.js": world };
