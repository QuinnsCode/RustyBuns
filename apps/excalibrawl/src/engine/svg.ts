// A fight as SVG, for the viewer: crisp shapes on the shared 700 × 700 canvas.

import type { SkeletonEl } from "./types.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${({ "&": "amp", "<": "lt", ">": "gt", '"': "quot" } as Record<string, string>)[c]};`);
const r = (n: number) => Math.round(n * 10) / 10;

export function elementSvg(el: SkeletonEl): string {
  const fill = el.backgroundColor ?? "none";
  const stroke = el.strokeColor ?? "#1e1e1e";
  const sw = el.strokeWidth ?? 2;
  const paint = `fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"`;
  switch (el.type) {
    case "rectangle":
      return `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.width)}" height="${r(el.height)}" rx="4" ${paint}/>`;
    case "ellipse":
      return `<ellipse cx="${r(el.x + el.width / 2)}" cy="${r(el.y + el.height / 2)}" rx="${r(el.width / 2)}" ry="${r(el.height / 2)}" ${paint}/>`;
    case "diamond": {
      const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
      return `<polygon points="${r(cx)},${r(el.y)} ${r(el.x + el.width)},${r(cy)} ${r(cx)},${r(el.y + el.height)} ${r(el.x)},${r(cy)}" ${paint}/>`;
    }
    case "line":
    case "arrow": {
      const pts = el.points.map(([x, y]) => `${r(el.x + x)},${r(el.y + y)}`).join(" ");
      return `<polyline points="${pts}" ${paint}/>`;
    }
    case "text":
      return `<text x="${r(el.x)}" y="${r(el.y + (el.fontSize ?? 20))}" font-size="${el.fontSize ?? 20}" fill="${esc(stroke)}" font-family="ui-rounded, system-ui">${esc(el.text)}</text>`;
  }
}

/** Every fighter's canvas in one SVG, with a divider between halves. */
export function sceneSvg(scenes: SkeletonEl[][], size = 700): string {
  const divider = scenes.length === 2 ? `<line x1="350" y1="0" x2="350" y2="700" stroke="#d0d0d0" stroke-dasharray="6 8"/>` : "";
  const body = scenes.flat().map(elementSvg).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 700" width="${size}" height="${size}"><rect width="700" height="700" fill="#fff"/>${divider}${body}</svg>`;
}
