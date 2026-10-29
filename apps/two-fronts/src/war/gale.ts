// The Gale and the year's galaxy event (docs/REDESIGN.md §5). Both are read off the seed and the
// turn, never stored, so an online turn replays the same and an old save has a Gale already.
// Every world of GALE_MIN or more sectors has one: it sits on one sector of the ring (the sector
// list, in order, wrapping round) and moves 1 to 3 sectors on at each Collect. Armies under it
// lose 1 in 3 at Collect unless a shelter covers them; nothing lands there and nothing is
// bombarded there. Once a year, from year 2, a galaxy event lands on the year's first turn, and
// the turn before announces it.
import type { SectorKind } from "../battle/contract.ts";
import { mulberry32 } from "@rustybuns/util";
import { galaxyOf } from "./galaxy.ts";
import type { Campaign, Where } from "./rules.ts";

// The war's calendar: four turns to a year, so the banner can say "Year 2, turn 6".
export const TURNS_PER_YEAR = 4;
export const yearOf = (turn: number) => 1 + Math.floor((turn - 1) / TURNS_PER_YEAR);

export const GALE_MIN = 3;
// Where armies wait the Gale out. The planet boards' warren (#2690) joins the shield here.
export const SHELTER: readonly SectorKind[] = ["shield"];
export const DUST_STEP = 3; // a dust year blows the Gale this many sectors on as the year opens

const key = (id: string) => [...id].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);
const roll = (...xs: number[]) => mulberry32(xs.reduce((h, x) => (Math.imul(h ^ x, 0x9e3779b1) >>> 0), 0x6a1e))();

// How far the Gale moves at the Collect that ends `turn`: 1 to 3.
const step = (seed: number, turn: number, ring: number) => 1 + Math.floor(roll(seed, turn, ring) * 3);

// The sector the Gale sits on this turn, or null on a world too small for one. The storm is keyed
// on the world's ring, not its name, so a world and its twin across the map share the weather and
// neither side's planet gets the worse of it.
export function galeAt(c: Campaign, system: string, turn = c.turn): number | null {
  const sectors = c.systems[system]?.sectors ?? [], n = sectors.length;
  if (n < GALE_MIN || galaxyOf(c).calm) return null;
  const ring = key(galaxyOf(c).system(system).sectors.join());
  let at = Math.floor(roll(c.seed, ring) * n);
  for (let t = 1; t < turn; t++) at += step(c.seed, t, ring);
  for (let y = 2; y <= yearOf(turn); y++) if (yearEvent(c, y)?.kind === "dust") at += DUST_STEP;
  return at % n;
}

// Where it could be next turn: the three sectors 1 to 3 on (from where a dust year would blow it).
export function galeNext(c: Campaign, system: string): number[] {
  const at = galeAt(c, system), n = c.systems[system]!.sectors.length;
  if (at === null) return [];
  const blow = eventAt(c, c.turn + 1)?.kind === "dust" ? DUST_STEP : 0;
  return [1, 2, 3].map((k) => (at + blow + k) % n);
}

export const underGale = (c: Campaign, w: Where) => w.sector >= 0 && galeAt(c, w.system) === w.sector;
export const sheltered = (kind: SectorKind) => SHELTER.includes(kind);
// What the Gale takes from a force caught in the open: 1 in 3, rounded down.
export const galeLoss = (armies: number) => Math.floor(armies / 3);

// --- The year's galaxy event ---

export type EventKind = "flare" | "lanes" | "bloom" | "dust" | "clear" | "quiet";
export const EVENTS: EventKind[] = ["flare", "lanes", "bloom", "dust", "clear", "quiet"];
export const EVENT_NAMES: Record<EventKind, string> = { flare: "Solar flare", lanes: "Lane storm", bloom: "Ore bloom", dust: "Dust year", clear: "Clear skies", quiet: "Quiet year" };
export const EVENT_ICONS: Record<EventKind, string> = { flare: "sun", lanes: "cloud-lightning", bloom: "gem", dust: "wind", clear: "eye", quiet: "leaf" };
export const QUIET_CREDITS = 2; // until energy comes in with the command cards (#2692)

export interface GalaxyEvent { kind: EventKind; year: number; region?: string; lane?: [string, string] }

// The event a year opens with, or null in the first year (nobody was there to announce it).
export function yearEvent(c: Campaign, year: number): GalaxyEvent | null {
  const g = galaxyOf(c);
  if (year < 2 || g.calm) return null;
  const kind = EVENTS[Math.floor(roll(c.seed, year, 0xe7e) * EVENTS.length)]!, pick = roll(c.seed, year, 0x917);
  if (kind === "flare") return { kind, year, region: g.regions[Math.floor(pick * g.regions.length)]!.id };
  if (kind === "lanes") return { kind, year, lane: g.lanes[Math.floor(pick * g.lanes.length)]! };
  return { kind, year };
}

// The event on a turn: only the year's first turn has one.
export const eventAt = (c: Campaign, turn: number) => ((turn - 1) % TURNS_PER_YEAR === 0 ? yearEvent(c, yearOf(turn)) : null);
export const eventNow = (c: Campaign) => eventAt(c, c.turn);
// The one the Frost announces: next turn's, when next turn opens a year.
export const eventSoon = (c: Campaign) => eventAt(c, c.turn + 1);

export const laneClosed = (c: Campaign, a: string, b: string) => {
  const l = eventNow(c)?.lane;
  return !!l && ((l[0] === a && l[1] === b) || (l[0] === b && l[1] === a));
};
export const flared = (c: Campaign, system: string) => {
  const e = eventNow(c);
  return e?.kind === "flare" && galaxyOf(c).system(system).region === e.region;
};

// The event in words, for the log and the banner: `Solar flare over The Narrows: fleets there can't move`.
export function eventLine(c: Campaign, e: GalaxyEvent): string {
  const g = galaxyOf(c);
  switch (e.kind) {
    case "flare": return `Solar flare over ${g.regions.find((r) => r.id === e.region)!.name}: fleets there can't move`;
    case "lanes": return `Lane storm between ${g.system(e.lane![0]).name} and ${g.system(e.lane![1]).name}: the hyperlane is closed`;
    case "bloom": return "Ore bloom: dust seas pay double";
    case "dust": return "Dust year: the Gale blows 3 sectors on every world";
    case "clear": return "Clear skies: both sides see every number";
    case "quiet": return `Quiet year: both sides get ${QUIET_CREDITS} credits`;
  }
}
