// A pixel yule log for the bottom of the page: two crossed logs and a fire made with the old spreading-heat trick
// (each pixel of heat rises, cools a little and drifts sideways at random). 64 by 40 pixels, scaled up crisp.
const W = 64, H = 40, TOP = H - 10;

// Heat 0 (nothing) to 36 (white hot), through embers, red, orange and yellow.
const STOPS: [number, [number, number, number]][] = [[0, [40, 8, 4]], [8, [150, 30, 10]], [16, [220, 80, 20]], [26, [250, 170, 50]], [36, [255, 245, 200]]];
const PALETTE = Array.from({ length: 37 }, (_, h) => {
  const i = STOPS.findIndex(([at]) => at >= h);
  const [b, cb] = STOPS[Math.max(0, i)]!, [a, ca] = STOPS[Math.max(0, i - 1)]!;
  const k = b === a ? 0 : (h - a) / (b - a);
  return ca.map((c, j) => Math.round(c + (cb[j]! - c) * k)) as [number, number, number];
});

const BARK = "#5b3a24", DARK = "#3a2416", GRAIN = "#c99a68", RING = "#8a5f3c";

function logs(ctx: CanvasRenderingContext2D) {
  const px = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  // Back log, left low to right high, then the front log across it.
  for (let i = 0; i < 40; i++) { const x = 10 + i, y = TOP + 6 - Math.round(i / 10); px(x, y, 1, 4, i % 7 === 0 ? DARK : BARK); px(x, y + 3, 1, 1, DARK); }
  px(49, TOP + 1, 4, 5, GRAIN); px(50, TOP + 2, 2, 3, RING);
  for (let i = 0; i < 44; i++) { const x = 52 - i, y = TOP + 5 - Math.round(i / 14); px(x, y, 1, 5, i % 9 === 0 ? DARK : BARK); px(x, y, 1, 1, "#7a5034"); }
  px(6, TOP + 2, 3, 6, GRAIN); px(7, TOP + 4, 1, 2, RING);
  px(4, H - 2, 56, 2, "#2a1a10");
}

/** Lights the log on `canvas` and keeps it burning; still (one frame) for people who asked for less motion. */
export function yule(canvas: HTMLCanvasElement): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const heat = new Uint8Array(W * H), img = ctx.createImageData(W, H);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const frame = () => {
    // The bed burns hottest in the middle, so the flames peak there and lick lower at the ends.
    for (let x = 0; x < W; x++) {
      const off = Math.abs(x - W / 2);
      heat[TOP * W + x] = off < 18 ? Math.max(0, Math.min(36, 38 - off * 0.9 + ((Math.random() * 6) | 0) - 3)) : 0;
    }
    for (let y = 1; y <= TOP; y++) for (let x = 0; x < W; x++) {
      const src = y * W + x, h = heat[src]!;
      if (x < 3 || x > W - 4) { heat[src - W] = 0; continue; }
      const r = (Math.random() * 3) | 0, dst = src - W - r + 1;
      if (dst >= 0) heat[dst] = Math.max(0, h - (r & 1) - (Math.random() < 0.65 ? 2 : 0));
    }
    for (let i = 0; i < W * H; i++) {
      const h = heat[i]!, [r, g, b] = PALETTE[h]!;
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = h ? Math.min(255, 60 + h * 6) : 0;
    }
    ctx.putImageData(img, 0, 0);
    logs(ctx);
  };
  for (let i = 0; i < 40; i++) frame();
  if (!still) setInterval(frame, 70);
}
