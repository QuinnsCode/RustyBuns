// The amp's live chain, apart from the audio thread so a test can play it:
// settings in, a rig out (rebuilding only what changed), and the speaker limiter.
import { AMPS, DEFAULT_ROOM, PEDALS, boardLinks, buildRig, deskRig, type PedalDef } from "../circuit/amps.ts";
import { POWER_VOLTS, Rig, splitRig, type Blend, type Link, type Mod, type Netlist, type RigSpec, type Slot } from "@rustybuns/gear/circuit";
import type { AmpSettings, ChainSlot } from "./messages.ts";
import { MACHINES } from "../circuit/circuits.ts";

/** Volts at the speaker for full scale: the power stage's ceiling plus the cabinet's bumps. */
export const FULL_SCALE = POWER_VOLTS * 1.5;
const CEILING = 0.89; // −1 dBFS

/** Under 0.7 untouched, then a soft knee that never passes −1 dBFS. NaN comes out as silence. */
export function limit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const a = Math.abs(x);
  if (a <= 0.7) return x;
  return Math.sign(x) * (0.7 + (CEILING - 0.7) * Math.tanh((a - 0.7) / (CEILING - 0.7)));
}

/** Volts out of a pedal or machine for full scale, when it goes straight into a desk (`direct`). */
export const LINE_SCALE = 1;

/** The rig playing now, what it was built from, and its volts for full scale. */
export interface Live { rig: Rig; chain: string; keys: string[]; mic: string; scale: number; where?: ChainAt }

/**
 * One part of a rig split across threads (`splitRig`): which, of the parts these `cuts` make, and (built on a
 * worker) the volts the part ahead rests at.
 */
export interface Part { cuts: number[]; index: number; inRest?: number }

/** Each `Pot` part's turn, in netlist order (what `Rig.setPot` numbers them by). */
const potTurns = (net: Netlist): number[] => net.parts.flatMap((p) => (p.kind === "Pot" ? [p.at ?? 0.5] : []));
/** What a link is built from, its pots' turns left out: turning one (the wah's treadle, a bench board's knob) is a `setPot`, not a new circuit. */
const linkKey = (net: Netlist, mods: Mod[] = []) => JSON.stringify([{ ...net, parts: net.parts.map((p) => (p.kind === "Pot" ? { ...p, at: 0 } : p)) }, mods]);

/**
 * The rig for these settings. A different amp, a pedal in or out, or a new
 * oversampling builds a new chain; otherwise only links whose parts changed are
 * rebuilt (a tone knob: the tone stack; the pedal's knob or a part swap: the pedal, an LFO keeping its phase),
 * a moved mic makes a new impulse response, and pots, the power stage and its bias tremolo are just set.
 * With `part`, the same for just that part of the rig split across threads.
 * A pedalboard (`chain`): the same slots in the same order turn in place (a knob, a part swap, a machine's
 * knobs); a footswitch, a reorder or another amp is a new rig built on the last one, so every stage it still
 * has carries over: the tape keeps its echoes, the tubes their state.
 */
export function applySettings(s: AmpSettings, live: Live | null, sampleRate: number, part?: Part): Live {
  const { spec: whole, shape, scale, where: at } = rigSpec(s);
  const parts = part?.cuts.length ? splitRig(whole, part.cuts) : [whole];
  const index = part?.cuts.length ? part.index : 0, last = index === parts.length - 1;
  const spec: RigSpec = { ...parts[index], inRest: part?.inRest };
  const chain = `${shape}|${s.oversample}|${parts.length > 1 ? `${part?.cuts.join(",")}#${index}` : ""}`;
  const keys = spec.links.map((l) => linkKey(l.net, l.mods)), mic = JSON.stringify(s.mic), slots = spec.slots;
  // A slot's place in the rig is only this thread's when the rig isn't split.
  const where = parts.length > 1 ? undefined : at;
  if (!live || live.chain !== chain) return { rig: new Rig(spec, sampleRate, s.oversample, slots ? live?.rig : undefined), chain, keys, mic, scale, where };
  if (last && mic !== live.mic && !s.direct) live.rig.setMic(s.mic);
  spec.links.forEach((l, i) => {
    if (keys[i] !== live.keys[i]) live.rig.setLink(i, l.net, l.mods);
    else potTurns(l.net).forEach((at, p) => live.rig.setPot(i, p, at));
    live.rig.setGain(i, l.gain ?? 1);
  });
  live.rig.setPower(spec.power);
  live.rig.setTrem(spec.output?.trem);
  live.rig.setNoise(spec.noise ?? 0);
  if (slots) slots.forEach((sl, i) => { if ("machine" in sl) live.rig.setMachine(i, sl.machine); });
  else if (last) live.rig.setLoop(spec.loop ?? []);
  (spec.blends ?? []).forEach((b, i) => live.rig.setMix(i, b.mix));
  return { rig: live.rig, chain, keys, mic, scale, where };
}

/** The whole rig these settings make, what decides whether a change needs a new chain, and its volts for full scale. */
export function rigSpec(s: AmpSettings): { spec: RigSpec; shape: string; scale: number; where?: ChainAt } {
  if (s.chain) { const c = chainSpec(s, s.chain); return { spec: c.spec, shape: `chain|${c.order}`, scale: s.direct ? LINE_SCALE : FULL_SCALE, where: c.where }; }
  const amp = AMPS.find((a) => a.id === s.amp) ?? AMPS[0];
  const bench = s.bench;
  const def: PedalDef | undefined = s.pedal === "bench" && bench ? { id: "bench", name: "Bench", blurb: "", net: () => bench } : PEDALS.find((p) => p.id === s.pedal);
  // The loop's machines are switched and turned in place, never a new chain: a tape keeps its echoes.
  // A board plays in place of the one pedal: its pedals ahead of the amp, a split's sides side by side.
  const front = s.board ? boardLinks(s.board) : null;
  const pedal = !front && def ? { def, drive: s.drive, swaps: s.swaps } : undefined;
  const base = s.direct ? deskRig(pedal) : buildRig(amp, s.knobs, pedal, { ...DEFAULT_ROOM, mic: s.mic });
  const spec = { ...base, ...(front ? { links: [...front.links, ...base.links], blends: front.blends } : {}), loop: s.loop ?? [], machines: MACHINES };
  // A new shape (how many links, which run side by side) is a new chain; a split's blend is just set.
  const shape = `${s.direct ? "direct" : amp.id}|${front ? `${front.links.length}:${front.blends.map((b) => `${b.at}/${b.lanes.join(",")}`).join(";")}` : def?.id ?? ""}`;
  return { spec, shape, scale: s.direct ? LINE_SCALE : FULL_SCALE };
}

/** Where each chain slot runs in the rig (-1: nowhere, an unknown pedal or the amp on a desk), and the amp's slot. */
export interface ChainAt { at: number[]; amp: number }

/**
 * A pedalboard as a rig: each slot its own stage, the loop from the slot after the amp's, the amp added last if it
 * isn't on the board. `order` names the slots in order: the same order is the same rig, turned in place.
 */
function chainSpec(s: AmpSettings, slotsIn: readonly ChainSlot[]): { spec: RigSpec; where: ChainAt; order: string } {
  const amp = AMPS.find((a) => a.id === s.amp) ?? AMPS[0];
  const base = s.direct ? deskRig() : buildRig(amp, s.knobs, undefined, { ...DEFAULT_ROOM, mic: s.mic });
  const links: Link[] = [], blends: Blend[] = [], slots: Slot[] = [], at: number[] = [], order: string[] = [];
  let send: number | undefined, ampAt = -1;
  const put = (ls: Link[], bs: Blend[]) => { blends.push(...bs.map((b) => ({ ...b, at: b.at + links.length }))); links.push(...ls); slots.push({ links: ls.length }); };
  const putAmp = () => { ampAt = slots.length; order.push("amp"); put(base.links, []); send = slots.length; };
  for (const c of slotsIn) {
    if ("amp" in c) {
      if (ampAt >= 0 || s.direct) at.push(-1); else { at.push(slots.length); putAmp(); }
    } else if ("machine" in c) {
      at.push(slots.length);
      order.push(`${c.machine.kind}${c.stereo ? ":stereo" : ""}`);
      slots.push({ machine: c.machine, stereo: c.stereo });
    } else {
      const f = boardLinks([c]);
      if (!f.links.length) { at.push(-1); continue; }
      at.push(slots.length);
      order.push("split" in c ? `split:${c.split.map((side) => side.map((p) => p.pedal).join(",")).join("|")}` : c.pedal);
      put(f.links, f.blends);
    }
  }
  if (ampAt < 0 && !s.direct) putAmp();
  // The loop machines' tubes and op-amp come from their boards (circuits/spring.tsx, tape.tsx).
  const spec: RigSpec = { ...base, links, blends, slots, send, loop: undefined, machines: MACHINES };
  return { spec, where: { at, amp: ampAt }, order: `${s.direct ? "direct" : amp.id}|${order.join(">")}` };
}

/** Each chain slot's share of the time `ms` of audio took, from the rig's `loads` (the amp's with its power stage and cab). */
export function chainLoads(loads: readonly number[], where: ChainAt, ms: number): number[] {
  const tail = loads[loads.length - 1] ?? 0;
  return where.at.map((i) => (i < 0 ? 0 : ((loads[i] ?? 0) + (i === where.amp ? tail : 0)) / ms));
}
