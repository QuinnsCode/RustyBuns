// Space against landing. Troops come down through the sky, so whoever holds it sets how many can
// land and how wide a front they get. A side that wins the orbit lands freely; one that rushes the
// planet through an enemy fleet gets a trickle, into one place, and fights out of that.
import type { Faction } from "../battle/contract.ts";
import type { SystemState, Where } from "./rules.ts";

export const WIDE_ORBIT = 3;   // ships that hold the sky over a world widen the front to every sector
export const OPEN_SKY = 4;     // transports a side can land under a sky nobody holds
export const SIEGE_TURNS = 2;  // every this many turns a side keeps the orbit, its landings through it shrink by one more
export const SEALED_BY = 3;    // enemy ships over a world that shut its landings out altogether
// The same four as one object, so a campaign (or a balance script) can play by other skies; absent, these.
export interface LandingRules { wideOrbit: number; openSky: number; siegeTurns: number; sealedBy: number }
export const LANDING: LandingRules = { wideOrbit: WIDE_ORBIT, openSky: OPEN_SKY, siegeTurns: SIEGE_TURNS, sealedBy: SEALED_BY };

export interface Cap { troops: number; wide: boolean }

// What a side can land on a world this turn: how many troops, and whether on any sector or only
// one new one (a beachhead: sectors it already holds don't count).
export function landingCap(s: SystemState, f: Faction, rules: LandingRules = LANDING): Cap {
  const foe = f === "marines" ? "wooka" : "marines";
  if (s.orbit === f) return { troops: Infinity, wide: s.fleets[f] >= rules.wideOrbit };
  if (s.orbit === foe) return { troops: Math.max(0, rules.sealedBy - s.fleets[foe] - Math.floor((s.held ?? 0) / rules.siegeTurns)), wide: false };
  return { troops: rules.openSky, wide: false };
}

interface Landing { faction: Faction; to: Where; count: number }

// How many of each landing gets down, in order. The rest turn back.
export function admitLandings(systems: Record<string, SystemState>, landings: Landing[], rules: LandingRules = LANDING): number[] {
  const used = new Map<string, number>(), beach = new Map<string, number>();
  return landings.map((t) => {
    const s = systems[t.to.system]!, key = `${t.faction}:${t.to.system}`, cap = landingCap(s, t.faction, rules);
    const x = s.sectors[t.to.sector]!, held = x.owner === t.faction || x.armies[t.faction] > 0;
    if (!cap.wide && !held) {
      if ((beach.get(key) ?? t.to.sector) !== t.to.sector) return 0;
      beach.set(key, t.to.sector);
    }
    const land = Math.min(t.count, cap.troops - (used.get(key) ?? 0));
    used.set(key, (used.get(key) ?? 0) + land);
    return Math.max(0, land);
  });
}
