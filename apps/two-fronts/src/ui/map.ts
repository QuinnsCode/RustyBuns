// The galaxy map as SVG, drawn like a space empire's star map: each system owns a territory (its
// Voronoi cell, capped so it bulges round the star), and a side's territories run together into
// one translucent sweep with a glowing border where it meets the other side or open space. Hatched
// when the enemy holds the orbit. Each place is Open, Held or Contested for the seat looking
// (states.ts): a shield on the plaque where the enemy holds some of it, crossed swords, a pulse and
// a two-colour hatch where there's a fight this turn. Each system is a glowing star with a name plaque and a dot per
// sector in its holder's colour, over nebulae. Regions are dashed outlines with a bonus badge that
// lights for whoever holds every capital in them. Armies and fleets stand by the stars as numbered
// pieces, front-line lanes run hot, and this turn's orders are arrows.
import { FACTION_COLORS as COLORS, type Faction } from "../battle/contract.ts";
import { galaxyOf } from "../war/galaxy.ts";
import { ORBIT, enemy, holds, regionCover, regionHolder, type Attack, type Campaign, type Order, type Retreat } from "../war/rules.ts";
import { attacking } from "../war/phases.ts";
import { STATE_ICONS, STATE_NAMES, placeStates, systemState, type PlaceState } from "../war/states.ts";
import { icon } from "./icons.ts";

const hex = (f: Faction | null) => (f ? `#${COLORS[f].toString(16).padStart(6, "0")}` : "none");
// The empire colours on the star map: a side's sweep of territory and its border.
const TINT: Record<Faction, string> = { marines: "#3f7fd6", wooka: "#d07a2c" };
const STAR_COLORS = ["#fff6dc", "#ffd27a", "#ff9d5c", "#a8dcff", "#ffffff", "#ffe9a8"];
// A stable number per id, for each star's colour.
const hash = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const R = 2.6;     // the star's orbit ring
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

// A board piece: an army is a round counter, a fleet a chevron, each with its count.
// A count of "?" is the enemy where nobody of ours is there to count them: a question mark
// in a circle stands in for the number.
const many = (n: number | "?", one: string, more: string) => (n === "?" ? `${more}, how many unknown` : `${n} ${n === 1 ? one : more}`);
const armyPiece = (x: number, y: number, f: Faction, n: number | "?") =>
  `<g class="piece ${f}${n === "?" ? " unknown" : ""}"><title>${many(n, "army", "armies")}</title><circle cx="${x}" cy="${y}" r="2.2"/>${n === "?" ? glyph("circle-help", x - 1.5, y - 1.5, 3) : `<text x="${x}" y="${y + 0.95}">${n}</text>`}</g>`;
const fleetPiece = (x: number, y: number, f: Faction, n: number | "?") =>
  `<g class="piece fleet ${f}${n === "?" ? " unknown" : ""}"><title>${many(n, "ship", "ships")}</title><path d="M${x - 2.6} ${y + 1.6}L${x} ${y - 2.2}L${x + 2.6} ${y + 1.6}L${x} ${y + 0.6}Z"/>${n === "?" ? glyph("circle-help", x - 1.1, y - 4.8, 2.2) : `<text x="${x}" y="${y - 2.8}">${n}</text>`}</g>`;
// The lucide "swords" icon, centred on x, y.
const swords = (x: number, y: number) => `<g class="hero-mark" transform="translate(${x - 2.4} ${y - 2.4}) scale(0.2)"><title>Hero battle</title><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/></g>`;
// A lucide icon at x, y (its top left), size units across.
const glyph = (name: string, x: number, y: number, size: number) => `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(size / 24).toFixed(4)})">${icon(name, 24)}</g>`;
// A place's state as a disc by the name plaque: a shield where the enemy holds it, crossed swords
// where there's a fight this turn, nothing where it's open.
const STATE_TIPS: Record<PlaceState, string> = { open: "", held: "Held by the enemy: moving in is an attack", contested: "Contested: a battle here this turn" };
const stateBadge = (x: number, y: number, st: PlaceState) => st === "open" ? "" :
  `<g class="state-mark ${st}"><title>${STATE_TIPS[st]}</title><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.9"/>${glyph(STATE_ICONS[st], x - 1.25, y - 1.25, 2.5)}</g>`;
// The strip under the map that says what the badges mean.
export const mapLegend = () => (["open", "held", "contested"] as const).map((st) =>
  `<span class="key"><span class="state ${st}">${icon(STATE_ICONS[st], 13)}${STATE_NAMES[st]}</span><small>${{ open: "nobody of theirs: a move", held: "theirs: moving in attacks", contested: "both sides: a battle this turn" }[st]}</small></span>`).join("");

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

// Nebulae: soft clouds of colour behind everything, the same every draw.
function nebulae(width: number) {
  let s = 11, out = "";
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const hues = ["#5b2b8c", "#2a4f8f", "#7a2d5c", "#1f6a78", "#43307a"];
  for (let i = 0; i < Math.ceil(width / 14); i++) {
    out += `<ellipse cx="${(r() * width).toFixed(1)}" cy="${(r() * 100).toFixed(1)}" rx="${(10 + r() * 22).toFixed(1)}" ry="${(7 + r() * 16).toFixed(1)}" fill="${hues[Math.floor(r() * hues.length)]}" opacity="${(0.25 + r() * 0.3).toFixed(2)}"/>`;
  }
  return `<g class="nebulae" filter="url(#haze)">${out}</g>`;
}

// While the turn waits on retreats: the attacks declared, and this seat's answers to them.
export interface Declared { me: Faction; attacks: Attack[]; retreats: Retreat[] }

export function drawMap(c: Campaign, orders: Order[], selected: string | null, hero: { system: string } | undefined, declared?: Declared) {
  const g = galaxyOf(c), systemDef = g.system, W = g.width;
  const regionIx = new Map(g.regions.map((r, i) => [r.id, i]));
  const cells = territories(g.systems.map((d) => [d.x, d.y]), W);
  const ownerOf = (id: string) => (holds(c.systems[id]!, "marines") ? "marines" : holds(c.systems[id]!, "wooka") ? "wooka" : null);
  const near = new Set(selected ? g.neighbours(selected) : []);
  const me = declared?.me ?? c.player, states = placeStates(c, me, orders, declared?.attacks ?? []);
  const badgeOf = (id: string) => systemState(states[id]!);

  const lands = g.systems.map((d, i) => {
    const s = c.systems[d.id]!, f = ownerOf(d.id), blockaded = f && s.orbit === enemy(f);
    return `<path d="${pathOf(cells[i]!)}" class="land ${f ?? ""}${near.has(d.id) ? " reach" : ""}" data-system="${d.id}"/>${blockaded ? `<path d="${pathOf(cells[i]!)}" class="blockade"><title>${d.name} is blockaded</title></path>` : ""}${badgeOf(d.id) === "contested" ? `<path d="${pathOf(cells[i]!)}" class="contest-fill"><title>${d.name}: contested, a battle this turn</title></path>` : ""}`;
  }).join("");
  // Each side's border: its cells' edges that face the other side or open space, drawn clipped to
  // the cell so the two sides' borders sit side by side instead of on top of each other.
  const clips = cells.map((poly, i) => `<clipPath id="cell-${i}"><path d="${pathOf(poly)}"/></clipPath>`).join("");
  const edgeLine = (poly: Poly, k: number) => {
    const p = poly[k]!.p, q = poly[(k + 1) % poly.length]!.p;
    return `M${p[0].toFixed(2)} ${p[1].toFixed(2)}L${q[0].toFixed(2)} ${q[1].toFixed(2)}`;
  };
  const frontiers = g.systems.map((d, i) => {
    const f = ownerOf(d.id), poly = cells[i]!;
    if (!f) return "";
    const path = poly.map((v, k) => (v.tag >= 0 && ownerOf(g.systems[v.tag]!.id) === f ? "" : edgeLine(poly, k))).join("");
    return path ? `<g clip-path="url(#cell-${i})"><path d="${path}" class="glow" stroke="${TINT[f]}"/><path d="${path}" class="edge" stroke="${TINT[f]}"/></g>` : "";
  }).join("");
  // Region borders: faint dashes along the cell edges between two regions.
  const borders = g.systems.map((d, i) => {
    const poly = cells[i]!, ri = regionIx.get(d.region)!;
    const path = poly.map((v, k) => (v.tag >= 0 && g.systems[v.tag]!.region !== d.region && v.tag > i ? edgeLine(poly, k) : "")).join("");
    return path ? `<path d="${path}" stroke="${REGION_COLORS[ri % REGION_COLORS.length]}"/>` : "";
  }).join("");
  const regions = g.regions.map((r) => {
    const [x, y] = r.label, holder = regionHolder(c, r.id), up = y < 50 ? 1 : -1;
    const cover = regionCover(c, r.id), dug = (c.dugIn ?? []).some((d) => d.faction === cover && d.region === r.id);
    const shield = cover ? `<g class="cover ${cover}"><title>${r.name}: ${cover === "marines" ? "Thunder Marines" : "Wooka"} fight with cover here${dug ? " (dug in this turn)" : ", holding most of it"}</title><circle cx="${x - r.name.length * 0.95 - 3}" cy="${y - 0.4 + up * 0.6}" r="1.7"/><text x="${x - r.name.length * 0.95 - 3}" y="${y + 0.5 + up * 0.6}">+1</text></g>` : "";
    return `<g class="region-tag"><text x="${x}" y="${y + up * 0.6}" class="region">${r.name}</text>${shield}${badge(x + r.name.length * 0.95 + 4, y - 0.4 + up * 0.6, r.bonus, holder, r.name)}</g>`;
  }).join("");

  const lanes = g.lanes.map(([a, b]) => {
    const p = systemDef(a), q = systemDef(b), fa = ownerOf(a), fb = ownerOf(b);
    return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" class="lane${fa && fb && fa !== fb ? " front" : ""}"/>`;
  }).join("");

  // Orders as curved arrows, armies bowing one way and fleets the other, the count on the bend.
  const moves = orders.flatMap((o) => {
    if (o.kind === "build" || o.kind === "card" || o.kind === "bombard") return [];
    const from = systemDef(o.kind === "fleet" ? o.from : o.from.system), to = systemDef(o.kind === "fleet" ? o.to : o.to.system);
    if (from.id === to.id) return [`<circle cx="${from.x}" cy="${from.y}" r="${R + 3}" class="move army"/>`];
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy), k = (R + 2.5) / len, bow = (o.kind === "army" ? 1 : -1) * len * 0.18;
    const nx = -dy / len, ny = dx / len, mx = (from.x + to.x) / 2 + nx * bow, my = (from.y + to.y) / 2 + ny * bow;
    const sx = from.x + dx * k, sy = from.y + dy * k, ex = to.x - dx * k, ey = to.y - dy * k;
    // The count sits on the curve's midpoint, halfway to the control point.
    const lx = (sx + ex) / 4 + mx / 2, ly = (sy + ey) / 4 + my / 2;
    // An attack (into the enemy's ground, or a sky over it): crossed swords beside the count;
    // a move into an open place, an arrow.
    const attack = attacking(c, me, o);
    return [`<g class="move-g ${o.kind}${attack ? " attack" : ""}"><path d="M${sx} ${sy}Q${mx} ${my} ${ex} ${ey}" class="move ${o.kind}" marker-end="url(#arrow-${o.kind})"/>
      <circle cx="${lx}" cy="${ly}" r="1.8" class="move-n"/><text x="${lx}" y="${ly + 0.8}" class="move-t">${o.count}</text>${attack ? `<g class="move-attack"><title>An attack</title>${glyph("swords", lx + 1.6, ly - 3.4, 2.4)}</g>` : `<g class="move-open"><title>A move: nobody of theirs there</title>${glyph("arrow-right", lx + 1.6, ly - 3.4, 2.4)}</g>`}</g>`];
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
    // A dot per sector under the star, in its holder's colour.
    const dots = s.sectors.map((x, i) => `<circle cx="${(d.x + (i - (n - 1) / 2) * 1.5).toFixed(2)}" cy="${d.y + R + 1.1}" r="0.55" fill="${hex(x.owner)}" class="sector-dot"><title>${x.kind}: ${x.owner}</title></circle>`).join("");
    const plaque = d.name.length * 1.45 + 2.4, py = d.y + R + 2.3, holder = ownerOf(d.id);
    const armies = s.sectors.reduce((a, x) => ({ marines: a.marines + x.armies.marines, wooka: a.wooka + x.armies.wooka }), { marines: 0, wooka: 0 });
    // The player's pieces on the left, the other side's on the right.
    const side = (f: Faction) => (f === c.player ? -1 : 1);
    // In the fog, the enemy's ground and orbit show a piece with no number on it.
    const foggy = (f: Faction) => s.fog && f !== declared?.me;
    const nArmies = (f: Faction) => (foggy(f) ? (s.sectors.some((x) => x.owner === f) ? "?" : 0) : armies[f]);
    const nFleets = (f: Faction) => (foggy(f) ? (s.orbit === f ? "?" : 0) : s.fleets[f]);
    const pieces = (["marines", "wooka"] as const).map((f) => {
      const a = nArmies(f), n = nFleets(f);
      return (a ? armyPiece(d.x + side(f) * 5.4, d.y - 0.4, f, a) : "") + (n ? fleetPiece(d.x + side(f) * 3.6, d.y - 5.4, f, n) : "");
    }).join("");
    const st = badgeOf(d.id);
    return `<g class="system${selected === d.id ? " selected" : ""}${st === "open" ? "" : ` ${st}`}${near.has(d.id) ? " reach" : ""}" data-system="${d.id}" tabindex="0" role="button" aria-label="${d.name}">
      <circle cx="${d.x}" cy="${d.y}" r="${R}" class="orbit" stroke="${s.orbit ? hex(s.orbit) : "#6b7280"}" ${s.orbit ? "" : 'stroke-dasharray="1 1"'}><title>Orbit: ${s.orbit ?? "nobody"}</title></circle>
      ${st === "contested" ? `<circle cx="${d.x}" cy="${d.y}" r="4.6" class="pulse"/>` : ""}
      <circle cx="${d.x}" cy="${d.y}" r="2.4" fill="url(#star-glow)" class="halo"/>
      <circle cx="${d.x}" cy="${d.y}" r="0.95" fill="${STAR_COLORS[hash(d.id) % STAR_COLORS.length]}" class="star"/>
      ${dots}
      <rect x="${(d.x - plaque / 2).toFixed(2)}" y="${py}" width="${plaque.toFixed(2)}" height="3.1" rx="0.4" class="plaque" ${holder ? `stroke="${TINT[holder]}"` : ""}/>
      <text x="${d.x}" y="${py + 2.2}" class="name">${d.name}</text>
      ${stateBadge(d.x - plaque / 2 - 1.3, py + 1.55, st)}
      ${hero?.system === d.id ? swords(d.x, d.y - 5.2) : ""}
      ${pieces}
    </g>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} 100" class="galaxy" role="img" aria-label="The galaxy map">
    <defs>
      <filter id="haze" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.6"/></filter>
      <radialGradient id="star-glow"><stop offset="0%" stop-color="#fff" stop-opacity="0.9"/><stop offset="35%" stop-color="#cfe2ff" stop-opacity="0.35"/><stop offset="100%" stop-color="#cfe2ff" stop-opacity="0"/></radialGradient>
      ${clips}<clipPath id="board-clip"><rect width="${W}" height="100"/></clipPath>
      <pattern id="contest" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.1" height="2.2" fill="${TINT.marines}"/><rect x="1.1" width="1.1" height="2.2" fill="${TINT.wooka}"/></pattern>
      <pattern id="hatch" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.6" class="hatch"/></pattern>
      <radialGradient id="vignette" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.65"/></radialGradient>
      <marker id="arrow-army" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L6 3L0 6z" class="tip army"/></marker>
      <marker id="arrow-attack" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.5" markerHeight="3.5" orient="auto"><path d="M0 0L6 3L0 6z" class="tip attack"/></marker>
      <marker id="arrow-fleet" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L6 3L0 6z" class="tip fleet"/></marker>
    </defs>
    <rect width="${W}" height="100" class="board"/><g clip-path="url(#board-clip)">${nebulae(W)}${stars(W)}</g>
    <g class="lands">${lands}</g><g class="frontiers">${frontiers}</g><g class="borders">${borders}</g>
    <rect width="${W}" height="100" fill="url(#vignette)" pointer-events="none"/>
    ${lanes}${regions}${moves}${attacks}${systems}</svg>`;
}
