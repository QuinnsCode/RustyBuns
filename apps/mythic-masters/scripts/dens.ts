// Writes src/net/dens.json: who may live in each den, for the room to check a page's word against (#3700). The world's
// owner grid takes a quarter of a second to build, too slow for a Durable Object's cold start, so it is cut down here
// to what a den needs: the region a wild den's cell belongs to, each region's pools, sections and mythic, and each
// contract's creature. test/dens.test.ts fails when the world moves and this file wasn't rerun.
//
//   bun scripts/dens.ts
import { mythicOf, sections, SECTIONS } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { HUNTS } from "../src/world/hunts.ts";
import { GRID } from "../src/world/places.ts";
import { DEN, DEN_CHANCE, DEN_SALT, denHead, hash } from "../src/world/seed.ts";
import { CELL, poolOf, regionAt } from "../src/world/world.ts";

export const OUT = new URL("../src/net/dens.json", import.meta.url).pathname;

/** A pool as runs of one id: `id[i]` `k[i]` times over. */
interface Runs { id: string[]; k: number[] }
const runs = (pool: readonly string[]): Runs => {
  const out: Runs = { id: [], k: [] };
  for (const id of pool) { if (out.id.at(-1) === id) out.k[out.k.length - 1]!++; else { out.id.push(id); out.k.push(1); } }
  return out;
};

export function denTable() {
  const cols = Math.ceil((GRID.w * CELL) / DEN), rows = Math.ceil((GRID.h * CELL) / DEN);
  // Each row of den cells as [region, how many] runs; 0 is a cell with no den or one off the playable regions.
  const owner: number[][] = [];
  for (let cz = 0; cz < rows; cz++) {
    const row: number[] = [];
    for (let cx = 0; cx < cols; cx++) {
      const g = regionAt(...denHead(cx, cz));
      const n = hash(cx, cz, DEN_SALT.holds) <= DEN_CHANCE && g?.tier === "playable" ? g.n : 0;
      if (row[row.length - 2] === n) row[row.length - 1]!++; else row.push(n, 1);
    }
    owner.push(row);
  }
  // A pool changes with the season (an event creature's weeks), so every pool a region has over a year.
  const pools: Record<number, Runs[]> = {}, trail: Record<number, { w: string[]; id: string; lv: number }[]> = {}, mythic: Record<number, { id: string; lv: number }> = {};
  for (const g of REGIONS.filter((r) => r.tier === "playable")) {
    const seen = new Map<string, Runs>();
    for (let d = 0; d < 366; d++) { const r = runs(poolOf(g.n, new Date(Date.UTC(2028, 0, 1 + d)))); seen.set(JSON.stringify(r), r); }
    pools[g.n] = [...seen.values()].filter((r) => r.id.length);
    trail[g.n] = sections(g).map((s) => ({ w: s.wilds, id: s.keeper, lv: s.level }));
    mythic[g.n] = { id: mythicOf(g).id, lv: sections(g)[SECTIONS - 1]!.level };
  }
  const hunts: Record<string, { id: string; lv: number }> = {};
  for (const [id, h] of HUNTS) hunts[id] = { id: h.creature, lv: h.level };
  return { cols, owner, pools, trail, mythic, hunts };
}

if (import.meta.main) {
  const json = JSON.stringify(denTable());
  await Bun.write(OUT, json + "\n");
  console.log(`${OUT}: ${(json.length / 1024).toFixed(1)} KB`);
}
