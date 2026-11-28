// Worlds already written, for a person to try before any AI is connected: one click loads one, as an undoable change.
// Each has one thing to ask an AI next. Plain strings: these are the files, drawn on a 2D canvas with no libraries.
import { RAIN_CITY_FILES } from "./rain-city.ts";

const index = (title: string, back: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  html, body { margin: 0; height: 100%; background: ${back}; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script src="world.js"></script>
</body>
</html>
`;

// The frame can be 0 wide on its first tick, so the size is read every frame.
const FRAME = `const cv = document.getElementById("c"), g = cv.getContext("2d");
function frame(t) {
  const W = innerWidth, H = innerHeight;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  draw(t / 1000, W, H);
  requestAnimationFrame(frame);
}
const dot = (x, y, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
requestAnimationFrame(frame);
`;

const solar = `// A solar system: change the planets, their colors and speeds.
const PLANETS = [[0.16, 4, "#b8b8c8", 1.6], [0.26, 7, "#ffb547", 1.2], [0.38, 8, "#21e6ff", 1], [0.5, 6, "#ff6b4a", 0.8], [0.7, 16, "#e0b080", 0.45], [0.9, 13, "#a67bff", 0.3]];
function draw(t, W, H) {
  g.fillStyle = "#05060f"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) dot((i * 487) % W, (i * 269) % H, i % 9 ? 0.7 : 1.4, "#8890c0");
  const cx = W / 2, cy = H / 2, R = Math.min(W / 2, H) * 0.95;
  dot(cx, cy, 26, "#ffd34a");
  for (const [far, size, color, speed] of PLANETS) {
    g.strokeStyle = "rgba(150,160,220,.25)"; g.beginPath(); g.ellipse(cx, cy, far * R, far * R * 0.45, 0, 0, 7); g.stroke();
    const a = t * speed + far * 20;
    dot(cx + Math.cos(a) * far * R, cy + Math.sin(a) * far * R * 0.45, size, color);
  }
}
${FRAME}`;

const fish = `// A fish tank: change how many fish, their colors, or add something bigger.
const COLORS = ["#ff7a3d", "#ffd34a", "#ff3d8b", "#3dffa8", "#a67bff"];
const FISH = Array.from({ length: 14 }, (_, i) => ({ depth: (i * 0.618) % 1, start: (i * 0.377) % 1, speed: 30 + (i * 17) % 50, size: 12 + (i * 7) % 18, way: i % 2 ? 1 : -1, color: COLORS[i % COLORS.length] }));
function draw(t, W, H) {
  const water = g.createLinearGradient(0, 0, 0, H);
  water.addColorStop(0, "#1b7fb5"); water.addColorStop(1, "#062a4a");
  g.fillStyle = water; g.fillRect(0, 0, W, H);
  g.fillStyle = "#c9a566"; g.fillRect(0, H - 40, W, 40);
  g.strokeStyle = "#2fbf71"; g.lineWidth = 7; g.lineCap = "round";
  for (let x = 40; x < W; x += 90) { g.beginPath(); g.moveTo(x, H - 38); g.quadraticCurveTo(x + Math.sin(t + x) * 30, H - 100, x + Math.sin(t * 1.3 + x) * 20, H - 150 - (x % 70)); g.stroke(); }
  for (const f of FISH) {
    const span = W + 100, along = (f.start * span + t * f.speed) % span;
    const x = f.way > 0 ? along - 50 : W + 50 - along, y = 50 + f.depth * Math.max(0, H - 140) + Math.sin(t * 2 + f.start * 9) * 8, s = f.size, w = f.way;
    g.fillStyle = f.color;
    g.beginPath(); g.ellipse(x, y, s, s * 0.6, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(x - w * s * 0.8, y); g.lineTo(x - w * s * 1.6, y - s * 0.6); g.lineTo(x - w * s * 1.6, y + s * 0.6); g.fill();
    dot(x + w * s * 0.5, y - s * 0.12, s * 0.12, "#05101c");
  }
  for (let i = 0; i < 24; i++) dot((i * 211) % W, H - ((t * (25 + i % 5 * 9) + i * 97) % H), 2 + i % 3, "rgba(255,255,255,.35)");
}
${FRAME}`;

export interface Ready { readonly name: string; readonly ask: string; readonly files: Readonly<Record<string, string>> }

export const READY: readonly Ready[] = [
  { name: "Rainy city", ask: "make it a thunderstorm with lightning", files: RAIN_CITY_FILES },
  { name: "Solar system", ask: "give the big planet rings and add a comet", files: { "index.html": index("Solar system", "#05060f"), "world.js": solar } },
  { name: "Fish tank", ask: "add a shark the other fish swim away from", files: { "index.html": index("Fish tank", "#062a4a"), "world.js": fish } },
];
