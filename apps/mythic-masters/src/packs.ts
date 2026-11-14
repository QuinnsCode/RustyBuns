// Packs: one more land every season a monster legend is in the air (docs/WORLD-EXPANSION.md, part 5). A pack is
// data, no code, in packs/<id>/:
//   pack.json      name, season (from/to, [month, day]), its land's place on the grid and its port, its tier, the
//                  event creatures that roam the whole continent in its season, its beasts as fighters (`fighters`,
//                  a roster row each, joined to the roster by pack-fighters.ts), and credits for anything it ships
//   beasts/*.json  3-6 sheets in the beasts/ format (`bun scripts/beasts.ts` builds them)
//   pocket.json    the pack's lair, a Pocket as in pockets.ts
//   poi.json       its places: fires, tapes, landmarks, boards and cabins, each at [u, v] across its land (0-1)
//   lore.json      each legend's tale, sources and what of it is sacred, plus the beings held sacred
//   director.json  the narrator's lines: on the boat over, on landing, and leaving
// Its land is an island: a 3 x 2 corner off the grid's coast, reached by boat from a port region and loaded as its
// own map: public/packs/<id>/ground.bin, written by `bun scripts/fetch-world.ts <id>` and built by buildIsland in
// src/world/world.ts. A pack works from the old legend only: never a film's name, characters, look or studio.
// Adding a pack is its folder, one line in PACKS below and one in pack-fighters.ts; test/packs.test.ts checks it.
import { arr, Bad, int, num, obj, oneOf, opt, rec, str, type Guard, type Of } from "@rustybuns/util/guard";
import { SKINS } from "./arena.ts";
import { CRITTERS, POCKETS, type Critter, type Pocket } from "./pockets.ts";
import { Fighters } from "./pack-fighters.ts";
import { ALL_SKINS, REGIONS, TIERS } from "./regions.ts";
import type { PoiKind, Tape } from "./world/poi.ts";

import yuleIsle from "../packs/yule-isle/pack.json";
import yuleIsleDirector from "../packs/yule-isle/director.json";
import yuleIsleLore from "../packs/yule-isle/lore.json";
import yuleIslePocket from "../packs/yule-isle/pocket.json";
import yuleIslePoi from "../packs/yule-isle/poi.json";

/** A pack's land on the world grid: [cols, rows] of cells, its top-left corner at `cell`. */
export const LAND = [3, 2] as const;

const id = str(40, { re: /^[a-z0-9-]+$/ });
const pair = <T>(g: Guard<T>): Guard<[T, T]> => (v) => { const [a, b] = arr(g, 2, { min: 2 })(v); return [a!, b!]; };
const triple = <T>(g: Guard<T>): Guard<[T, T, T]> => (v) => { const [a, b, c] = arr(g, 3, { min: 3 })(v); return [a!, b!, c!]; };
/** [month, day]: day is checked against 31 only, so 30 February passes and simply never comes. */
const MonthDay = (v: unknown): [number, number] => { const [m, d] = pair(int(1, 31))(v); if (m > 12) throw new Bad("a month from 1 to 12"); return [m, d]; };
const Pair = pair(num(-1e6, 1e6)), Triple = triple(num(-1e3, 1e3));
/** A line in the director's voice: "Who: what". */
const Line = str(300, { re: /^[A-Z][A-Za-z .'-]{0,24}: \S/ });
const UV = pair(num(0, 1));

/** Licences we can ship: the ones the bestiary cards take (test/cards.test.ts). */
export const OPEN_LICENCE = /^(Public domain|CC0|No restrictions|KOGL Type 1|CC BY(-SA)? [1-4]\.\d)$/;
const Credit = obj({ what: str(200), by: str(200), licence: str(40, { re: OPEN_LICENCE }) });

export const PackJson = obj({
  id, name: str(60), about: str(600),
  season: obj({ from: MonthDay, to: MonthDay }),
  /** `cell` the land's top-left on the world grid (it sits off the coast, so it may be outside 0..GRID); `port` the
   * region its boat sails from; `at` and `km` the real place its ground is read from, as in places.ts. */
  land: obj({ cell: Pair, port: int(1, 64), at: Pair, km: num(20, 2000) }),
  tier: oneOf(TIERS),
  /** Its lair: the poi.json place it opens at, and who waits in it (a roster id) at what level. It fights in the
   *  pocket's look (lairLook). */
  lair: obj({ place: str(80), foe: id, level: int(1, 100) }),
  /** Its sighting board's contract (world/hunts.ts isleHunt): the poi.json board it is pinned to, who saw it, what they
   *  call it, the report, and three signs across the island that lead from the board to the lair. */
  board: opt(obj({ place: str(80), witness: str(24), title: str(80), report: arr(Line, 6, { min: 1 }), signs: arr(obj({ at: UV, sign: str(160) }), 3, { min: 3 }) })),
  events: arr(id, 12),
  fighters: Fighters,
  credits: arr(Credit, 50),
});
export type PackJson = Of<typeof PackJson>;

const LoreEntry = obj({ legend: str(2000, { min: 40 }), from: str(600, { min: 10 }), sources: arr(str(300, { min: 10 }), 10, { min: 1 }), sacred: str(600, { min: 10 }) });
export const LoreJson = obj({ legends: rec(LoreEntry, 6), sacred: arr(str(60), 20) });

const Lamp = obj({ at: Triple, color: int(0, 0xffffff), power: num(0, 500), flicker: num(0, 1) });
const critters = Object.keys(CRITTERS) as [Critter, ...Critter[]];
export const PocketJson: Guard<Pocket> = obj({
  name: str(80), region: id,
  walls: obj({ out: num(0, 40), height: num(1, 60), jag: num(0, 10), color: int(0, 0xffffff) }),
  roof: obj({ height: num(1, 80), color: int(0, 0xffffff) }),
  fog: obj({ near: num(0, 500), far: num(1, 2000), color: int(0, 0xffffff) }),
  lights: arr(Lamp, 16),
  rooms: arr(obj({ at: num(0, 360), r: num(1, 20), light: opt(obj({ color: int(0, 0xffffff), power: num(0, 500), flicker: num(0, 1) })) }), 8),
  critters: arr(obj({ kind: oneOf(critters), n: int(1, 200) }), 8),
});

const KINDS = ["tape", "fire", "landmark", "board", "cabin"] as const satisfies readonly PoiKind[];
export const PoiJson = arr(obj({ kind: oneOf(KINDS), name: str(80), at: UV, tape: opt(obj({ title: str(80), lines: arr(Line, 12, { min: 1 }) })) }), 60, { min: 1 });
export const DirectorJson = obj({ crossing: arr(Line, 20, { min: 1 }), arrival: arr(Line, 20, { min: 1 }), leaving: arr(Line, 20, { min: 1 }) });

export interface Pack extends PackJson {
  pocket: Pocket;
  places: { kind: PoiKind; name: string; at: [number, number]; tape?: Tape }[];
  lore: Of<typeof LoreJson>;
  director: Of<typeof DirectorJson>;
}

/** A pack from its files, each read through its guard: a wrong field throws, naming the pack. */
export function loadPack(files: { pack: unknown; pocket: unknown; poi: unknown; lore: unknown; director: unknown }): Pack {
  const pack = PackJson(files.pack);
  try {
    return { ...pack, pocket: PocketJson(files.pocket), places: PoiJson(files.poi), lore: LoreJson(files.lore), director: DirectorJson(files.director) };
  } catch (e) { throw new Error(`pack ${pack.id}: ${e instanceof Error ? e.message : String(e)}`); }
}

export const PACKS: Pack[] = [
  loadPack({ pack: yuleIsle, pocket: yuleIslePocket, poi: yuleIslePoi, lore: yuleIsleLore, director: yuleIsleDirector }),
];

/** A pack's lair look, `<id>-lair`: its pocket walled round its port region's arena, put in POCKETS and ALL_SKINS as
 *  the continent's lairs are, so a fight there plays in the pocket's walls, lights, fog and critters. */
export const lairLook = (p: Pick<PackJson, "id">) => `${p.id}-lair`;
for (const p of PACKS) {
  const base = ALL_SKINS[REGIONS[p.land.port - 1]!.id] ?? SKINS.stadium!;
  POCKETS[lairLook(p)] = p.pocket;
  ALL_SKINS[lairLook(p)] = { ...base, name: p.pocket.name, pocket: lairLook(p) };
}

/** Whether `date` falls in the pack's season (inclusive; it may wrap the new year). */
export function packInSeason(p: Pick<PackJson, "season">, date: Date): boolean {
  const d = (date.getMonth() + 1) * 100 + date.getDate(), a = p.season.from[0] * 100 + p.season.from[1], b = p.season.to[0] * 100 + p.season.to[1];
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

/** The event creatures roaming the whole continent on `date`: every in-season pack's. */
export const roamingEvents = (date: Date, packs: readonly Pack[] = PACKS): Set<string> =>
  new Set(packs.filter((p) => packInSeason(p, date)).flatMap((p) => p.events));
