// A fight HUD skin: one look for the bars, the clock and the bind prompt over a fight.
// Each skin is one file in src/hud/skins/ (picked with ?hud=<id>); it gets a plain HudView each frame and
// returns the HUD's HTML. It never reads the sim: everything it may show is in HudView, built by viewOf.
import type { Field } from "../fields.ts";
import type { Match } from "../sim.ts";
import type { Tier } from "../tiers.ts";

export interface HudSide {
  id: string; name: string; fields: Field[]; tier: Tier;
  /** The beast's card picture (`art/<id>.jpg`, colour if there is one), or null. */
  art: string | null;
  hp: number; hpMax: number; launch: number;
  stamina: number; staminaMax: number; exhausted: boolean;
  energy: number; energyMax: number;
  flying: boolean; clipped: boolean; stunned: boolean; guarding: boolean;
  /** Hits this side has landed in a row without taking one back (resets when hit). */
  combo: number;
  massKg: number; heightM: number;
}
export interface HudHit { by: 0 | 1; damage: number; guarded: boolean; rear: boolean; field: Field; move: string; slot: string; age: number }
export interface HudView {
  tick: number;
  /** Seconds left on the round clock. */
  clock: number;
  sides: [HudSide, HudSide];
  /** Hits in the last two seconds, newest first, `age` in ticks. */
  hits: HudHit[];
  /** In a journey fight against a wild one that can be bound: the odds, ink left, the key and a note. */
  bind: { chance: number; ink: number; key: string; note: string } | null;
  /** The charge key's name, for a tip on the energy bar. */
  chargeKey: string;
  over: boolean;
}
export interface HudSkin {
  /** Matches the file name: skins/<nn>-<id>.ts. */
  id: string;
  /** A short name for the picker chip. */
  name: string;
  /** One line: the idea behind the look. */
  idea: string;
  /** CSS for this skin, every rule under `.hud[data-skin="<id>"]`. */
  css: string;
  render(v: HudView): string;
}

const HZ = 60;
/** Combo and recent-hit memory, kept across frames by whoever calls viewOf. */
export interface HudMemory { combo: [number, number]; hits: (Omit<HudHit, "age"> & { tick: number })[] }
export const newMemory = (): HudMemory => ({ combo: [0, 0], hits: [] });

/** Fold this tick's events into the memory (call once per sim step). */
export function remember(mem: HudMemory, m: Match) {
  for (const e of m.events) if (e.kind === "hit") {
    mem.hits.unshift({ by: e.by, damage: e.damage, guarded: e.guarded, rear: e.rear, field: e.field, move: e.move, slot: e.slot, tick: m.tick });
    if (!e.guarded && e.by !== e.on) { mem.combo[e.by]++; mem.combo[e.on] = 0; }
  }
  const old = m.tick - 2 * HZ;
  while (mem.hits.length && mem.hits[mem.hits.length - 1]!.tick < old) mem.hits.pop();
  if (mem.hits.length > 24) mem.hits.length = 24;
}

export interface ViewExtras { art: (id: string) => string | null; tier: (id: string) => Tier; bind: HudView["bind"]; chargeKey: string; roundSeconds?: number }
export function viewOf(m: Match, mem: HudMemory, x: ViewExtras): HudView {
  const sides = m.f.map((f, i): HudSide => ({
    id: f.c.id, name: f.c.name, fields: f.c.fields, tier: x.tier(f.c.id), art: x.art(f.c.id),
    hp: f.hp, hpMax: f.b.hp, launch: f.launch, stamina: f.stamina, staminaMax: f.b.stamina, exhausted: f.exhausted,
    energy: f.energy, energyMax: 100, flying: f.flying, clipped: f.clipped > 0, stunned: f.state === "stun", guarding: f.state === "guard",
    combo: mem.combo[i]!, massKg: f.c.massKg, heightM: f.c.heightM,
  })) as [HudSide, HudSide];
  return {
    tick: m.tick, clock: Math.max(0, Math.ceil((x.roundSeconds ?? 99) - m.tick / HZ)), sides,
    hits: mem.hits.map(({ tick, ...h }) => ({ ...h, age: m.tick - tick })), bind: x.bind, chargeKey: x.chargeKey, over: m.over,
  };
}

/** 0..100 with one decimal, for a bar's width. */
export const pct = (v: number, max: number) => (Math.min(1, Math.max(0, v / (max || 1))) * 100).toFixed(1);
