// The Eldritch Compendium's pages (the journal you open with Tab): a two-page spread, and the bestiary's entries.
// A cryptid you have never met is a drifting cloud of ink-smoke and three question marks: no name, no picture, no
// hint. One you have met but not bound is a blurred glimpse through that smoke, with its name. Bound, its plate is
// inked clear onto the page. An entry opens its folio: the beast's own page of the book (`folio`), its plate large
// at the top left, the name beside it with its other names under it, its background in the middle and, along the
// bottom, the ledger of when and where the ink held, what it was then against now, and its moves. A d-pad or the
// arrow keys walk a quill over the entries (`stepTo`). The look is src/tome.css; which creature is which is decided
// by main.ts.
import { esc } from "@rustybuns/util";
import { ART, hex, radar, tradingCard } from "./card.ts";
import { caseNo } from "./casefile.ts";
import { icon } from "./icons.ts";
import { atLevel, sections, TRAIL_REGIONS, type Member } from "./journey.ts";
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
    return `<figure class="entry unknown"${hint}><span class="plate">${haze(c.id)}<b class="qm">?</b></span><figcaption>???</figcaption></figure>`;
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
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};
const dot = (f: string) => `<i class="dot" style="background:${hex(f as Creature["fields"][number])}"></i>`;

/** The Book's line in the margin of a folio (docs/MARGIN-NOTES.md): a bound one has its item number, and wet ink if
 * it is fresh; one only seen is not in the ledger at all. */
export function marginOf(known: Known, item: number, dryingMs: number): string {
  if (known === "bound") return `Item ${item}. Entered.${dryingMs < 3_600_000 ? " The ink is still wet." : ""}`;
  return "Seen. Not entered. Looking is not collecting.";
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
  const ground = `<h3>Background</h3><p class="legend${seen ? " smudged" : ""}">${esc(legend)}</p>`
    + `<p class="body">Stands ${c.heightM} m and weighs ${c.massKg} kg.${haunts ? ` Haunts ${esc(haunts)}.` : ""}${region?.lore ? ` <span class="src">From ${esc(region.lore.from)}</span>` : ""}</p>`;
  let ledger: string, kit: string;
  if (seen || !o.member) {
    ledger = `<div class="caught inks"><h3>Bound</h3><p class="dim">Not yet. The page is waiting for the ink.</p></div><div class="growth inks"><h3>Then and now</h3><p class="dim smudged">vigor · might · guard · focus · will · speed</p></div>`;
    kit = `<div class="kit inks"><h3>Moves</h3><ol class="moves smudged">${c.moves.map((mv) => `<li><b>${esc(mv.name)}</b></li>`).join("")}</ol><p class="dim">Bind it and the ink settles.</p></div>`;
  } else {
    const m = o.member, then = m.caught ? atLevel(c, m.caught.level).stats : null, nowStats = atLevel(c, m.level).stats;
    const rows = m.caught
      ? `<dl><dt>Bound</dt><dd>${esc(when(m.caught.at))}</dd><dt>Where</dt><dd>${esc(m.caught.where || "somewhere the book did not write down")}</dd><dt>Level</dt><dd>${m.caught.level} then, ${m.level} now</dd><dt>Rests</dt><dd>${esc(o.rests)}</dd></dl>`
      : `<dl><dt>Bound</dt><dd>before the book kept dates</dd><dt>Level</dt><dd>${m.level} now</dd><dt>Rests</dt><dd>${esc(o.rests)}</dd></dl>`;
    ledger = `<div class="caught inks"><h3>Bound</h3>${rows}</div>`
      + `<div class="growth inks"><h3>Then and now</h3>${radar({ ...c, stats: nowStats }, true, then ?? undefined)}<table class="then-now"><thead><tr><th></th><th>${then ? "then" : ""}</th><th>now</th><th></th></tr></thead><tbody>${AXES.map((a) => {
        const was = then?.[a] ?? nowStats[a], gain = nowStats[a] - was;
        return `<tr><th>${a}</th><td>${then ? was : ""}</td><td>${nowStats[a]}</td><td class="gain">${gain > 0 ? `+${gain}` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>`;
    kit = `<div class="kit inks"><h3>Moves</h3><ol class="moves">${c.moves.map((mv) =>
      `<li>${dot(mv.field)}<b>${esc(mv.name)}</b><small>${mv.slot} · ${mv.field}${mv.ranged ? " · ranged" : ""} · ${mv.power}</small>${mv.slot === "ultimate" ? icon("star") : ""}</li>`).join("")}</ol></div>`;
  }
  const drying = o.member?.caught ? now - o.member.caught.at : Infinity;
  return `<article class="folio ${known}" data-id="${esc(c.id)}" data-fol="${o.fol ?? ""}">
    <nav class="folio-nav"><button data-go="back" title="Back to the bestiary (Esc)">${icon("undo-2")} Bestiary</button><span class="no">No. ${caseNo(c.id)}</span>
      <span class="flip"><button data-go="prev" title="The page before" aria-label="The page before">${icon("chevrons-up")}</button><button data-go="next" title="The page after" aria-label="The page after">${icon("chevrons-down")}</button></span></nav>
    <header class="folio-head"><figure class="plate big">${img}${seen ? haze(c.id) : ""}</figure>
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
