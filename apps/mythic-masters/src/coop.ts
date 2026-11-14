// A den's co-op fight (#4413), as each friend's own journey keeps it. Walking together, one of you walks into a wild
// den or a keeper and a friend in the region joins (versus.ts `DenAt`); the fight plays in a co-op room, and when it is
// over every page writes what it gave back into its own save: the creature seen, the XP for the one it sent in, the
// health that one has left, and a keeper's section cleared (only the next one of your own trail: nobody skips ahead
// on a friend's walk).
//
// Binding it (#4430): a press of bind is a bit in that tick's input (net/duel.ts `pressedBind`), so every page hears
// it on the same tick and rolls the same dice for it, seeded by the room's seed and the tick. The lowest seat that
// pressed tries first; the first whose ink holds binds it, into their own journey, and the rest read who did.
import { mulberry32 } from "@rustybuns/util";
import { bind, bindChance, clearSection, cleared, gainXp, see, sections, wound, type Journey, type Member } from "./journey.ts";
import type { Region } from "./regions.ts";
import { creature } from "./roster.ts";

/** Where a co-op fight came from: the region, a wild one's den or the keeper of section `k`, what lives there, and
 *  whether this page walked in (the host, whose fight report the Region believes). */
export interface CoopAt { region: Region; kind: "wild" | "keeper"; k: number; foe: { id: string; level: number }; host: boolean }

/** Who of `pressed` (seats that pressed bind on tick `tick`) binds the foe at `foeFrac` of its health, or null when the
 *  ink tore free for each of them. The same on every page: the dice are the room's `seed`, the tick and the seat. */
export function coopBind(pressed: readonly number[], foeFrac: number, seed: number, tick: number): number | null {
  const chance = bindChance(foeFrac, false);
  if (chance <= 0) return null;
  for (const s of [...pressed].sort((a, b) => a - b)) {
    if (mulberry32(seed ^ Math.imul(tick, 0x9e3779b1) ^ Math.imul(s + 1, 0x85ebca6b))() < chance) return s;
  }
  return null;
}

/** A co-op fight against `at.foe` ended: `me` fought for this page and has `hpLeft` (a fraction of full) to show for it.
 *  `bound` says who bound it, if someone did: this page (`mine`), or the friend named `who`. Writes it into `j`, and
 *  says what changed, a line each. */
export function recordCoop(j: Journey, me: Member, at: CoopAt, won: boolean, hpLeft: number, bound?: { mine: boolean; who: string }): string[] {
  const foe = creature(at.foe.id), mine = creature(me.id).name, lines: string[] = [];
  see(j, at.foe.id);
  wound(me, won ? hpLeft : 0);
  if (!won) return [`${foe.name} was too much for you both. ${mine} is knocked out until a campfire.`];
  if (bound?.mine) {
    const sec = sections(at.region)[at.k], where = sec ? `${sec.name}, ${at.region.name}` : at.region.name;
    lines.push(`The ink holds. ${foe.name} (Lv ${at.foe.level}) ${bind(j, at.foe.id, at.foe.level, where) === "party" ? "joins your line-up" : "rests in the Eldritch Compendium"}.`);
  } else if (bound) lines.push(`${bound.who} bound ${foe.name}. It goes home with them.`);
  const ups = gainXp(me, at.foe.level);
  lines.push(ups ? `${mine} grows to level ${me.level}.` : `${mine} learns from it.`);
  if (at.kind === "keeper") {
    const was = cleared(j, at.region.n);
    clearSection(j, at.region.n, at.k);
    if (cleared(j, at.region.n) > was) lines.push(`The keeper's stone is lit for you too: section ${at.k + 2} is open.`);
  }
  return lines;
}
