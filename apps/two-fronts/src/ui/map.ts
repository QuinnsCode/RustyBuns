// The galaxy map as SVG: hyperlanes, systems coloured by who holds the capital, a ring for
// who holds the orbit, Kessa split into its sectors, and this turn's moves as arrows.
import { FACTION_COLORS as COLORS, type Faction } from "../battle/contract.ts";
import { LANES, REGIONS, SYSTEMS, systemDef } from "../war/galaxy.ts";
import type { Campaign, Order } from "../war/rules.ts";

const hex = (f: Faction | null) => (f ? `#${COLORS[f].toString(16).padStart(6, "0")}` : "none");
const R = 4.4;

function wedge(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  return `M${cx} ${cy} L${p(a0)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z`;
}

export function drawMap(c: Campaign, orders: Order[], selected: string | null, hero: { system: string } | undefined) {
  const lanes = LANES.map(([a, b]) => {
    const p = systemDef(a), q = systemDef(b);
    return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" class="lane"/>`;
  }).join("");
  const regions = REGIONS.map((r) => {
    const in_ = SYSTEMS.filter((s) => s.region === r.id);
    const x = in_.reduce((n, s) => n + s.x, 0) / in_.length;
    return `<text x="${x}" y="98" class="region">${r.name} +${r.bonus}</text>`;
  }).join("");
  const moves = orders.flatMap((o) => {
    if (o.kind === "build") return [];
    const from = systemDef(o.kind === "fleet" ? o.from : o.from.system), to = systemDef(o.kind === "fleet" ? o.to : o.to.system);
    if (from.id === to.id) return [`<circle cx="${from.x}" cy="${from.y}" r="${R + 2.4}" class="move army"/>`];
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy), k = (R + 1.5) / len, off = o.kind === "army" ? 1.4 : -1.4;
    const nx = (-dy / len) * off, ny = (dx / len) * off;
    return [`<line x1="${from.x + dx * k + nx}" y1="${from.y + dy * k + ny}" x2="${to.x - dx * k + nx}" y2="${to.y - dy * k + ny}" class="move ${o.kind}" marker-end="url(#arrow)"/>`];
  }).join("");
  const systems = SYSTEMS.map((d) => {
    const s = c.systems[d.id]!;
    const n = s.sectors.length;
    const body = n === 1
      ? `<circle cx="${d.x}" cy="${d.y}" r="${R}" fill="${hex(s.sectors[0]!.owner)}"/>`
      : s.sectors.map((x, i) => `<path d="${wedge(d.x, d.y, R, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2)}" fill="${hex(x.owner)}" class="wedge"/>`).join("");
    const ships = (f: Faction) => s.fleets[f] ? `<text x="${d.x + (f === c.player ? -R - 1 : R + 1)}" y="${d.y - R - 1.2}" class="ships" text-anchor="${f === c.player ? "end" : "start"}" fill="${hex(f)}">▲${s.fleets[f]}</text>` : "";
    const armies = s.sectors.reduce((a, x) => ({ marines: a.marines + x.armies.marines, wooka: a.wooka + x.armies.wooka }), { marines: 0, wooka: 0 });
    return `<g class="system${selected === d.id ? " selected" : ""}" data-system="${d.id}" tabindex="0" role="button" aria-label="${d.name}">
      <circle cx="${d.x}" cy="${d.y}" r="${R + 1.5}" class="orbit" stroke="${s.orbit ? hex(s.orbit) : "#6b7280"}" ${s.orbit ? "" : 'stroke-dasharray="1 1"'}/>
      ${body}
      ${hero?.system === d.id ? `<text x="${d.x}" y="${d.y + 1.3}" class="hero-mark">⚔</text>` : ""}
      ${ships("marines")}${ships("wooka")}
      <text x="${d.x}" y="${d.y + R + 4.6}" class="name">${d.name}</text>
      <text x="${d.x}" y="${d.y + R + 7.8}" class="armies"><tspan fill="${hex("marines")}">${armies.marines ? `■${armies.marines}` : ""}</tspan> <tspan fill="${hex("wooka")}">${armies.wooka ? `■${armies.wooka}` : ""}</tspan></text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 100 100" class="galaxy" role="img" aria-label="The galaxy map">
    <defs><marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L6 3L0 6z" fill="#e5e7eb"/></marker></defs>
    ${regions}${lanes}${moves}${systems}</svg>`;
}
