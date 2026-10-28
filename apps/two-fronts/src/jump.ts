// Jump to a state: the address (or `window.twoFronts.jump`) names a world, a side, a hero, the balance assist
// and how far into the fight to start, and the page drops straight into that battle. Pure: no DOM, no
// sim, so a test or a script can build the same spec the page plays.
import type { BattleSpec, Faction, MatchMode, SectorKind, Side } from "./battle/contract.ts";
import { forHuman } from "./battle/handicap.ts";

export const WORLDS: readonly SectorKind[] = ["shield", "canyon", "capital", "cannon", "spaceport", "jungle"];
// The names people use for the worlds, beside the sim's own.
const ALIASES: Record<string, SectorKind> = {
  forest: "shield", desert: "canyon", city: "capital", "ruined-city": "capital", ruins: "capital", beach: "cannon", station: "spaceport", space: "spaceport",
};
export const sectorOf = (name: string | null | undefined): SectorKind | null =>
  WORLDS.find((w) => w === name) ?? (name ? ALIASES[name] ?? null : null);

const MODES: readonly MatchMode[] = ["conquest", "assault", "hill", "holdout", "escort"];

export interface Jump {
  world: SectorKind;
  side: Side;               // the side the person fights on
  hero: Faction;            // marines or wooka; the other faction is the AI's
  assist: boolean;          // the quiet balance help: the handicap on the AI and the sim's squad cover and slack
  near: number;             // seconds the AI fights before the person drops in (0 = from the spawn)
  mode: MatchMode;
  map?: string;             // a big map for the sector, e.g. "yards" on the station
  end?: "win" | "loss";     // finish the battle for the hero this many seconds after the drop
  endAfter: number;
  brief: boolean;           // show the briefing first, instead of dropping straight in
  seed: number;
}

export const NEAR_SECONDS = 45;

// `?battle=1&sector=desert&side=wooka` also works.
// `?battle=1&world=desert&side=attacker&hero=wooka&assist=off&near=1&end=win`. Null when the address asks for no battle.
export function parseJump(search: string): Jump | null {
  const q = new URLSearchParams(search);
  if (!q.has("battle")) return null;
  // `side` is a position (attacker, defender) or the faction fought as (wooka attacks, marines hold).
  const asked = q.get("side"), fought = asked === "wooka" || asked === "marines" ? asked : null;
  const side: Side = asked === "attacker" || fought === "wooka" ? "attacker" : "defender";
  const near = q.get("near");
  const mode = q.get("mode"), end = q.get("end"), seed = Number(q.get("seed")), after = Number(q.get("after"));
  return {
    world: sectorOf(q.get("world") ?? q.get("sector")) ?? "shield", side,
    hero: fought ?? (q.get("hero") === "wooka" ? "wooka" : q.get("hero") === "marines" ? "marines" : side === "attacker" ? "wooka" : "marines"),
    assist: q.get("assist") !== "off",
    near: near === null || near === "0" || near === "off" ? 0 : Number(near) > 1 ? Number(near) : NEAR_SECONDS,
    mode: MODES.find((m) => m === mode) ?? "conquest",
    map: q.get("map") || undefined,
    end: end === "win" || end === "loss" ? end : undefined,
    endAfter: Number.isFinite(after) && after > 0 ? after : 3,
    brief: q.get("brief") === "1",
    seed: Number.isFinite(seed) && q.has("seed") ? seed : Math.floor(Math.random() * 2 ** 31),
  };
}

// The quick-play fight on Doren, whichever sector and side: the attacker comes with a tank, the defender
// holds with a walker, a speeder, two strikes and a drop of reinforcements. With the assist on the AI side
// fields what the human handicap says (`handicap: false` keeps the assist but not that); off, forces are as the table shows and the sim leans neither way.
export function jumpSpec(j: Pick<Jump, "world" | "side" | "hero" | "assist" | "mode" | "seed"> & { map?: string; handicap?: boolean }): BattleSpec {
  const foe: Faction = j.hero === "wooka" ? "marines" : "wooka";
  const spec: BattleSpec = {
    id: `jump-${j.seed}`, turn: 0, system: "Doren", sector: j.world,
    factions: j.side === "attacker" ? { attacker: j.hero, defender: foe } : { attacker: foe, defender: j.hero },
    hero: j.side, heroLevel: 1,
    armies: { attacker: 4, defender: 3 }, tickets: { attacker: 200, defender: 150 },
    vehicles: { attacker: { tank: 1 }, defender: { walker: 1, speeder: 1 } }, strikes: { attacker: 0, defender: 2 },
    reinforcements: { attacker: 0, defender: 30 }, turrets: 2,
    ...(j.mode !== "conquest" && { mode: j.mode }), ...(j.map && { map: j.map }), ...(!j.assist && { assist: false as const }), seed: j.seed,
  };
  return j.handicap ?? j.assist ? forHuman(spec) : spec;
}
