// A built-in corpus: made-up web pages drawn on a canvas from a seed, so the demo works offline
// with nothing to upload. Four site styles share parts (nav bars, buttons, cards, charts, forms),
// so a tile of one page finds the same kind of part on the others.
import { mulberry32 } from "@rustybuns/util";

export const PAGE_W = 1280, PAGE_H = 800;

const SITES = [
  { name: "Shop", bg: "#ffffff", ink: "#141414", accent: "#e8590c", soft: "#f4f3f0" },
  { name: "Docs", bg: "#fbfbfd", ink: "#1d2433", accent: "#2f6fde", soft: "#eef2fb" },
  { name: "News", bg: "#fffdf7", ink: "#222222", accent: "#b3261e", soft: "#f3efe4" },
  { name: "Dash", bg: "#0f1115", ink: "#e8eaf0", accent: "#3ecf8e", soft: "#1b1f27" },
] as const;

export interface Page { name: string; canvas: HTMLCanvasElement }

type Ctx = CanvasRenderingContext2D;
const rr = (c: Ctx, x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };

function text(c: Ctx, x: number, y: number, w: number, lines: number, h: number, rand: () => number) {
  for (let i = 0; i < lines; i++) rr(c, x, y + i * h * 1.9, w * (i === lines - 1 ? 0.4 + rand() * 0.4 : 0.85 + rand() * 0.15), h, h / 2);
}

function draw(c: Ctx, site: (typeof SITES)[number], rand: () => number) {
  const { bg, ink, accent, soft } = site;
  c.fillStyle = bg; c.fillRect(0, 0, PAGE_W, PAGE_H);
  // Nav: logo, links, a button.
  c.fillStyle = soft; c.fillRect(0, 0, PAGE_W, 64);
  c.fillStyle = accent; rr(c, 24, 18, 28, 28, 8);
  c.fillStyle = ink; for (let i = 0; i < 4; i++) rr(c, 90 + i * 110, 28, 70 + rand() * 20, 10, 5);
  c.fillStyle = accent; rr(c, PAGE_W - 150, 14, 120, 36, 18);
  let y = 100;
  while (y < PAGE_H - 80) {
    const kind = Math.floor(rand() * 5);
    if (kind === 0) { // hero: headline, copy, a button, a picture
      c.fillStyle = ink; text(c, 60, y + 20, 520, 2, 26, rand);
      c.globalAlpha = 0.5; text(c, 60, y + 130, 480, 3, 10, rand); c.globalAlpha = 1;
      c.fillStyle = accent; rr(c, 60, y + 200, 160, 44, 22);
      const g = c.createLinearGradient(700, y, 1220, y + 260); g.addColorStop(0, accent); g.addColorStop(1, soft);
      c.fillStyle = g; rr(c, 700, y, 520, 260, 20);
      y += 300;
    } else if (kind === 1) { // cards
      const n = 3 + Math.floor(rand() * 2), w = (PAGE_W - 120 - (n - 1) * 24) / n;
      for (let i = 0; i < n; i++) {
        const x = 60 + i * (w + 24);
        c.fillStyle = soft; rr(c, x, y, w, 200, 16);
        c.fillStyle = accent; rr(c, x + 20, y + 20, 40, 40, 12);
        c.fillStyle = ink; text(c, x + 20, y + 84, w - 40, 3, 9, rand);
      }
      y += 240;
    } else if (kind === 2) { // a bar chart
      c.fillStyle = soft; rr(c, 60, y, PAGE_W - 120, 220, 16);
      c.fillStyle = accent;
      for (let i = 0; i < 18; i++) { const h = 30 + rand() * 150; c.fillRect(100 + i * 60, y + 190 - h, 34, h); }
      y += 260;
    } else if (kind === 3) { // a form
      c.fillStyle = ink; text(c, 60, y, 300, 1, 16, rand);
      c.strokeStyle = ink; c.lineWidth = 2;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.roundRect(60, y + 40 + i * 56, 420, 40, 10); c.stroke(); }
      c.fillStyle = accent; rr(c, 60, y + 220, 140, 40, 20);
      c.fillStyle = soft; rr(c, 560, y, 660, 260, 16);
      y += 290;
    } else { // an article column
      c.fillStyle = ink; text(c, 60, y, 700, 1, 20, rand);
      c.globalAlpha = 0.6; text(c, 60, y + 50, 700, 8, 8, rand); c.globalAlpha = 1;
      c.fillStyle = soft; rr(c, 820, y, 400, 180, 16);
      y += 220;
    }
  }
  c.fillStyle = soft; c.fillRect(0, PAGE_H - 60, PAGE_W, 60);
  c.fillStyle = ink; c.globalAlpha = 0.5; for (let i = 0; i < 5; i++) rr(c, 60 + i * 140, PAGE_H - 36, 90, 8, 4); c.globalAlpha = 1;
}

/** `count` pages from `seed`, cycling the four site styles. */
export function samplePages(count = 12, seed = 7): Page[] {
  const out: Page[] = [];
  for (let i = 0; i < count; i++) {
    const site = SITES[i % SITES.length];
    const canvas = document.createElement("canvas");
    canvas.width = PAGE_W; canvas.height = PAGE_H;
    draw(canvas.getContext("2d")!, site, mulberry32(seed * 1000 + i));
    out.push({ name: `${site.name} ${Math.floor(i / SITES.length) + 1}`, canvas });
  }
  return out;
}

/** A dropped screenshot as a page, scaled down to at most PAGE_W wide. */
export async function pageFromFile(file: File): Promise<Page> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, PAGE_W / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * s); canvas.height = Math.round(bmp.height * s);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return { name: file.name, canvas };
}
