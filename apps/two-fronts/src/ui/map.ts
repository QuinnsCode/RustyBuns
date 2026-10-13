// The galaxy map as SVG, laid out like a world-conquest board: each system owns a territory (its
// Voronoi cell, capped so it doesn't sprawl), tinted by who holds its capital and hatched when the
// enemy holds its orbit. Regions are the continents, outlined in their own colour with a bonus
// badge that lights for whoever holds every capital in them. Armies and fleets stand on the
// territories as numbered pieces, front-line lanes run hot, and this turn's orders are arrows.
import { FACTION_COLORS as COLORS, type Faction } from "../battle/contract.ts";
import { galaxyOf } from "../war/galaxy.ts";
import { ORBIT, enemy, holds, regionHolder, type Attack, type Campaign, type Order, type Retreat } from "../war/rules.ts";

const hex = (f: Faction | null) => (f ? `#${COLORS[f].toString(16).padStart(6, "0")}` : "none");
const R = 3.4;     // the planet
const CAP = 15;    // a territory reaches no further than this from its system
const REGION_COLORS = ["#5b8def", "#9b7bea", "#3fb6a8", "#e0b341", "#e46a6a", "#6fbf5a", "#d47fc0"];

type Pt = [number, number];
// A convex polygon, each vertex tagged with what made the edge leaving it: the index of the
// neighbouring system whose bisector cut it, or -1 for the cap and the map's edge.
type Poly = { p: Pt; tag: number }[];

// Keeps the side of the line a·p <= c, tagging the new edge along the line.
function clip(poly: Poly, a: Pt, c: number, tag: number): Poly {
  const out: Poly = [], inside = (p: Pt) => a[0] * p[0] + a[1] * p[1] <= c + 1e-9;
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i]!, Q = poly[(i + 1) % poly.length]!, pin = inside(P.p), qin = inside(Q.p);
    const cut = (): Pt => {
      const dp = a[0] * P.p[0] + a[1] * P.p[1], dq = a[0] * Q.p[0] + a[1] * Q.p[1], t = (c - dp) / (dq - dp);
      return [P.p[0] + (Q.p[0] - P.p[0]) * t, P.p[1] + (Q.p[1] - P.p[1]) * t];
    };
    if (pin && qin) out.push(P);
    else if (pin) out.push(P, { p: cut(), tag });
    else if (qin) out.push({ p: cut(), tag: P.tag });
  }
  return out;
}

// Each system's territory: a disc of radius CAP, cut to the map and to its Voronoi cell.
function territories(sites: Pt[], width: number): Poly[] {
  return sites.map(([x, y], i) => {
    let poly: Poly = Array.from({ length: 32 }, (_, k) => ({ p: [x + CAP * Math.cos((k / 32) * Math.PI * 2), y + CAP * Math.sin((k / 32) * Math.PI * 2)] as Pt, tag: -1 }));
    poly = clip(clip(clip(clip(poly, [-1, 0], -1, -1), [1, 0], width - 1, -1), [0, -1], -1, -1), [0, 1], 99, -1);
    sites.forEach(([u, v], j) => {
      if (j === i) return;
      // Closer to i than to j: (j - i)·p <= (|j|² - |i|²) / 2.
      poly = clip(poly, [u - x, v - y], (u * u + v * v - x * x - y * y) / 2, j);
    });
    return poly;
  });
}
const pathOf = (poly: Poly) => `M${poly.map((v) => `${v.p[0].toFixed(2)} ${v.p[1].toFixed(2)}`).join("L")}Z`;

function wedge(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  return `M${cx} ${cy} L${p(a0)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z`;
}

// A board piece: an army is a round counter, a fleet a chevron, each with its count.
// A count of "?" is the enemy where nobody of ours is there to count them.
const many = (n: number | "?", one: string, more: string) => (n === "?" ? `${more}, how many unknown` : `${n} ${n === 1 ? one : more}`);
const armyPiece = (x: number, y: number, f: Faction, n: number | "?") =>
  `<g class="piece ${f}${n === "?" ? " unknown" : ""}"><title>${many(n, "army", "armies")}</title><circle cx="${x}" cy="${y}" r="2.2"/><text x="${x}" y="${y + 0.95}">${n}</text></g>`;
const fleetPiece = (x: number, y: number, f: Faction, n: number | "?") =>
  `<g class="piece fleet ${f}${n === "?" ? " unknown" : ""}"><title>${many(n, "ship", "ships")}</title><path d="M${x - 2.6} ${y + 1.6}L${x} ${y - 2.2}L${x + 2.6} ${y + 1.6}L${x} ${y + 0.6}Z"/><text x="${x}" y="${y + 4.3}">${n}</text></g>`;
// The lucide "swords" icon, centred on x, y.
const swords = (x: number, y: number) => `<g class="hero-mark" transform="translate(${x - 2.4} ${y - 2.4}) scale(0.2)"><title>Hero battle</title><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/></g>`;
// A shield-shaped badge for a region's bonus.
const badge = (x: number, y: number, bonus: number, holder: Faction | null, name: string) =>
  `<g class="badge${holder ? ` held ${holder}` : ""}"><title>${name}: +${bonus} a turn to whoever holds every capital in it</title>
    <path d="M${x} ${y - 3}L${x + 2.6} ${y - 2}V${y + 0.4}C${x + 2.6} ${y + 2.2} ${x} ${y + 3.2} ${x} ${y + 3.2}C${x} ${y + 3.2} ${x - 2.6} ${y + 2.2} ${x - 2.6} ${y + 0.4}V${y - 2}Z"/>
    <text x="${x}" y="${y + 1}">+${bonus}</text></g>`;

// Twinkles, the same every draw.
function stars(width: number) {
  let s = 7, out = "";
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < width * 1.2; i++) out += `<circle cx="${(r() * width).toFixed(1)}" cy="${(r() * 100).toFixed(1)}" r="${(0.08 + r() * 0.18).toFixed(2)}" opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`;
  return `<g class="stars">${out}</g>`;
}

// While the turn waits on retreats: the attacks declared, and this seat's answers to them.
export interface Declared { me: Faction; attacks: Attack[]; retreats: Retreat[] }

export function drawMap(c: Campaign, orders: Order[], selected: string | null, hero: { system: string } | undefined, declared?: Declared) {
  const g = galaxyOf(c), systemDef = g.system, W = g.width;
  const regionIx = new Map(g.regions.map((r, i) => [r.id, i]));
  const cells = territories(g.systems.map((d) => [d.x, d.y]), W);
  const ownerOf = (id: string) => (holds(c.systems[id]!, "marines") ? "marines" : holds(c.systems[id]!, "wooka") ? "wooka" : null);
  const near = new Set(selected ? g.neighbours(selected) : []);

  const lands = g.systems.map((d, i) => {
    const s = c.systems[d.id]!, f = ownerOf(d.id), blockaded = f && s.orbit === enemy(f);
    return `<path d="${pathOf(cells[i]!)}" class="land ${f ?? ""}${near.has(d.id) ? " reach" : ""}" data-system="${d.id}"/>${blockaded ? `<path d="${pathOf(cells[i]!)}" class="blockade"><title>${d.name} is blockaded</title></path>` : ""}`;
  }).join("");
  // Region borders: the cell edges that face another region or open space.
  const borders = g.systems.map((d, i) => {
    const poly = cells[i]!, ri = regionIx.get(d.region)!;
    return poly.map((v, k) => {
      if (v.tag >= 0 && g.systems[v.tag]!.region === d.region) return "";
      const q = poly[(k + 1) % poly.length]!.p;
      return `<line x1="${v.p[0].toFixed(2)}" y1="${v.p[1].toFixed(2)}" x2="${q[0].toFixed(2)}" y2="${q[1].toFixed(2)}" stroke="${REGION_COLORS[ri % REGION_COLORS.length]}"/>`;
    }).join("");
  }).join("");
  const regions = g.regions.map((r) => {
    const [x, y] = r.label, holder = regionHolder(c, r.id), up = y < 50 ? 1 : -1;
    return `<g class="region-tag"><text x="${x}" y="${y + up * 0.6}" class="region">${r.name}</text>${badge(x + r.name.length * 0.95 + 4, y - 0.4 + up * 0.6, r.bonus, holder, r.name)}</g>`;
  }).join("");

  const lanes = g.lanes.map(([a, b]) => {
    const p = systemDef(a), q = systemDef(b), fa = ownerOf(a), fb = ownerOf(b);
    return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" class="lane${fa && fb && fa !== fb ? " front" : ""}"/>`;
  }).join("");

  // Orders as curved arrows, armies bowing one way and fleets the other, the count on the bend.
  const moves = orders.flatMap((o) => {
    if (o.kind === "build") return [];
    const from = systemDef(o.kind === "fleet" ? o.from : o.from.system), to = systemDef(o.kind === "fleet" ? o.to : o.to.system);
    if (from.id === to.id) return [`<circle cx="${from.x}" cy="${from.y}" r="${R + 3}" class="move army"/>`];
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy), k = (R + 2.5) / len, bow = (o.kind === "army" ? 1 : -1) * len * 0.18;
    const nx = -dy / len, ny = dx / len, mx = (from.x + to.x) / 2 + nx * bow, my = (from.y + to.y) / 2 + ny * bow;
    const sx = from.x + dx * k, sy = from.y + dy * k, ex = to.x - dx * k, ey = to.y - dy * k;
    // The count sits on the curve's midpoint, halfway to the control point.
    const lx = (sx + ex) / 4 + mx / 2, ly = (sy + ey) / 4 + my / 2;
    return [`<g class="move-g ${o.kind}"><path d="M${sx} ${sy}Q${mx} ${my} ${ex} ${ey}" class="move ${o.kind}" marker-end="url(#arrow-${o.kind})"/>
      <circle cx="${lx}" cy="${ly}" r="1.8" class="move-n"/><text x="${lx}" y="${ly + 0.8}" class="move-t">${o.count}</text></g>`];
  }).join("");

  // The declared attacks: heavy arrows, the enemy's with no count on them. Called off, they fade;
  // a pull-back is a dashed arrow home.
  const arrow = (ax: number, ay: number, bx: number, by: number, cls: string, label: string, bend = 0.15) => {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, k = (R + 2.5) / len, nx = -dy / len, ny = dx / len;
    const mx = (ax + bx) / 2 + nx * len * bend, my = (ay + by) / 2 + ny * len * bend;
    const sx = ax + dx * k, sy = ay + dy * k, ex = bx - dx * k, ey = by - dy * k, lx = (sx + ex) / 4 + mx / 2, ly = (sy + ey) / 4 + my / 2;
    return `<g class="declared ${cls}"><path d="M${sx} ${sy}Q${mx} ${my} ${ex} ${ey}" marker-end="url(#arrow-attack)"/>${label ? `<circle cx="${lx}" cy="${ly}" r="1.9"/><text x="${lx}" y="${ly + 0.85}">${label}</text>` : ""}</g>`;
  };
  const same = (a: { system: string; sector: number }, b: { system: string; sector: number }) => a.system === b.system && a.sector === b.sector;
  const attacks = (declared?.attacks ?? []).map((a) => {
    const p = systemDef(a.from), q = systemDef(a.to.system), mine = a.faction === declared!.me;
    const off = mine && declared!.retreats.some((r) => r.kind === "calloff" && same(r.to, a.to));
    return `${arrow(p.x, p.y, q.x, q.y, `${mine ? "mine" : "theirs"} ${a.faction}${off ? " off" : ""}${a.to.sector === ORBIT ? " orbit" : ""}`, mine ? "" : "?", -0.12)}`;
  }).join("") + (declared?.retreats ?? []).map((r) => {
    if (r.kind !== "withdraw" || r.from.system === r.to.system) return "";
    const p = systemDef(r.from.system), q = systemDef(r.to.system);
    return arrow(p.x, p.y, q.x, q.y, "pullback", "", 0.1);
  }).join("");

  const systems = g.systems.map((d) => {
    const s = c.systems[d.id]!, n = s.sectors.length;
    const body = n === 1
      ? `<circle cx="${d.x}" cy="${d.y}" r="${R}" fill="${hex(s.sectors[0]!.owner)}" class="planet"/>`
      : s.sectors.map((x, i) => `<path d="${wedge(d.x, d.y, R, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2)}" fill="${hex(x.owner)}" class="wedge"/>`).join("");
    const armies = s.sectors.reduce((a, x) => ({ marines: a.marines + x.armies.marines, wooka: a.wooka + x.armies.wooka }), { marines: 0, wooka: 0 });
    // The player's pieces on the left, the other side's on the right.
    const side = (f: Faction) => (f === c.player ? -1 : 1);
    // In the fog, the enemy's ground and orbit show a piece with no number on it.
    const foggy = (f: Faction) => s.fog && f !== declared?.me;
    const nArmies = (f: Faction) => (foggy(f) ? (s.sectors.some((x) => x.owner === f) ? "?" : 0) : armies[f]);
    const nFleets = (f: Faction) => (foggy(f) ? (s.orbit === f ? "?" : 0) : s.fleets[f]);
    const pieces = (["marines", "wooka"] as const).map((f) => {
      const a = nArmies(f), n = nFleets(f);
      return (a ? armyPiece(d.x + side(f) * 6.4, d.y + 1.2, f, a) : "") + (n ? fleetPiece(d.x + side(f) * 4.4, d.y - 6.6, f, n) : "");
    }).join("");
    return `<g class="system${selected === d.id ? " selected" : ""}${near.has(d.id) ? " reach" : ""}" data-system="${d.id}" tabindex="0" role="button" aria-label="${d.name}">
      <circle cx="${d.x}" cy="${d.y}" r="${R + 1.4}" class="orbit" stroke="${s.orbit ? hex(s.orbit) : "#6b7280"}" ${s.orbit ? "" : 'stroke-dasharray="1 1"'}><title>Orbit: ${s.orbit ?? "nobody"}</title></circle>
      ${body}
      ${hero?.system === d.id ? swords(d.x, d.y) : ""}
      ${pieces}
      <text x="${d.x}" y="${d.y + R + 5.4}" class="name">${d.name}</text>
    </g>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} 100" class="galaxy" role="img" aria-label="The galaxy map">
    <defs>
      <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" class="grid"/></pattern>
      <pattern id="hatch" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.6" class="hatch"/></pattern>
      <radialGradient id="vignette" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.65"/></radialGradient>
      <marker id="arrow-army" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L6 3L0 6z" class="tip army"/></marker>
      <marker id="arrow-attack" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.5" markerHeight="3.5" orient="auto"><path d="M0 0L6 3L0 6z" class="tip attack"/></marker>
      <marker id="arrow-fleet" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L6 3L0 6z" class="tip fleet"/></marker>
    </defs>
    <rect width="${W}" height="100" class="board"/><rect width="${W}" height="100" fill="url(#grid)"/>${stars(W)}
    <g class="lands">${lands}</g><g class="borders">${borders}</g>
    <rect width="${W}" height="100" fill="url(#vignette)" pointer-events="none"/>
    ${lanes}${regions}${moves}${attacks}${systems}</svg>`;
}
