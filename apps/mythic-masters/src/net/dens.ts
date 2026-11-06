// Who may live in a den, worked out by the room from the world's own seed rather than taken on the page's word (#3700).
// A page that walks into a den says which creature and level it met; the room keeps that only when the den could hold
// it, so a fight report (party.ts `plausible`) can only ever be for a creature the world put there. No world here: the
// region owner grid, pools, sections, contracts, where each placed den stands and where travel lands you come cut down
// from scripts/dens.ts (src/net/dens.json, 9 KB gzipped), and the rolls from world/seed.ts, the same ones the page
// draws its dens with.
import { TIER_LEVEL, tierOf } from "../tiers.ts";
import { DEN, DEN_SALT, hash, sectionPick, wildLevel } from "../world/seed.ts";
import type { Delta } from "./party.ts";
import table from "./dens.json";

/** A creature at a level; a pool told as runs, `id[i]` `k[i]` times over; a trail section's wild ones (`w`) and keeper. */
interface At { id: string; lv: number }
interface Runs { id: string[]; k: number[] }
const T: { cols: number; owner: number[][]; pools: Record<string, Runs[]>; trail: Record<string, (At & { w: string[] })[]>; mythic: Record<string, At>; hunts: Record<string, At>; places: Record<string, number[]>; land: number[] } = table;

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

/** How close to a placed den a player stands when they walk into it, in metres: the page starts a keeper's or the
 *  arena's fight 4 m from its marker and a wild one's at 3.5 m from where it circles (10 m round a trail den's spot). */
const NEAR_M: Record<string, number> = { keeper: 60, mythic: 60, trail: 80, hunt: 80 };

/** Is `den` somewhere this player could have walked into, by the last pose they sent? A wild den's cell within 400 m;
 *  a keeper's stone, the arena, a trail den (any spot it takes over the clock) or a contract's lair within NEAR_M of it. Anything else is no den. */
export function denNear(den: string, p: Delta): boolean {
  if (p.x === undefined || p.z === undefined) return false;
  const x = p.x / 10, z = p.z / 10, cell = /^(\d+),(\d+)$/.exec(den);
  if (cell) return Math.hypot((+cell[1]! + 0.5) * DEN - x, (+cell[2]! + 0.5) * DEN - z) < 400;
  const at = T.places[den] ?? [], r = NEAR_M[den.split(":")[0]!] ?? 0;
  for (let i = 0; i < at.length; i += 2) if (Math.hypot(at[i]! - x, at[i + 1]! - z) < r) return true;
  return false;
}

/** Travel lands you this close to an arena's doorstep or a campfire. */
const LAND_M = 30;
/** Is this pose where travel lands you, in one of the regions `open` (what the page says its save has opened): an
 *  arena's doorstep or the trailhead past what you've cleared (travel, or sent home after a loss), or beside a campfire
 *  (fast travel)? A jump that lands here is one the game makes; one into a region still shut is not, wherever it lands. */
export function landing(p: Delta, open: readonly number[]): boolean {
  if (p.x === undefined || p.z === undefined) return false;
  const x = p.x / 10, z = p.z / 10;
  for (let i = 0; i < T.land.length; i += 3) if (open.includes(T.land[i + 2]!) && Math.hypot(T.land[i]! - x, T.land[i + 1]! - z) < LAND_M) return true;
  return false;
}

/** Could den `den` hold creature `c` at level `lv`? */
export const holds = (den: string, c: string, lv: number) => denHolds(den).has(`${c}@${lv}`);
