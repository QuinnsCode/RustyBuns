// The wind rose (#3585): a small compass card drawn from the hole's two wind levels, the one the disc rides in bright,
// the other dim, each arrow as long as its speed against the stronger. A readout, not a control: nothing here is clicked.
import type { Loft } from "./flight.ts";

export interface Gust { speed: number; to: number }

/** The rose as an SVG string, `size` px square. Directions are where the wind blows to, clockwise from north. */
export function windRose(lo: Gust | null, hi: Gust | null, loft: Loft, size = 96): string {
  const c = size / 2, r = c - 10, top = Math.max(lo?.speed ?? 0, hi?.speed ?? 0, 1);
  const ticks = Array.from({ length: 16 }, (_, i) => {
    const a = (i * 22.5 * Math.PI) / 180, long = i % 4 === 0, r0 = r - (long ? 6 : 3);
    return `<line x1="${(c + Math.sin(a) * r0).toFixed(1)}" y1="${(c - Math.cos(a) * r0).toFixed(1)}" x2="${(c + Math.sin(a) * r).toFixed(1)}" y2="${(c - Math.cos(a) * r).toFixed(1)}"/>`;
  }).join("");
  const arrow = (g: Gust | null, on: boolean, colour: string) => {
    if (!g) return "";
    const len = Math.max(0.25, g.speed / top) * (r - 8), w = on ? 3.2 : 2;
    return `<g transform="rotate(${g.to.toFixed(0)} ${c} ${c})" opacity="${on ? 1 : 0.45}"><line x1="${c}" y1="${c + len * 0.35}" x2="${c}" y2="${c - len}" stroke="${colour}" stroke-width="${w}" stroke-linecap="round"/><path d="M${c - 5} ${c - len + 6}L${c} ${c - len - 2}L${c + 5} ${c - len + 6}" fill="none" stroke="${colour}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/></g>`;
  };
  const letter = (t: string, x: number, y: number) => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${t}</text>`;
  return `<svg class="rose" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Wind rose">`
    + `<circle cx="${c}" cy="${c}" r="${r}" fill="#04101c" stroke="#1d3147"/><circle cx="${c}" cy="${c}" r="${r * 0.55}" fill="none" stroke="#1d3147" stroke-dasharray="2 3"/>`
    + `<g stroke="#7f94ab" stroke-width="1">${ticks}</g>`
    + `<g fill="#7f94ab" font-size="8" font-family="SF Mono, Menlo, monospace">${letter("N", c, c - r + 13)}${letter("E", c + r - 13, c)}${letter("S", c, c + r - 13)}${letter("W", c - r + 13, c)}</g>`
    + arrow(loft === "low" ? hi : lo, false, loft === "low" ? "#ffb347" : "#5ee6c8") + arrow(loft === "low" ? lo : hi, true, loft === "low" ? "#5ee6c8" : "#ffb347")
    + `<circle cx="${c}" cy="${c}" r="2.4" fill="#dbe7f3"/></svg>`;
}
