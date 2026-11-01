// A beast's stat card: the radar of its six stats (also on the picker), and the full trading card of the
// bestiary (`?cards=1`): its pictures (a black-and-white drawing and a colour one, src/art.ts), the radar with
// the numbers on it, its body, and its signature move, with the credit each picture's licence asks for.
import { esc } from "@rustybuns/util";
import { Art, type Pic } from "./art.ts";
import artJson from "./art.json";
import { COLOR, type Field } from "./fields.ts";
import { icon } from "./icons.ts";
import { REGIONS } from "./regions.ts";
import type { Creature } from "./roster.ts";

export const ART = Art(artJson);
const AXES = ["vigor", "might", "guard", "focus", "will", "speed"] as const;
export const hex = (f: Field) => `#${COLOR[f].toString(16).padStart(6, "0")}`;

/** The six stats as a hexagon on a 0-150 scale; `numbers` puts each value under its axis name. */
export function radar(c: Creature, numbers = false): string {
  const pt = (i: number, v: number) => { const t = (i / 6) * Math.PI * 2 - Math.PI / 2, r = (v / 150) * 42; return `${(50 + Math.cos(t) * r).toFixed(1)},${(50 + Math.sin(t) * r).toFixed(1)}`; };
  const ring = (v: number) => AXES.map((_, i) => pt(i, v)).join(" ");
  const color = hex(c.fields[0]!);
  return `<svg viewBox="0 0 100 100" class="radar" role="img" aria-label="${esc(c.name)} stats: ${AXES.map((a) => `${a} ${c.stats[a]}`).join(", ")}">
    <polygon points="${ring(150)}" class="grid"/><polygon points="${ring(75)}" class="grid"/>
    <polygon points="${AXES.map((a, i) => pt(i, c.stats[a])).join(" ")}" fill="${color}" fill-opacity="0.45" stroke="${color}"/>
    ${AXES.map((a, i) => { const [x, y] = pt(i, 175).split(","); return `<text x="${x}" y="${y}">${a}${numbers ? `<tspan x="${x}" dy="7" class="n">${c.stats[a]}</tspan>` : ""}</text>`; }).join("")}</svg>`;
}

const credit = (p: Pic) => `<a href="${esc(p.page)}" target="_blank" rel="noopener" title="${esc(p.artist)}, ${esc(p.license)}">${esc(p.artist)}</a> · `
  + (p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>` : esc(p.license));

/** The bestiary's card. Shows the colour picture first when it has one; the two icons swap sides. */
export function tradingCard(c: Creature): string {
  const art = ART[c.id], sides = (["color", "bw"] as const).filter((s) => art?.[s]);
  const region = REGIONS[c.region - 1];
  const pics = sides.map((s) => { const p = art![s]!; return `<figure class="pic ${s}"><img src="/${esc(p.src)}" alt="${esc(c.name)}, ${s === "bw" ? "black-and-white drawing" : "in colour"}" loading="lazy"/><figcaption>${credit(p)}</figcaption></figure>`; }).join("");
  const blank = `<figure class="pic none"><span>${esc(c.name[0] ?? "?")}</span><figcaption>No pictures yet</figcaption></figure>`;
  const swap = sides.length > 1 ? `<span class="swap">${sides.map((s) => `<button data-show="${s}" aria-label="${s === "bw" ? "Black and white" : "Colour"}" title="${s === "bw" ? "Black and white" : "Colour"}">${icon(s === "bw" ? "pencil" : "palette")}</button>`).join("")}</span>` : "";
  return `<article class="tcard" data-id="${esc(c.id)}" data-show="${sides[0] ?? "none"}" style="--fc:${hex(c.fields[0]!)}">
    <header><b>${esc(c.name)}</b><span class="dots">${c.fields.map((f) => `<i style="background:${hex(f)}" title="${f}"></i>`).join("")}</span></header>
    <div class="art">${pics || blank}${swap}</div>
    <p class="meta"><span class="cap">${esc(c.archetype)}</span> · ${c.fields.join(" / ")}<br>${c.massKg} kg · ${c.heightM} m${region ? ` · ${esc(region.name)}` : ""}</p>
    ${radar(c, true)}
    <p class="sig">${icon("star")}${esc(c.moves[5]?.name ?? "")}</p>
  </article>`;
}
