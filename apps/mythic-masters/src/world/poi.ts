// Places to find on the open ground: something every minute or so of walking. Each playable region has about twenty,
// the same ones every time (they come from the ground and the region's number, never from chance):
//   tape      a VHS tape in a stump. Walk up and it plays through the director (src/director.ts); the journal keeps it.
//   fire      a campfire. Walk up to rest (and save) and it is lit; lit fires are where you can travel to.
//   landmark  a tower, a ruin, a marker. It is found by seeing it on screen, and then it is on the corner map.
// Placement: partly anchored on the trail (one per section, a little off its keeper's stone) and partly one per
// 300 m square of open ground from the region's hash. Never closer than MIN_GAP to one another, never on a stone.
// No three.js and no DOM: poi-view.ts draws them, the tests walk to them.
import { mulberry32 } from "@rustybuns/util";
import { hasTrail, SECTIONS, sections, type Journey } from "../journey.ts";
import { REGIONS, type Region } from "../regions.ts";
import { GRID } from "./places.ts";
import { ARENA_R, CELL, heightAt, ownerAt } from "./world.ts";
import { bandAt, TRAILS, WORLD } from "./trail.ts";

export const MIN_GAP = 120;     // metres between any two places
export const SQUARE = 300;      // one place at least in each square this wide that has open ground
export const REACH = 4;         // walk this close to a tape or a fire to use it
export const SEE_R = 280;       // a landmark this close, on screen, is found
const NO_STONE = ARENA_R * 6;   // metres kept clear round a keeper's stone and the arena
const MARGIN = MIN_GAP / 2;     // hashed places stay this far inside their square, so neighbours are never too close

export type PoiKind = "tape" | "fire" | "landmark";
export interface Poi {
  /** Stable: region, then where it stands. Saves keep these. */
  id: string;
  n: number;
  kind: PoiKind;
  name: string;
  x: number;
  z: number;
  /** The trail section (0-based) whose band it stands in. */
  k: number;
  /** A tape's number among its region's tapes. */
  tape?: number;
}

/** What a tape plays: lines in the director's voice, "Who: what". */
export interface Tape { title: string; lines: string[]; placeholder?: boolean }

// --- the tapes ---------------------------------------------------------------------------------------------------
// Written by hand for the Pine Barrens. Every other region plays a placeholder built from its own sections' facts
// (`tapeOf`) until someone writes theirs.
const PINE: Tape[] = [
  { title: "Camper's log, Day 3", lines: [
    "Camper: Day three in the pines. The water is the colour of tea and I've stopped trusting it.",
    "Camper: Something walked round the tent last night. On two legs. Then on four. Then I stopped counting.",
    "Camper: If you find this, the sand gets into everything. Including the tape.",
  ] },
  { title: "Ranger's report, Wharton", lines: [
    "Ranger: Pinelands incident fourteen. A hiker reports hoofprints in the sand that go up to a tree and not away from it.",
    "Ranger: I checked the tree. It's a pitch pine. It's an ordinary pitch pine. I'd like that noted.",
    "Ranger: One million acres of forest, and I get this one. Report ends.",
  ] },
  { title: "Gary narrates", lines: [
    "Gary: Hello, we're in the Pine Barrens, which is the opposite of barren. It's very full. Of pine.",
    "Gary: That's cedar water. It's brown because of the tannins. It's not a swamp thing. It's a tree thing.",
    "Gary: ...Did the water just move? It's the wind. It's the wind. Cut. Don't cut. Cut.",
  ] },
  { title: "The bog-iron men", lines: [
    "Foreman: They dug iron out of the stream bottoms here. The streams make it themselves, rusting into the bog.",
    "Foreman: Furnaces burned the pines for charcoal to melt it. The woods grew back. The woods always grow back.",
    "Foreman: Funny thing about the old furnace hands. They never worked nights. Never said why.",
  ] },
  { title: "Fire tower, last entry", lines: [
    "Watcher: Up in the tower again. On a clear day you can see Philadelphia one way and Atlantic City the other.",
    "Watcher: Tonight there's a light between them. Low. It isn't a town. It moves when I move.",
    "Watcher: I'm coming down now. I'm coming down now. The ladder has a lot of rungs tonight.",
  ] },
  { title: "Nineteen-oh-nine", lines: [
    "Narrator: In one week of January 1909, hundreds of people said they heard it and saw the tracks.",
    "Narrator: Hoofprints went over rooftops. A trail stopped at a wall and began again on the other side of it.",
    "Narrator: Schools closed. Mills shut. Posses went out. The pines kept every secret they had.",
  ] },
];

/** A placeholder tape for a region without one written: its section's name and fact, in the usual voices. */
function placeholder(g: Region, k: number): Tape {
  const s = sections(g)[Math.min(k, SECTIONS - 2)]!;
  return { title: `${s.name}, unmarked tape`, placeholder: true, lines: [
    `You: Rolling. This is ${s.name}.`,
    `Narrator: ${s.lore}`,
    "Gary: Write that down. Somebody write that down.",
  ] };
}

/** The tape a tape place plays: the region's written one by number, else the placeholder for its section. */
export function tapeOf(p: Poi): Tape {
  const g = REGIONS[p.n - 1]!, hand = g.biome === "pine-barrens" ? PINE : [];
  return hand[p.tape ?? 0] ?? placeholder(g, p.k);
}

// --- placement -----------------------------------------------------------------------------------------------------
const KINDS: PoiKind[] = ["tape", "fire", "landmark", "fire", "tape", "landmark", "fire"];
const NOUNS = ["lookout", "old marker", "ruin", "overlook", "signpost", "standing stone"];
const far = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

function place(g: Region): Poi[] {
  const tr = TRAILS.get(g.n);
  if (!tr) return [];
  const rnd = mulberry32(g.n * 7919 + 17);
  const mine: { x: number; z: number }[] = [];
  /** Open, dry ground of this region, in a section, away from every stone, and 120 m from the places so far. */
  const ok = (x: number, z: number) => ownerAt(x, z) === g.n && heightAt(WORLD, x, z) > 0.8 && bandAt(x, z) > 0
    && tr.stones.every((s) => far(s, { x, z }) >= NO_STONE) && mine.every((q) => far(q, { x, z }) >= MIN_GAP);
  // Anchors: one near each section's stone, a little off the path, on the way out of the stone's own band.
  for (let k = 0; k < SECTIONS - 1; k++) {
    const s = tr.stones[k]!;
    const spots: { x: number; z: number }[] = [];
    for (let a = 0; a < 16; a++) for (const d of [NO_STONE + 6, NO_STONE + 30]) {
      const ang = rnd() * Math.PI * 2;
      spots.push({ x: s.x + Math.cos(ang) * d, z: s.z + Math.sin(ang) * d });
    }
    const spot = spots.find((q) => bandAt(q.x, q.z) === k + 1 && ok(q.x, q.z));
    if (spot) mine.push(spot);
  }
  // The rest: each square of open ground that has none yet gets one, from the hash of the square.
  const cols = Math.ceil((GRID.w * CELL) / SQUARE), rows = Math.ceil((GRID.h * CELL) / SQUARE);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = c * SQUARE, z0 = r * SQUARE;
    if (mine.some((q) => q.x >= x0 && q.x < x0 + SQUARE && q.z >= z0 && q.z < z0 + SQUARE)) continue;
    const roll = mulberry32((g.n * 131 + c) * 977 + r * 7 + 3);
    const inner = SQUARE - 2 * MARGIN;
    for (let tries = 0; tries < 40; tries++) {
      const x = x0 + MARGIN + roll() * inner, z = z0 + MARGIN + roll() * inner;
      if (ok(x, z)) { mine.push({ x, z }); break; }
    }
  }
  // Order them along the trail (section, then north to south), and deal the kinds out.
  const placed = mine.map((q) => ({ ...q, k: bandAt(q.x, q.z) - 1 })).sort((a, b) => a.k - b.k || a.z - b.z || a.x - b.x);
  let tapes = 0;
  return placed.map((q, i) => {
    const kind = KINDS[i % KINDS.length]!, x = Math.round(q.x * 10) / 10, z = Math.round(q.z * 10) / 10, s = sections(g)[Math.min(q.k, SECTIONS - 2)]!;
    const noun = NOUNS[Math.floor(rnd() * NOUNS.length)]!;
    const p: Poi = { id: `${g.n}.${Math.round(x)}.${Math.round(z)}`, n: g.n, kind, x, z, k: q.k, name: "" };
    if (kind === "tape") p.tape = tapes++;
    p.name = kind === "fire" ? `Campfire, ${s.name}` : kind === "landmark" ? `${s.name} ${noun}` : tapeOf(p).title;
    return p;
  });
}

/** Every region's places, by region number. */
export const POIS = new Map<number, Poi[]>(REGIONS.filter(hasTrail).map((g) => [g.n, place(g)]));
export const ALL: Poi[] = [...POIS.values()].flat();
const BY_ID = new Map(ALL.map((p) => [p.id, p]));
export const poiById = (id: string) => BY_ID.get(id);

// --- walking up to them --------------------------------------------------------------------------------------------
/**
 * The tapes and fires you have just walked up to: those within REACH that `reached` didn't hold. `reached` is
 * the ones you are standing at, kept by the caller so a fire rests you once per visit, not once per step; a place
 * leaves it when you are more than twice REACH away.
 */
export function arrive(me: { x: number; z: number }, reached: Set<string>): Poi[] {
  const out: Poi[] = [];
  for (const p of POIS.get(ownerAt(me.x, me.z)) ?? []) {
    if (p.kind === "landmark") continue;
    const d = far(me, p);
    if (d < REACH && !reached.has(p.id)) { reached.add(p.id); out.push(p); }
    else if (d > REACH * 2) reached.delete(p.id);
  }
  return out;
}

/** What the journey remembers of the places: tapes watched, fires lit, landmarks seen (place ids). */
export type Log = Pick<Journey, "found" | "fires" | "sights">;

/** Marks a tape found. True the first time. */
export function findTape(j: Log, p: Poi): boolean { return add(j.found, p.id); }
/** Lights a fire (or rests at it again). True the first time. */
export function lightFire(j: Log, p: Poi): boolean { return add(j.fires, p.id); }
/** Marks a landmark seen. True the first time. */
export function sight(j: Log, p: Poi): boolean { return add(j.sights, p.id); }
function add(list: string[], id: string) { if (list.includes(id)) return false; list.push(id); return true; }

/** The tapes found in region n, in the order of the region's tapes. */
export const tapesFound = (j: Log, n: number): Poi[] => (POIS.get(n) ?? []).filter((p) => p.kind === "tape" && j.found.includes(p.id));

/** Where you land when you travel to a lit fire: a few metres beside it; undefined when it isn't a lit fire. */
export function fireSpot(j: Log, id: string): { x: number; z: number; n: number } | undefined {
  const p = BY_ID.get(id);
  return p && p.kind === "fire" && j.fires.includes(id) ? { x: p.x + 2, z: p.z, n: p.n } : undefined;
}

/** The places in view of the map: found tapes, lit fires and seen landmarks marked bright; the rest dim. */
export const marked = (j: Log | null, p: Poi): boolean => !!j && (p.kind === "tape" ? j.found : p.kind === "fire" ? j.fires : j.sights).includes(p.id);
