// The reading a faction keeps on you, in the manner of a PID controller: where you stand now (P), where you have
// stood over the whole journey (I), and which way it has been going (D). Lines read the three as bands; summed, they
// are the pressure a faction puts on you, in levels over its section. Your own run has the same three (how far you
// are, how much you have done in all, your pace), and a party's reading is its members' put together.
import { clamp } from "@rustybuns/util";
import { SECTIONS, type Journey } from "../journey.ts";
import type { Band, Standing, Trend } from "./model.ts";

/** Standing runs from -LIMIT (an enemy) to LIMIT (one of theirs). */
export const LIMIT = 10;
export interface Reading { now: number; past: number; trend: number }

export const fresh = (): Standing => ({ s: 0, area: 0, deals: 0, recent: [], won: 0, lost: 0, people: {}, beaten: {}, heard: [] });

/** One dealing with a faction: your standing moves by `d`, and the move goes into the history and the trend. */
export function deal(st: Standing, d: number) {
  st.s = clamp(st.s + d, -LIMIT, LIMIT);
  st.area += st.s; st.deals++;
  st.recent = [...st.recent, st.s].slice(-4);
}

/** Now, the mean of every standing so far, and now less the standing three dealings ago (0 before there were three). */
export function reading(st: Standing | undefined): Reading {
  if (!st) return { now: 0, past: 0, trend: 0 };
  return { now: st.s, past: st.deals ? st.area / st.deals : 0, trend: st.s - (st.recent.length >= 4 ? st.recent[0]! : 0) };
}
export const bandOf = (v: number): Band => (v <= -4 ? "cold" : v < -0.5 ? "cool" : v <= 0.5 ? "even" : v < 4 ? "warm" : "close");
export const trendOf = (d: number): Trend => (d <= -2 ? "falling" : d >= 2 ? "rising" : "steady");

/** How much of each term goes into the pressure. The past weighs most: one good day does not undo a bad month. */
export const GAIN = { p: 0.25, i: 0.35, d: 0.3 };
/** Levels a faction's teams stand over (or under) their section for you: -2 for a friend, up to 4 for an old enemy
 * who is getting worse. */
export function pressure(r: Reading): number {
  return clamp(Math.round(-(GAIN.p * r.now + GAIN.i * r.past + GAIN.d * r.trend)), -2, 4);
}

/** A party's reading: a faction treats the group by its worst-behaved member now, and by the mean of the rest. */
export function together(rs: readonly Reading[]): Reading {
  if (!rs.length) return { now: 0, past: 0, trend: 0 };
  const mean = (f: (r: Reading) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  return { now: Math.min(...rs.map((r) => r.now)), past: mean((r) => r.past), trend: mean((r) => r.trend) };
}

const HOUR = 3_600_000;
/** Your own run: sections cleared (where you are), everything you have done on the way (where you have come from),
 * and sections cleared in the last hour of play (where you are going). */
export function run(j: Journey, now: number): Reading {
  const cleared = Object.values(j.cleared).reduce((a, k) => a + Math.min(k, SECTIONS), 0);
  const kinds = new Set([...j.party, ...j.journal].map((m) => m.id)).size;
  const marks = j.factions?.marks ?? [];
  return { now: cleared, past: j.pages.length + j.fires.length + j.found.length + j.sights.length + kinds, trend: marks.filter((t) => now - t < HOUR).length };
}
/** How many sections behind you a faction's nearest post is manned: two when you are moving fast, one at a walk, and
 * none once you have stopped for a day (they have caught up, and stand in the section you are in). */
export function lag(j: Journey, now: number): number {
  const marks = j.factions?.marks ?? [], last = marks.at(-1);
  if (last === undefined || now - last >= 24 * HOUR) return 0;
  return run(j, now).trend >= 3 ? 2 : 1;
}
