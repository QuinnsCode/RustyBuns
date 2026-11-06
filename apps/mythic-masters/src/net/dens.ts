// Who may live in a den, worked out by the room from the world's own seed rather than taken on the page's word (#3700).
// A page that walks into a den says which creature and level it met; the room keeps that only when the den could hold
// it, so a fight report (party.ts `plausible`) can only ever be for a creature the world put there. No world here: the
// region owner grid, pools, sections and contracts come cut down from scripts/dens.ts (src/net/dens.json, 4 KB
// gzipped), and the rolls from world/seed.ts, the same ones the page draws its dens with.
import { TIER_LEVEL, tierOf } from "../tiers.ts";
import { DEN_SALT, hash, sectionPick, wildLevel } from "../world/seed.ts";
import table from "./dens.json";

/** A creature at a level; a pool told as runs, `id[i]` `k[i]` times over; a trail section's wild ones (`w`) and keeper. */
interface At { id: string; lv: number }
interface Runs { id: string[]; k: number[] }
const T: { cols: number; owner: number[][]; pools: Record<string, Runs[]>; trail: Record<string, (At & { w: string[] })[]>; mythic: Record<string, At>; hunts: Record<string, At> } = table;

/** The playable region a wild den's cell `cx, cz` holds a creature for, or 0. */
function ownerOf(cx: number, cz: number): number {
  const row = cx < T.cols ? T.owner[cz] : undefined;
  if (!row) return 0;
  for (let i = 0, at = 0; i < row.length; i += 2) if ((at += row[i + 1]!) > cx) return row[i]!;
  return 0;
}

/** The `i`-th of a pool. */
function nth(pool: Runs, i: number): string | undefined {
  for (let j = 0; j < pool.k.length; j++) if ((i -= pool.k[j]!) < 0) return pool.id[j];
  return undefined;
}

/** Every creature and level den `den` may hold, as `id@level`. */
export function denHolds(den: string): Set<string> {
  const out = new Set<string>(), add = (id: string | undefined, lv: number | undefined) => { if (id && lv !== undefined) out.add(`${id}@${lv}`); };
  const cell = /^(\d+),(\d+)$/.exec(den);
  if (cell) {
    const cx = +cell[1]!, cz = +cell[2]!, n = ownerOf(cx, cz);
    if (!n) return out;
    // One of its region's pool (any season's), or, out on the trail, one of the section it stands in.
    for (const pool of T.pools[n] ?? []) {
      const len = pool.k.reduce((a, k) => a + k, 0), id = nth(pool, Math.floor(hash(cx, cz, DEN_SALT.who) * len));
      if (id) add(id, wildLevel(n, hash(cx, cz, DEN_SALT.level)) + TIER_LEVEL[tierOf(id)]);
    }
    for (const s of T.trail[n] ?? []) { const p = sectionPick(den, s.w, s.lv); add(p?.id, p?.level); }
    return out;
  }
  const trail = /^trail:(\d+):(\d+):\d+$/.exec(den), keeper = /^keeper:(\d+):(\d+)$/.exec(den), mythic = /^mythic:(\d+)$/.exec(den);
  if (trail) { const s = T.trail[trail[1]!]?.[+trail[2]!], p = s && sectionPick(den, s.w, s.lv); add(p?.id, p?.level); }
  else if (keeper) { const s = T.trail[keeper[1]!]?.[+keeper[2]!]; add(s?.id, s?.lv); }
  else if (mythic) { const m = T.mythic[mythic[1]!]; add(m?.id, m?.lv); }
  else if (den.startsWith("hunt:")) { const h = T.hunts[den.slice(5)]; add(h?.id, h?.lv); }
  return out;
}

/** Could den `den` hold creature `c` at level `lv`? */
export const holds = (den: string, c: string, lv: number) => denHolds(den).has(`${c}@${lv}`);
