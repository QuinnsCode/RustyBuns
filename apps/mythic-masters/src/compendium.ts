// The Eldritch Compendium's pages (the journal you open with Tab): a two-page spread, and the bestiary's entries.
// A cryptid you have never met is a drifting cloud of ink-smoke and three question marks: no name, no picture, no
// hint. One you have met but not bound is a blurred glimpse through that smoke, with its name. Bound, its plate is
// inked clear onto the page. An entry opens its folio: the beast's own page of the book (`folio`), its plate large
// at the top left, the name beside it with its other names under it, its background in the middle and, along the
// bottom, the ledger of when and where the ink held, what it was then against now, and its moves. A d-pad or the
// arrow keys walk a quill over the entries (`stepTo`). The look is src/tome.css; which creature is which is decided
// by main.ts.
import { esc } from "@rustybuns/util";
import { ART, radar, tradingCard } from "./card.ts";
import { caseNo } from "./casefile.ts";
import { hex } from "./fields.ts";
import { icon } from "./icons.ts";
import { frame, GUESSES, marginalia, rumour, struck } from "./ornaments.ts";
import { moveLine, shapeSvg } from "./moveline.ts";
import { atLevel, sections, TRAIL_REGIONS, type Member } from "./journey.ts";
import { TALE } from "./creatures.ts";
import { REGIONS } from "./regions.ts";
import type { Creature, Stats } from "./roster.ts";

export type Known = "bound" | "seen" | "unknown";

/** A left and a right page; a narrow screen stacks them. */
export const spread = (verso: string, recto: string) => `<div class="page verso">${verso}</div><div class="page recto">${recto}</div>`;

/** Splits `items` in two at the middle of their `weight`s, for the left and right pages. */
export function halves<T>(items: readonly T[], weight: (t: T) => number = () => 1): [T[], T[]] {
  const total = items.reduce((n, t) => n + weight(t), 0);
  let run = 0, at = items.length;
  for (let i = 0; i < items.length; i++) { if (run >= total / 2) { at = i; break; } run += weight(items[i]!); }
  return [items.slice(0, at), items.slice(at)];
}

/** The same small number for the same creature, so each cloud drifts on its own beat but never jumps on a redraw. */
const beat = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7);

const haze = (id: string) => { const b = beat(id); return `<span class="haze" style="--d:${-(b % 9)}s;--r:${(b % 40) - 20}deg"><i></i><i></i><i></i></span>`; };

/** One bestiary entry. `dots` is its field dots, `tier` its rarity; neither is shown until it's bound. */
export function entry(c: Creature, known: Known, tier: string, dots: string, shadowed = false): string {
  if (known === "unknown") {
    const hint = shadowed ? ` title="Seen in the shadows: bind it to learn what it is"` : "";
    return `<figure class="entry unknown"${hint}><span class="plate" style="--tilt:${(beat(c.id) % 30) - 15}deg;--mx:${(beat(c.id) % 17) - 8}%;--my:${((beat(c.id) >> 2) % 15) - 7}%;--ms:${42 + (beat(c.id) % 5) * 6}%">${haze(c.id)}${rumour(beat(c.id))}</span><figcaption class="guess" style="--slant:${((beat(c.id) >> 1) % 7) - 3}deg">${GUESSES[(beat(c.id) * 7 + c.id.length) % GUESSES.length]}</figcaption></figure>`;
  }
  const art = ART[c.id], pic = art?.bw ?? art?.color;
  const img = pic ? `<img src="/${esc(pic.src)}" alt="" loading="lazy" decoding="async"/>` : `<b class="initial">${esc(c.name[0] ?? "?")}</b>`;
  if (known === "seen") {
    return `<figure class="entry seen t-${tier}" data-id="${esc(c.id)}" title="${esc(tier)} · seen, not bound"><span class="plate">${img}${haze(c.id)}</span><figcaption>${esc(c.name)}</figcaption><small>glimpsed</small></figure>`;
  }
  return `<figure class="entry bound t-${tier}" data-id="${esc(c.id)}" title="${esc(tier)} · ${esc(c.archetype)} · ${c.fields.join(" / ")}"><span class="plate">${img}</span><figcaption>${esc(c.name)}</figcaption><small>${dots}${esc(tier)} · ${esc(c.archetype)}</small></figure>`;
}

/** The card a bestiary entry opens: the full trading card for a bound creature, a black silhouette for one only seen,
 * nothing for an unknown (its page stays smoke). */
export function cardOf(c: Creature, known: Known): string {
  if (known === "unknown") return "";
  if (known === "bound") return tradingCard(c);
  const art = ART[c.id], pic = art?.bw ?? art?.color;
  const img = pic ? `<img src="/${esc(pic.src)}" alt="" decoding="async"/>` : `<b class="initial">${esc(c.name[0] ?? "?")}</b>`;
  return `<article class="tcard sil" data-id="${esc(c.id)}"><header><b>${esc(c.name)}</b></header><div class="art"><figure class="pic">${img}</figure></div><p class="meta">Glimpsed in the shadows. Bind it to read its card.</p></article>`;
}

// --- the folio: one beast's whole page ------------------------------------------------------------------------------
export interface FolioOpts {
  tier: string;
  /** The bound one, with its ledger; null for one only seen. */
  member: Member | null;
  /** Its number in the book's ledger (bound ones, in the order they were taken), and where it rests now. */
  item: number; rests: string;
  /** The clock, for how long the ink has been drying. */
  now?: number;
  /** The leaf's number in the book (its place in the roster), written in the corner. */
  fol?: number;
}

/** Where a beast roams: every trail section it is a wild one or the keeper of, by region. */
export const hauntsOf = (id: string) =>
  TRAIL_REGIONS.map((g) => ({ region: g.name, places: sections(g).filter((s) => s.wilds.includes(id) || s.keeper === id).map((s) => s.name) })).filter((h) => h.places.length);

const AXES: (keyof Stats)[] = ["vigor", "might", "guard", "focus", "will", "speed"];
const when = (at: number) => {
  const d = new Date(at);
  return `on ${d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}, at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
/** A level as the book writes it: "fifth", and past the twentieth, "21st". */
export const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}${[11, 12, 13].includes(n % 100) ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
const dot = (f: string) => `<i class="dot" style="background:${hex(f as Creature["fields"][number])}"></i>`;

/** The Book's line in the margin of a folio (docs/MARGIN-NOTES.md): a bound one has its item number, and wet ink if
 * it is fresh; one only seen is not in the ledger at all. */
export function marginOf(known: Known, item: number, dryingMs: number): string {
  if (known === "bound") return `Item ${item}. Entered.${dryingMs < 3_600_000 ? " The ink is still wet." : ""}`;
  return "Seen. Not entered. Looking is not collecting.";
}

/** The plate on a fight's result note (#3604 round 13): the beast it is about, inked as on its folio. A bind draws the
 * one just bound inside the thorn ring; a loss draws the fighter that fell, faded and struck through. */
export function notePlate(c: Creature, fell: boolean): string {
  const art = ART[c.id], pic = art?.bw ?? art?.color;
  const img = pic ? `<img src="/${esc(pic.src)}" alt="" decoding="async"/>` : `<b class="initial">${esc(c.name[0] ?? "?")}</b>`;
  return `<figure class="plate note-plate${fell ? " fell" : ""}" aria-hidden="true">${img}${fell ? struck() : frame()}</figure>`;
}

/** A beast's own page: the plate big at the top left and the name beside it, its other names in brackets under that,
 * then its fields; the middle is its background; the bottom row is the ledger (when and where it was bound, the
 * level and stats then against now) and its moves. One only seen gets the plate under smoke, the name, and the rest
 * smudged: bind it and the ink settles. An unknown has no page (empty). */
export function folio(c: Creature, known: Known, o: FolioOpts): string {
  if (known === "unknown") return "";
  const art = ART[c.id], pic = art?.bw ?? art?.color, region = REGIONS[c.region - 1];
  const img = pic ? `<img src="/${esc(pic.src)}" alt="${esc(c.name)}" decoding="async"/>` : `<b class="initial">${esc(c.name[0] ?? "?")}</b>`;
  const seen = known === "seen", now = o.now ?? Date.now();
  const aka = c.aka.length ? `(${c.aka.map(esc).join(", ")})` : "(no other name on record)";
  const kinds = c.fields.map((f) => `<span class="kind">${dot(f)}${esc(f)}</span>`).join("")
    + (seen ? `<span class="kind glimpsed">glimpsed</span>` : `<span class="kind">${esc(c.archetype)}</span><span class="kind">${esc(o.tier)}</span>`)
    + (region ? `<span class="kind">${esc(region.name)}</span>` : "");
  const haunts = hauntsOf(c.id).map((h) => `${h.places.join(", ")} (${esc(h.region)})`).join("; ");
  const legend = region?.lore?.legend ?? `${c.name} is told of in ${region?.name ?? "a far country"}; the book has not copied the tale yet.`;
  // the page is the beast's: its own line is the Background, under the illuminated initial; its region's tale (which
  // the Regions chapter prints, and every beast of the region shares) is only named, in the source line
  const own = TALE[c.id];
  const told = region?.lore ? ` <span class="src">Told in ${esc(region.name)}: ${esc(region.lore.from)}</span>` : "";
  const ground = `<h3>Background</h3><p class="legend${seen ? " smudged" : ""}">${esc(own ?? legend)}</p>`
    + `<p class="body">Stands ${c.heightM} m and weighs ${c.massKg} kg.${haunts ? ` Haunts ${esc(haunts)}.` : ""}${told}</p>`;
  let ledger: string, kit: string;
  if (seen || !o.member) {
    ledger = `<div class="caught inks"><h3>Bound</h3><p class="dim">Not yet. The page is waiting for the ink.</p></div><div class="growth inks"><h3>Then and now</h3><p class="dim smudged">vigor · might · guard · focus · will · speed</p></div>`;
    kit = `<div class="kit inks"><h3>Moves</h3><ol class="moves smudged">${c.moves.map((mv) => `<li><b>${esc(mv.name)}</b></li>`).join("")}</ol><p class="dim">Bind it and the ink settles.</p></div>`;
  } else {
    const m = o.member, then = m.caught ? atLevel(c, m.caught.level).stats : null, nowStats = atLevel(c, m.level).stats;
    // written as the scribe would enter it (#3671 round 82), not a form's fields: when and where the ink held, at what
    // level then and now, where it rests; its stats a line of prose under the radar, the old figure struck through
    const told = m.caught
      ? `Bound ${esc(when(m.caught.at))}: the ink held at ${esc(m.caught.where || "a place the book did not write down")}, at the ${ordinal(m.caught.level)} level${m.level > m.caught.level ? `; it has come to the ${ordinal(m.level)} since` : ", where it still stands"}. It rests ${esc(o.rests)}.`
      : `Bound before the book kept dates; it stands at the ${ordinal(m.level)} level, and rests ${esc(o.rests)}.`;
    ledger = `<div class="caught inks"><h3>Bound</h3><p class="told">${told}</p></div>`
      + `<div class="growth inks"><h3>Then and now</h3>${radar({ ...c, stats: nowStats }, true, then ?? undefined)}<p class="then-now">${AXES.map((a) => {
        const was = then?.[a] ?? nowStats[a], gain = nowStats[a] - was;
        return `<span>${a} ${gain > 0 ? `<s>${was}</s> ` : ""}<b>${nowStats[a]}</b>${gain > 0 ? ` <i class="gain">+${gain}</i>` : ""}</span>`;
      }).join(", ")}.</p></div>`;
    // the moves as a contents list: the name in the hand, a dotted leader, its slot and field; under it the card's line
    // (ATTACKS.md "The beast card"): its shape drawn and its numbers, tempo, damage range and cost
    kit = `<div class="kit inks"><h3>Moves</h3><ol class="moves">${c.moves.map((mv) =>
      `<li>${dot(mv.field)}<b>${esc(mv.name)}${mv.slot === "ultimate" ? icon("star") : ""}</b><small>${mv.slot} · ${mv.field}</small><span class="line">${shapeSvg(mv.delivery)}${esc(moveLine(mv))}</span></li>`).join("")}</ol></div>`;
  }
  const drying = o.member?.caught ? now - o.member.caught.at : Infinity;
  return `<article class="folio ${known}" data-id="${esc(c.id)}" data-fol="${o.fol ?? ""}">
    <nav class="folio-nav"><button data-go="back" title="Back to the bestiary (Esc)">${icon("undo-2")} Bestiary</button><span class="no">No. ${caseNo(c.id)}</span>
      <span class="flip"><button data-go="prev" title="The page before" aria-label="The page before">${icon("chevrons-up")}</button><button data-go="next" title="The page after" aria-label="The page after">${icon("chevrons-down")}</button></span></nav>
    <aside class="marginalia" aria-hidden="true">${marginalia(c.fields)}</aside>
    <header class="folio-head"><figure class="plate big">${img}${seen ? haze(c.id) : frame()}</figure>
      <div class="naming inks"><h1>${esc(c.name)}</h1><p class="aka">${aka}</p><p class="kinds">${kinds}</p></div></header>
    <section class="ground inks">${ground}</section>
    <section class="ledger">${ledger}${kit}</section>
    <p class="demand margin"><span class="ask">${esc(marginOf(known, o.item, drying))}</span></p>
  </article>`;
}

// --- a d-pad over the page ----------------------------------------------------------------------------------------
export interface Spot { id: string; x: number; y: number }
export type Dir = "up" | "down" | "left" | "right";

/** The spot a d-pad step `dir` from `from` lands on (null at the edge): the closest one mostly that way, drift to the
 * side costing double, so a column stays a column across the spine. With no `from`, the first. */
export function stepTo(spots: readonly Spot[], from: string | null, dir: Dir): string | null {
  const o = spots.find((s) => s.id === from);
  if (!o) return spots[0]?.id ?? null;
  const [ax, ay] = dir === "up" ? [0, -1] : dir === "down" ? [0, 1] : dir === "left" ? [-1, 0] : [1, 0];
  let best: Spot | null = null, score = Infinity;
  for (const s of spots) {
    if (s === o) continue;
    const dx = s.x - o.x, dy = s.y - o.y, along = dx * ax + dy * ay, side = Math.abs(dx * ay) + Math.abs(dy * ax);
    if (along < 4) continue;
    const d = along + side * 2;
    if (d < score) { score = d; best = s; }
  }
  return best?.id ?? null;
}

/** The id before or after `id` in `ids` (the known entries in the book's order), wrapping round. */
export function neighbour(ids: readonly string[], id: string, step: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = ids.indexOf(id);
  return ids[(i < 0 ? 0 : i + step + ids.length) % ids.length] ?? null;
}

/** The chart's frame (#3604 round 29): longitude -125..-67 and latitude 49..25 laid onto a 230 x 112 sheet, the
 * Atlantic to the right left open for labels. */
const geo = (lon: number, lat: number): [number, number] => [10 + (lon + 125) * 3.1, 8 + (49 - lat) * 3.75];
/** Each trail region: where it lies, its short name, and where the scribe wrote that name (anchor, dx, dy). */
const CHART: Record<number, { at: [number, number]; name: string; label: ["start" | "end", number, number] }> = {
  1: { at: geo(-74.6, 39.8), name: "Pine Barrens", label: ["start", 6, 4] },
  2: { at: geo(-80.5, 38.5), name: "Appalachian hollows", label: ["end", -6, 7] },
  3: { at: geo(-89.5, 45.6), name: "Great North Woods", label: ["end", -4, 10] },
  4: { at: geo(-122, 47), name: "Pacific Northwest", label: ["start", 6, 5] },
  5: { at: geo(-80, 43.6), name: "Great Lakes", label: ["start", 6, -4] },
  6: { at: geo(-111, 34), name: "Southwest desert", label: ["start", 6, 4] },
  7: { at: geo(-91, 30), name: "Bayou", label: ["start", 6, 8] },
  8: { at: geo(-93, 36), name: "Ozarks", label: ["end", -6, 4] },
};
/** The coast of the lower forty-eight as a traveller would sketch it: west coast, the border, the Gulf and Florida,
 * the Atlantic up to Maine, and the northern line back across the lakes. */
const COAST = ([[-124.7, 48.4], [-124, 46], [-124.2, 42], [-122.4, 37.8], [-120.6, 34.5], [-117.1, 32.5], [-111, 31.3], [-108, 31.3], [-106.5, 31.8],
  [-103, 29], [-99.5, 26.5], [-97.2, 26], [-97.4, 27.8], [-94.5, 29.5], [-90, 29.1], [-89, 30.3], [-85, 29.7], [-83, 29], [-82.6, 27.5], [-81, 25.2],
  [-80.1, 26], [-80.6, 28.5], [-81.4, 30.7], [-79, 33], [-75.5, 35.3], [-76, 37], [-74.5, 39.5], [-74, 40.6], [-70.6, 41.6], [-70, 42], [-70.6, 43],
  [-67, 44.8], [-67.8, 47.1], [-69.2, 47.4], [-71.5, 45], [-74.8, 45], [-76.5, 43.6], [-79, 43.3], [-83, 42], [-82.4, 43], [-82.5, 45.3], [-84.5, 46.5],
  [-89, 48], [-95, 49], [-123, 49]] as [number, number][]).map(([lo, la], i) => `${i ? "L" : "M"}${geo(lo, la).map((v) => v.toFixed(1)).join(" ")}`).join("") + "z";

let chartN = 0; // each chart's fog gets its own ids (a page can draw two: one leaf and two)
/** The terrain as a traveller sketches it (#3604 round 66): little hachured peaks down the Rockies and the
 * Appalachians, tree marks in the north woods and the Pacific forests, a few wave strokes off both coasts. */
const TERRAIN = (() => {
  const peak = ([lo, la]: [number, number], s = 1) => { const [x, y] = geo(lo, la); return `M${(x - 2.6 * s).toFixed(1)} ${(y + 1.8 * s).toFixed(1)}l${(2.6 * s).toFixed(1)} ${(-3.6 * s).toFixed(1)}l${(2.6 * s).toFixed(1)} ${(3.6 * s).toFixed(1)}M${x.toFixed(1)} ${(y - 1.8 * s).toFixed(1)}l${(1.3 * s).toFixed(1)} ${(3 * s).toFixed(1)}`; };
  const tree = ([lo, la]: [number, number]) => { const [x, y] = geo(lo, la); return `M${x.toFixed(1)} ${(y + 2).toFixed(1)}v-1.2M${(x - 1.4).toFixed(1)} ${(y + 0.8).toFixed(1)}l1.4 -2.8l1.4 2.8z`; };
  const wave = ([lo, la]: [number, number]) => { const [x, y] = geo(lo, la); return `M${(x - 3).toFixed(1)} ${y.toFixed(1)}q1.5 -1.4 3 0t3 0`; };
  const rockies: [number, number][] = [[-114, 47], [-111.5, 45], [-110, 43], [-107.5, 41], [-106, 39], [-106.5, 36.5], [-108.5, 34]];
  const apps: [number, number][] = [[-84, 35.2], [-82, 36.8], [-79.8, 38.6], [-77.6, 40.4]];
  const woods: [number, number][] = [[-91.5, 46.8], [-88, 46.5], [-123.2, 44.5], [-121.5, 45.8], [-70.5, 45.5], [-86, 44.5]];
  const sea: [number, number][] = [[-128, 40], [-127, 35], [-71, 37], [-69, 40], [-86, 27], [-93, 27.4]];
  return `<path d="${rockies.map((p) => peak(p, 1.15)).join("")}${apps.map((p) => peak(p, 0.8)).join("")}" class="peaks"/>`
    + `<path d="${woods.map(tree).join("")}" class="trees"/><path d="${sea.map(wave).join("")}" class="waves"/>`;
})();

/** The Regions chapter's chart: the coast, a dotted route from the first region to the last, and each region a ring
 * at its place, inked solid once walked (with how many of its pages are written), faint and dashed while it is
 * still unknown country. Inline SVG, a few kilobytes. */
export function regionChart(regions: readonly { n: number; done: number; walked: boolean }[], of: number): string {
  const place = (n: number) => CHART[n] ?? { at: [115, 56] as [number, number], name: "", label: ["start", 6, 4] as ["start", number, number] };
  const route = regions.map((g, i) => `${i ? "L" : "M"}${place(g.n).at.map((v) => v.toFixed(1)).join(" ")}`).join("");
  const marks = regions.map((g) => {
    const { at: [x, y], name, label: [anchor, dx, dy] } = place(g.n);
    const text = `<text x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}" class="${g.walked ? "" : "faint"}">${g.n}. ${esc(name)}${g.walked ? ` · ${g.done}/${of}` : ""}</text>`;
    // the map is enchanted: a walked region's ring breathes, an unknown one sits under a drifting veil of mist
    return (g.walked ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" class="glow"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" class="walked"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.3" class="dot"/>`
      : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" class="mist" style="animation-delay:${-(g.n * 1.7).toFixed(1)}s"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" class="unwalked"/>`) + text;
  }).join("");
  // unknown country is fogged: a hatch over the land, cleared in a ring round every region you have walked
  const id = `mm-fog-${++chartN}`;
  const clear = regions.filter((g) => g.walked).map((g) => { const [x, y] = place(g.n).at; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="20" fill="url(#${id}-r)"/>`; }).join("");
  const fog = `<defs><pattern id="${id}-p" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0v3" stroke="#5e4630" stroke-width="0.6" opacity="0.32"/></pattern>`
    + `<radialGradient id="${id}-r"><stop offset="0.55" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`
    + `<mask id="${id}-m"><rect width="230" height="112" fill="#fff"/>${clear}</mask></defs><path d="${COAST}" fill="url(#${id}-p)" mask="url(#${id}-m)" class="fog"/>`;
  return `<figure class="chart" aria-label="A chart of the trail"><svg viewBox="0 0 230 112" role="img"><path d="${COAST}" class="coast"/><path d="${COAST}" class="coast-hatch"/>${fog}${TERRAIN}`
    + `<path d="${route}" class="route"/>${marks}<text x="205" y="88" text-anchor="middle" class="motto">here be</text><text x="205" y="95" text-anchor="middle" class="motto">what the Book wants</text></svg></figure>`;
}
