// A jump to one faction step (`?faction=office.3`), for the manual run and an agent's harness: a fresh journey walked
// through the real engine to the moment that step waits behind you. Every region before its own is cleared and its
// mythic bound (the Jersey Devil carries you over the gorge, as it would), its own region is cleared up to the step's
// stone, and the faction's earlier steps are played through with the straight reply and a won fight. The other two
// factions are not met. No DOM: main.ts enters the world with it.
import { REGIONS } from "../regions.ts";
import { bind, clearSection, mythicOf, newJourney, PICKS, SECTIONS, STARTERS, type Journey } from "../journey.ts";
import { approach, FACTION, fought, reply, sectionCleared, type Ctx } from "./engine.ts";
import { FACTIONS, type FactionId } from "./model.ts";
import type { Stage } from "./model.ts";

const HOUR = 3_600_000;

/** The faction and step `id` names ("office.3"), or null. */
export function stepOf(id: string): { faction: FactionId; stage: Stage } | null {
  const f = FACTIONS.find((x) => id.startsWith(`${x}.`)), stage = f && FACTION[f].quest.find((s) => s.id === id);
  return f && stage ? { faction: f, stage } : null;
}

/** A journey at step `id`, waiting for you at `now`, or null for a step there is no such. */
export function jumpTo(id: string, now = Date.now()): Journey | null {
  const at = stepOf(id);
  const j = at && newJourney(STARTERS.slice(0, PICKS), now - 200 * HOUR);
  if (!at || !j) return null;
  const { faction: f, stage } = at;
  j.nights = Math.max(j.nights ?? 0, 1); // past the Pine Barrens' first night, as every step after it is
  let t = now - 100 * HOUR;
  const walk = (n: number, upTo: number) => { for (let k = 0; k <= upTo; k++) if ((j.cleared[n] ?? 0) <= k) { clearSection(j, n, k); sectionCleared(j, n, k, (t += HOUR)); } };
  for (const s of FACTION[f].quest) {
    const last = s.id === stage.id;
    for (let n = 1; n < s.n; n++) if ((j.cleared[n] ?? 0) < SECTIONS) {
      walk(n, SECTIONS - 1);
      const g = REGIONS.find((r) => r.n === n);
      if (g) bind(j, mythicOf(g).id, 5 + n * 3, g.name, t);
    }
    walk(s.n, s.k);
    if (last) break;
    const ctx: Ctx = { now: (t += HOUR), n: s.n, k: s.k + 1 };
    const scene = approach(j, f, ctx);
    const straight = scene?.replies.find((r) => r.style === "straight") ?? scene?.replies[0];
    const got = scene && straight ? reply(j, scene, straight.id, ctx) : null;
    if (got?.team) fought(j, f, s.id, true, ctx);
  }
  return j;
}
