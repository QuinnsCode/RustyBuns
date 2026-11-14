// A fight HUD skin: one look for the bars, the clock and the bind prompt over a fight.
// Each skin is one file in src/hud/skins/ (picked with ?hud=<id>); it gets a plain HudView each frame and
// returns the HUD's HTML. It never reads the sim: everything it may show is in HudView, built by viewOf.
import type { Field } from "../fields.ts";
import { esc } from "@rustybuns/util";
import { foeOf, type Match } from "../sim.ts";
import type { Tier } from "../tiers.ts";

export interface HudSide {
  id: string; name: string; fields: Field[]; tier: Tier;
  /** The beast's card picture (`art/<id>.jpg`, colour if there is one), or null. */
  art: string | null;
  hp: number; hpMax: number; launch: number;
  /** Where the HP bar was a moment ago: the chunk just lost shows between it and `hp`, then drains away. */
  hpTrail: number;
  /** HP plus the red part of what's been lost: it comes back if this side stays clear of hits (sim RED). */
  hpRed: number;
  /** On a journey, the line-up as lives: how many, which are down, and which one is fighting. Null in a quick fight. */
  party: Party | null;
  /** A bot plays this side (the label under a portrait says CPU). */
  bot: boolean;
  stamina: number; staminaMax: number; exhausted: boolean;
  energy: number; energyMax: number;
  flying: boolean; clipped: boolean; stunned: boolean; guarding: boolean;
  /** Hits this side has landed in a row without taking one back (resets when hit). */
  combo: number;
  massKg: number; heightM: number;
}
export interface Party { size: number; down: number[]; up: number }
export interface HudHit { by: number; damage: number; guarded: boolean; rear: boolean; field: Field; move: string; slot: string; age: number }
/** Someone else in a team fight (#4401): a small bar of their own beside the skin's two, on their team's side. */
export interface HudMate { name: string; art: string | null; hp: number; hpMax: number; ours: boolean; down: boolean }
export interface HudView {
  tick: number;
  /** Seconds left on the round clock. */
  clock: number;
  /** The two the skin draws: one on one, the fighters in order; in a team fight, you (or a teammate still up, once
   * you're down) and the foe you're locked on (`foeOf`). */
  sides: [HudSide, HudSide];
  /** In a team fight everyone else, your team first; empty one on one. */
  crew: HudMate[];
  /** Hits in the last two seconds, newest first, `age` in ticks. */
  hits: HudHit[];
  /** In a journey fight against a wild one that can be bound: the odds, ink left, the key and a note. */
  bind: { chance: number; ink: number; key: string; note: string } | null;
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
export interface HudMemory { combo: number[]; hits: (Omit<HudHit, "age"> & { tick: number })[]; trail: number[]; wait: number[] }
export const newMemory = (): HudMemory => ({ combo: [0, 0], hits: [], trail: [-1, -1], wait: [0, 0] });
/** Ticks the lost chunk holds before it drains, and how much of the bar it drains a second. */
const TRAIL_HOLD = 36, TRAIL_DRAIN = 0.7;

/** Fold this tick's events into the memory (call once per sim step). */
export function remember(mem: HudMemory, m: Match) {
  for (const e of m.events) if (e.kind === "hit") {
    mem.hits.unshift({ by: e.by, damage: e.damage, guarded: e.guarded, rear: e.rear, field: e.field, move: e.move, slot: e.slot, tick: m.tick });
    if (!e.guarded && e.by !== e.on) { mem.combo[e.by] = (mem.combo[e.by] ?? 0) + 1; mem.combo[e.on] = 0; }
  }
  m.f.forEach((f, i) => {
    const hurt = m.events.some((e) => e.kind === "hit" && e.on === i);
    if (hurt) mem.wait[i] = TRAIL_HOLD;
    const trail = mem.trail[i] ?? -1, wait = mem.wait[i] ?? 0;
    if (f.hp >= trail) mem.trail[i] = f.hp;
    else if (wait > 0) mem.wait[i] = wait - 1;
    else mem.trail[i] = Math.max(f.hp, trail - (f.b.hp * TRAIL_DRAIN) / HZ);
  });
  const old = m.tick - 2 * HZ;
  while (mem.hits.length && mem.hits[mem.hits.length - 1]!.tick < old) mem.hits.pop();
  if (mem.hits.length > 24) mem.hits.length = 24;
}

/** `party` is by the two sides; `bots` is by fighter, which of them a bot plays; `you` is your fighter (seat). */
export interface ViewExtras { art: (id: string) => string | null; tier: (id: string) => Tier; bind: HudView["bind"]; roundSeconds?: number; party?: [Party | null, Party | null]; bots?: boolean[]; you?: number }
/** The two fighters the skin draws, by index: see HudView `sides`. */
export function pairOf(m: Match, you = 0): [number, number] {
  if (m.f.length <= 2) return [0, 1];
  const team = m.f[you]!.team, up = m.f[you]!.down ? m.f.findIndex((f) => f.team === team && !f.down) : you, me = up < 0 ? you : up;
  // With every foe out (the fight's last frame), foeOf has no one left: show the other team's first.
  const foe = foeOf(m, me);
  return [me, m.f[foe]!.team !== m.f[me]!.team ? foe : m.f.findIndex((f) => f.team !== m.f[me]!.team)];
}
export function viewOf(m: Match, mem: HudMemory, x: ViewExtras): HudView {
  const pair = pairOf(m, x.you), team = m.f[pair[0]]!.team;
  const side = (i: number, k: number): HudSide => { const f = m.f[i]!; return {
    id: f.c.id, name: f.c.name, fields: f.c.fields, tier: x.tier(f.c.id), art: x.art(f.c.id),
    hp: f.hp, hpMax: f.b.hp, launch: f.launch, hpTrail: Math.min(f.b.hp, Math.max(f.hp, mem.trail[i] ?? -1)), hpRed: Math.min(f.b.hp, f.hp + f.red), party: x.party?.[k] ?? null, bot: x.bots?.[i] ?? k === 1, stamina: f.stamina, staminaMax: f.b.stamina, exhausted: f.exhausted,
    energy: f.energy, energyMax: 100, flying: f.flying, clipped: f.clipped > 0, stunned: f.state === "stun", guarding: f.state === "guard",
    combo: mem.combo[i] ?? 0, massKg: f.c.massKg, heightM: f.c.heightM,
  }; };
  const crew = m.f.flatMap((f, i): HudMate[] => (pair.includes(i) ? [] : [{ name: f.c.name, art: x.art(f.c.id), hp: f.hp, hpMax: f.b.hp, ours: f.team === team, down: f.down }]))
    .sort((a, b) => Number(b.ours) - Number(a.ours));
  return {
    tick: m.tick, clock: Math.max(0, Math.ceil((x.roundSeconds ?? 99) - m.tick / HZ)), sides: [side(pair[0], 0), side(pair[1], 1)], crew,
    hits: mem.hits.map(({ tick, ...h }) => ({ ...h, age: m.tick - tick })), bind: x.bind, over: m.over,
  };
}

/** 0..100 with one decimal, for a bar's width. */
export const pct = (v: number, max: number) => (Math.min(1, Math.max(0, v / (max || 1))) * 100).toFixed(1);

/** The team strip under any skin (#4401): a small bar per fighter in `crew`, yours down the left, theirs down the right,
 * a downed one greyed. Nothing one on one. Styled in styles.css (`.hud .crew`), so it is the same whatever the skin. */
export function crewHtml(v: HudView): string {
  if (!v.crew.length) return "";
  const mate = (c: HudMate) => `<li class="${c.down ? "down" : ""}" title="${esc(c.name)}${c.down ? ", out of the fight" : ""}">${c.art ? `<span class="crew-pic" style="background-image:url('${esc(c.art)}')"></span>` : `<span class="crew-pic">${esc(c.name.slice(0, 1))}</span>`}<span class="crew-body"><span class="crew-name">${esc(c.name)}</span><span class="crew-hp"><i style="width:${c.down ? 0 : pct(c.hp, c.hpMax)}%"></i></span></span></li>`;
  const col = (ours: boolean) => { const cs = v.crew.filter((c) => c.ours === ours); return cs.length ? `<ul class="crew ${ours ? "ours" : "theirs"}">${cs.map(mate).join("")}</ul>` : ""; };
  return col(true) + col(false);
}
