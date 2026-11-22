// The beats the game already plays, read from the game itself so the story bible can never drift from it: each
// region's mythic (main), each faction's eight quest stages (three sub arcs), each sighting board (side), and the
// roads and line-up slots that open as you go (unlock). content/story.json links to these by id.
import { mythicOf, PARTY_FIRST, PARTY_MAX, SECTIONS, sectionLevel, sections } from "../journey.ts";
import { REGIONS, type Region } from "../regions.ts";
import { creature } from "../roster.ts";
import { FACTION } from "../factions/engine.ts";
import { FACTIONS } from "../factions/model.ts";
import { HUNTS } from "../world/hunts.ts";
import { GATES, openRegions } from "../world/world.ts";
import type { Arc, Kind, Placed } from "./model.ts";

export const PLAYABLE: Region[] = REGIONS.filter((g) => g.tier === "playable");
export const regionOf = (n: number) => REGIONS.find((g) => g.n === n);

/** The order the roads open in: the lowest-numbered open region first, as levels.ts plays it; and for each region, the
 * region whose mythic opened its road (undefined for the first). */
export function roadOrder(): { n: number; from?: number }[] {
  const beaten = new Set<number>(), order: { n: number; from?: number }[] = [];
  const playable = new Set(PLAYABLE.map((g) => g.n));
  let open = new Set([1]);
  while (order.length < playable.size) {
    const next = [...open].filter((n) => playable.has(n) && !beaten.has(n)).sort((a, b) => a - b)[0];
    if (next === undefined) break;
    order.push({ n: next, from: order.length ? opener(next, [...order.map((o) => o.n)]) : undefined });
    beaten.add(next);
    open = openRegions(beaten);
  }
  return order;
}
/** Which beaten region's mythic first opened region n's road. */
function opener(n: number, done: number[]): number | undefined {
  for (let i = 1; i <= done.length; i++) if (openRegions(new Set(done.slice(0, i))).has(n)) return done[i - 1];
  return undefined;
}

const beat = (arc: string, kind: Kind, b: Omit<Placed, "arc" | "kind" | "status" | "game">): Placed =>
  ({ ...b, arc, kind, status: "built", game: true });

/** The game's own arcs, as story arcs. */
export function gameArcs(): (Omit<Arc, "beats"> & { beats: Placed[] })[] {
  const order = roadOrder();
  const ledger = order.map(({ n }) => {
    const g = regionOf(n)!, m = mythicOf(g), last = sections(g)[SECTIONS - 1];
    return beat("ledger", "main", {
      id: `mythic-${g.id}`, title: `${m.name} at ${last?.name ?? g.name}`, at: `mythic:${n}`, fights: [m.id],
      text: `The last stone of the ${g.name} trail: the region's mythic, ${m.name}, in its lair. Beat it and the Book can hold it.`,
    });
  });
  const roads = order.flatMap(({ n, from }) => {
    if (from === undefined) return [];
    const g = regionOf(n)!, f = regionOf(from)!, gate = GATES[n];
    return [beat("roads", "unlock", {
      id: `road-${g.id}`, title: `The road to the ${g.name}`, at: `mythic:${from}`, needs: [`mythic-${f.id}`],
      text: `Beating ${mythicOf(f).name} opens the road from the ${f.name} to the ${g.name}${gate ? `; ${gate.why}` : ""}.`,
      opens: `region ${n}, ${g.name}, from level ${sectionLevel(n, 0)}${gate ? ` (needs a ${gate.needs})` : ""}`,
    })];
  });
  const slots = order.slice(0, PARTY_MAX - PARTY_FIRST).map(({ n }, i) => {
    const g = regionOf(n)!;
    return beat("slots", "unlock", {
      id: `slot-${PARTY_FIRST + i + 1}`, title: `A line-up of ${PARTY_FIRST + i + 1}`, at: `mythic:${n}`, needs: [`mythic-${g.id}`],
      text: `Beating ${mythicOf(g).name} gives the line-up one more place.`, opens: `line-up slot ${PARTY_FIRST + i + 1}`,
    });
  });
  const factions = FACTIONS.map((id) => {
    const f = FACTION[id];
    return {
      id, kind: "sub" as const, title: f.name, pitch: f.theory,
      beats: f.quest.map((s, i) => beat(id, "sub", {
        id: s.id.replace(".", "-"), title: s.title, at: `stage:${s.id}`, text: s.log,
        ...(i ? { needs: [f.quest[i - 1]!.id.replace(".", "-")] } : {}),
        ...(s.fight ? { fights: s.fight.teams.at(-1)!.team.map((t) => t.id).slice(0, 4) } : {}),
      })),
    };
  });
  const boards = [...HUNTS.values()].sort((a, b) => a.n - b.n || a.k - b.k).map((h) => beat("boards", "side", {
    id: `board-${h.n}-${h.k}`, title: h.title, at: `board:${h.n}:${h.k}`, fights: [h.creature],
    text: `A sighting board in ${sections(regionOf(h.n)!)[h.k]?.name ?? "town"}: the ${h.witness.toLowerCase()} saw the ${creature(h.creature).name}. Three signs lead to its lair.`,
  }));
  return [
    { id: "ledger", kind: "main", title: "The ledger: every region's mythic", pitch: "The trail of each playable region ends at its mythic. The Book wants them all.", beats: ledger },
    { id: "roads", kind: "unlock", title: "The roads", pitch: "Each mythic beaten opens the roads to its neighbours; some need a flier or a swimmer in the line-up.", beats: roads },
    { id: "slots", kind: "unlock", title: "The line-up grows", pitch: `The line-up starts at ${PARTY_FIRST} and gains a place for each of the first mythics, up to ${PARTY_MAX}.`, beats: slots },
    ...factions,
    { id: "boards", kind: "side", title: "Sighting boards", pitch: "Two cryptid contracts a region, pinned in a town: read the report, follow three signs, find the named creature.", beats: boards },
  ];
}
