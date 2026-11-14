// A pack's beasts as fighters: the `fighters` block in packs/<id>/pack.json, read here and joined to the roster's
// ROWS (creatures.ts), each an event creature roaming in its pack's season (tiers.ts). Kept apart from packs.ts,
// which builds the pack's lair and pulls in three.js, so the roster and the sim stay light.
import { arr, bool, int, num, obj, oneOf, opt, rec, str, type Of } from "@rustybuns/util/guard";
import type { Row } from "./creatures.ts";
import { FIELDS } from "./fields.ts";
import { FX } from "./moves.ts";

import yuleIsle from "../packs/yule-isle/pack.json";

const ARCHETYPES = ["skirmisher", "flyer", "tank", "bruiser"] as const;
const MOTIONS = ["grab", "shake", "drum", "volley", "shriek", "roll"] as const;
const stat = int(10, 200);

/** One fighter, as a row of creatures.ts plus its tale and other names (the id is its key in the block). */
export const Fighter = obj({
  name: str(40), region: int(1, 64), archetype: oneOf(ARCHETYPES), fields: arr(oneOf(FIELDS), 2, { min: 1 }),
  heightM: num(0.1, 30), massKg: num(1, 100000), stats: arr(stat, 6, { min: 6 }),
  sig: obj({ name: str(40), field: oneOf(FIELDS), ranged: bool(), fx: oneOf(FX), power: opt(int(40, 200)), drain: opt(int(0, 100)), motion: opt(oneOf(MOTIONS)) }),
  tale: str(300, { min: 20 }), aka: opt(arr(str(40), 4)),
});
export const Fighters = rec(Fighter, 6);
export type Fighter = Of<typeof Fighter>;

const PackFighters = obj({ season: obj({ from: arr(int(1, 31), 2, { min: 2 }), to: arr(int(1, 31), 2, { min: 2 }) }), fighters: Fighters });
const packs = [yuleIsle].map((p) => PackFighters(p));

export const PACK_ROWS: Row[] = packs.flatMap((p) => Object.entries(p.fighters).map(([id, f]): Row => ({
  id, name: f.name, region: f.region, archetype: f.archetype, fields: f.fields, heightM: f.heightM, massKg: f.massKg,
  stats: [f.stats[0]!, f.stats[1]!, f.stats[2]!, f.stats[3]!, f.stats[4]!, f.stats[5]!], sig: f.sig,
})));
export const PACK_TALE: Record<string, string> = Object.fromEntries(packs.flatMap((p) => Object.entries(p.fighters).map(([id, f]) => [id, f.tale])));
export const PACK_AKA: Record<string, string[]> = Object.fromEntries(packs.flatMap((p) => Object.entries(p.fighters).flatMap(([id, f]) => f.aka ? [[id, f.aka]] : [])));
/** Each pack fighter's season, its pack's: [month, day] from and to. */
export const PACK_SEASON: Record<string, [[number, number], [number, number]]> = Object.fromEntries(packs.flatMap((p) =>
  Object.keys(p.fighters).map((id) => [id, [[p.season.from[0]!, p.season.from[1]!], [p.season.to[0]!, p.season.to[1]!]]])));
