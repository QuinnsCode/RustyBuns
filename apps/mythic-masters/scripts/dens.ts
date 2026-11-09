// Writes src/net/dens.json: who may live in each den, for the room to check a page's word against (#3700). The world's
// owner grid takes a quarter of a second to build, too slow for a Durable Object's cold start, so it is cut down here
// to what a den needs: the region a wild den's cell belongs to, each region's pools, sections and mythic, each
// contract's creature, where each placed den stands (stones, arenas, trail dens, lairs), and the spots a page may jump
// to (every arena's doorstep and every campfire). test/dens.test.ts fails when the world moves and this file wasn't rerun.
//
//   bun scripts/dens.ts
import { mythicOf, sections, SECTIONS } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { HUNTS } from "../src/world/hunts.ts";
import { ALL } from "../src/world/poi.ts";
import { trailhead, TRAILS, trailWilds } from "../src/world/trail.ts";
import { GRID } from "../src/world/places.ts";
import { DEN, DEN_CHANCE, DEN_SALT, denHead, hash } from "../src/world/seed.ts";
import { arenaOf, CELL, poolOf, regionAt, spawn } from "../src/world/world.ts";
import { WORLD_CYCLE } from "../src/net/party.ts";
import { help } from "../../../scripts/help.ts";

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
  // A pool changes with the season (an event creature's weeks) and the hour (the night ones), so every pool a region has over a year.
  const pools: Record<number, Runs[]> = {}, trail: Record<number, { w: string[]; id: string; lv: number }[]> = {}, mythic: Record<number, { id: string; lv: number }> = {};
  for (const g of REGIONS.filter((r) => r.tier === "playable")) {
    const seen = new Map<string, Runs>();
    for (let d = 0; d < 366; d++) for (const night of [false, true]) { const r = runs(poolOf(g.n, new Date(Date.UTC(2028, 0, 1 + d)), night)); seen.set(JSON.stringify(r), r); }
    pools[g.n] = [...seen.values()].filter((r) => r.id.length);
    trail[g.n] = sections(g).map((s) => ({ w: s.wilds, id: s.keeper, lv: s.level }));
    mythic[g.n] = { id: mythicOf(g).id, lv: sections(g)[SECTIONS - 1]!.level };
  }
  const hunts: Record<string, { id: string; lv: number }> = {};
  for (const [id, h] of HUNTS) hunts[id] = { id: h.creature, lv: h.level };
  // Where each den that isn't a wild cell stands, in whole metres: a keeper's stone, the arena, a contract's lair, and
  // every spot a trail den takes over the world clock's cycle (which side of the path it circles on turns with the
  // clock), as [x, z, x, z, ...].
  const xz = (p: { x: number; z: number }): number[] => [Math.round(p.x), Math.round(p.z)];
  const places: Record<string, number[]> = {};
  for (const [n, tr] of TRAILS) { tr.stones.slice(0, SECTIONS - 1).forEach((s, k) => { places[`keeper:${n}:${k}`] = xz(s); }); places[`mythic:${n}`] = xz(arenaOf(REGIONS[n - 1]!)); }
  const near = (a: number[], x: number, z: number) => { for (let i = 0; i < a.length; i += 2) if (Math.hypot(a[i]! - x, a[i + 1]! - z) < 20) return true; return false; };
  for (let t = 0; t < WORLD_CYCLE; t += 5) for (const w of trailWilds(0, 0, t, 1e9)) {
    const at = (places[w.den] ??= []);
    if (!near(at, w.x, w.z)) at.push(...xz(w));
  }
  for (const [id, h] of HUNTS) places[`hunt:${id}`] = xz(h.lair);
  // Where travel lands you: an arena's doorstep (travel, or sent home after a loss), the trailhead past the sections
  // you have cleared (where either puts you on a trail you haven't finished), and beside a campfire (fast travel), each
  // with its region, as [x, z, region, ...]: a jump is believed only into a region the page says it has opened.
  const heads = [...TRAILS.keys()].flatMap((n) => Array.from({ length: SECTIONS }, (_, k) => trailhead(n, k)).flatMap((p) => (p ? [[...xz(p), n]] : [])));
  const land = [...REGIONS.map((g) => [...xz(spawn(g.n)), g.n]), ...heads, ...ALL.filter((p) => p.kind === "fire").map((p) => [...xz({ x: p.x + 2, z: p.z }), p.n])].flat();
  return { cols, owner, pools, trail, mythic, hunts, places, land };
}

if (import.meta.main) {
  help(import.meta.path);
  const json = JSON.stringify(denTable());
  await Bun.write(OUT, json + "\n");
  console.log(`${OUT}: ${(json.length / 1024).toFixed(1)} KB`);
}
