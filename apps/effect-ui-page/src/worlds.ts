// Worlds already written, for a person to try before any AI is connected: one click loads one, as an undoable change.
// Each has one thing to ask an AI next. Plain strings: these are the files, drawn on a 2D canvas with no libraries.
import { FISH_TANK_FILES } from "./fish-tank.ts";
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


export interface Ready { readonly name: string; readonly ask: string; readonly files: Readonly<Record<string, string>> }

export const READY: readonly Ready[] = [
  { name: "Rainy city", ask: "make it a thunderstorm with lightning", files: RAIN_CITY_FILES },
  { name: "Solar system", ask: "give the big planet rings and add a comet", files: { "index.html": index("Solar system", "#05060f"), "world.js": solar } },
  { name: "Fish tank", ask: "add a shark that cruises the tank and makes the other fish scatter", files: FISH_TANK_FILES },
];
