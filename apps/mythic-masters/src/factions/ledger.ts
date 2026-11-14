// The Compendium's Factions chapter, as data: for each faction you have met, where you stand with them (now, on the
// whole, and which way it is going, read.ts), every step of their quest you have done with its line, in the order you
// did them, and where the next one waits. No DOM: main.ts writes it on the page, the test reads it.
import { sections, TRAIL_REGIONS, type Journey } from "../journey.ts";
import { FACTION, factionsOf, nextStage, record } from "./engine.ts";
import { FACTIONS, type FactionId } from "./model.ts";
import { bandOf, reading, trendOf } from "./read.ts";

export interface Ledger {
  id: FactionId; name: string; calls: string;
  /** Where you stand, in a sentence: "Warm with you now, cool on the whole, and rising." */
  standing: string;
  done: { id: string; title: string; log: string }[];
  /** The next step and where it waits, or null once their quest is closed. */
  next: { title: string; where: string } | null;
}

const NOW = { cold: "Cold to you", cool: "Cool to you", even: "Even with you", warm: "Warm to you", close: "Close to you" } as const;
const PAST = { cold: "cold", cool: "cool", even: "even", warm: "warm", close: "close" } as const;
const WAY = { falling: "and falling", steady: "and steady", rising: "and rising" } as const;

/** The factions you have met, in the order you met them. */
export function ledgerOf(j: Journey): Ledger[] {
  const fs = factionsOf(j), done = record(j);
  return fs.met.filter((f) => FACTIONS.includes(f)).map((f) => {
    const r = reading(fs.by[f]), st = nextStage(j, f), g = st && TRAIL_REGIONS.find((x) => x.n === st.n), sec = g && sections(g)[st.k];
    return {
      id: f, name: FACTION[f].name, calls: FACTION[f].calls,
      standing: `${NOW[bandOf(r.now)]} now, ${PAST[bandOf(r.past)]} on the whole, ${WAY[trendOf(r.trend)]}.`,
      done: done.filter((d) => d.faction === f).map(({ id, title, log }) => ({ id, title, log })),
      next: st ? { title: st.title, where: [sec?.name, g?.name].filter(Boolean).join(", ") } : null,
    };
  });
}
