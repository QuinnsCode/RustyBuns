// The Eldritch Compendium's pages (the journal you open with Tab): a two-page spread, and the bestiary's entries.
// A cryptid you have never met is a drifting cloud of ink-smoke and three question marks: no name, no picture, no
// hint. One you have met but not bound is a blurred glimpse through that smoke, with its name. Bound, its plate is
// inked clear onto the page. The look is src/tome.css; which creature is which is decided by main.ts.
import { esc } from "@rustybuns/util";
import { ART, tradingCard } from "./card.ts";
import type { Creature } from "./roster.ts";

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
