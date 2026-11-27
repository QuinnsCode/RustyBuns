// The world a new room starts with: a night desert on a 2D canvas (low dunes, a moon, twinkling stars, two cactuses
// and a rock), in two files, so the agent's first look shows working code to change or throw away. Plain strings:
// these are the files.

const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My world</title>
<style>
  html, body { margin: 0; height: 100%; background: #0b1030; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script src="world.js"></script>
</body>
</html>
`;

const world = `// A night desert: low dunes under a moon, stars that twinkle, two cactuses and a rock.
// Change anything: the sand, the sky, what stands on the dunes. Or replace it all with a three.js scene.
const cv = document.getElementById("c"), g = cv.getContext("2d");
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let W, H, S, stars;

// A dune's top edge at x: a few slow waves on a base height (0 is the top of the screen, 1 the bottom).
const dune = (x, base, amp, k) => H * base - S * amp * (Math.sin(x / S * k + base * 9) * 0.6 + Math.sin(x / S * k * 2.3 + 1) * 0.4);
const DUNES = [[0.66, 0.05, 2.2, "#2a2350"], [0.74, 0.04, 3.1, "#3b2c55"], [0.84, 0.05, 2.6, "#4f3556"]];

function size() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight; S = Math.min(W, H);
  cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  seed = 7;
  stars = Array.from({ length: Math.round(W * H / 2600) }, () => ({ x: rnd() * W, y: rnd() * H * 0.7, r: 0.4 + rnd() * 1.2, p: rnd() * 6.3, v: 0.4 + rnd() * 1.4 }));
}

function cactus(x, h) {
  const y = dune(x, ...DUNES[2].slice(0, 3)) + 2, w = h * 0.16;
  g.strokeStyle = "#1a2a2a"; g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = w;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h);
  g.moveTo(x, y - h * 0.45); g.lineTo(x - h * 0.28, y - h * 0.45); g.lineTo(x - h * 0.28, y - h * 0.75);
  g.moveTo(x, y - h * 0.6); g.lineTo(x + h * 0.25, y - h * 0.6); g.lineTo(x + h * 0.25, y - h * 0.85);
  g.stroke();
}

function frame(t) {
  const sky = g.createLinearGradient(0, 0, 0, H * 0.8);
  sky.addColorStop(0, "#060a24"); sky.addColorStop(0.6, "#1b1b4a"); sky.addColorStop(1, "#4a2f5e");
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  for (const s of stars) {
    g.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 1000 * s.v + s.p));
    g.fillStyle = "#fff"; g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  // The moon, with a soft halo, rising very slowly.
  const mx = W * 0.76, my = H * 0.2 - Math.sin(t / 60000) * S * 0.02, mr = S * 0.07;
  const halo = g.createRadialGradient(mx, my, mr, mx, my, mr * 4);
  halo.addColorStop(0, "rgba(255,240,200,.35)"); halo.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = halo; g.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
  g.fillStyle = "#fff4d6"; g.beginPath(); g.arc(mx, my, mr, 0, 7); g.fill();
  g.fillStyle = "rgba(200,180,150,.35)";
  for (const [dx, dy, r] of [[-0.3, -0.2, 0.18], [0.25, 0.15, 0.24], [-0.1, 0.4, 0.12]]) { g.beginPath(); g.arc(mx + dx * mr, my + dy * mr, r * mr, 0, 7); g.fill(); }
  // The dunes, far to near, each with a moonlit edge.
  for (const [base, amp, k, color] of DUNES) {
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) g.lineTo(x, dune(x, base, amp, k));
    g.lineTo(W, H); g.closePath(); g.fillStyle = color; g.fill();
    g.strokeStyle = "rgba(255,226,180,.18)"; g.lineWidth = 1.5; g.stroke();
  }
  cactus(W * 0.22, S * 0.2);
  cactus(W * 0.64, S * 0.12);
  // A rock on the near dune.
  const rx = W * 0.42, ry = dune(rx, ...DUNES[2].slice(0, 3)) + 4, rs = S * 0.05;
  g.fillStyle = "#2b2236"; g.beginPath();
  g.moveTo(rx - rs, ry); g.lineTo(rx - rs * 0.6, ry - rs * 0.7); g.lineTo(rx + rs * 0.2, ry - rs * 0.9); g.lineTo(rx + rs, ry - rs * 0.3); g.lineTo(rx + rs * 1.1, ry);
  g.closePath(); g.fill();
  requestAnimationFrame(frame);
}

addEventListener("resize", size);
size();
requestAnimationFrame(frame);
`;

export const STARTER_FILES: Readonly<Record<string, string>> = { "index.html": index, "world.js": world };
