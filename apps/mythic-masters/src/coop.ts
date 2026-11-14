// A den's co-op fight (#4413), as each friend's own journey keeps it. Walking together, one of you walks into a wild
// den or a keeper and a friend in the region joins (versus.ts `DenAt`); the fight plays in a co-op room, and when it is
// over every page writes what it gave back into its own save: the creature seen, the XP for the one it sent in, the
// health that one has left, and a keeper's section cleared (only the next one of your own trail: nobody skips ahead
// on a friend's walk). Binding stays a fight of your own: the bind is a page's input the room doesn't carry yet.
import { clearSection, cleared, gainXp, see, wound, type Journey, type Member } from "./journey.ts";
import type { Region } from "./regions.ts";
import { creature } from "./roster.ts";

/** Where a co-op fight came from: the region, a wild one's den or the keeper of section `k`, what lives there, and
 *  whether this page walked in (the host, whose fight report the Region believes). */
export interface CoopAt { region: Region; kind: "wild" | "keeper"; k: number; foe: { id: string; level: number }; host: boolean }

/** A co-op fight against `at.foe` ended: `me` fought for this page and has `hpLeft` (a fraction of full) to show for it.
 *  Writes it into `j`, and says what changed, a line each. */
export function recordCoop(j: Journey, me: Member, at: CoopAt, won: boolean, hpLeft: number): string[] {
  const foe = creature(at.foe.id), mine = creature(me.id).name, lines: string[] = [];
  see(j, at.foe.id);
  wound(me, won ? hpLeft : 0);
  if (!won) return [`${foe.name} was too much for you both. ${mine} is knocked out until a campfire.`];
  const ups = gainXp(me, at.foe.level);
  lines.push(ups ? `${mine} grows to level ${me.level}.` : `${mine} learns from it.`);
  if (at.kind === "keeper") {
    const was = cleared(j, at.region.n);
    clearSection(j, at.region.n, at.k);
    if (cleared(j, at.region.n) > was) lines.push(`The keeper's stone is lit for you too: section ${at.k + 2} is open.`);
  }
  return lines;
}
