// The amp's live chain, apart from the audio thread so a test can play it:
// settings in, a rig out (rebuilding only what changed), and the speaker limiter.
import { AMPS, DEFAULT_ROOM, PEDALS, boardLinks, buildRig, deskRig, type PedalDef } from "../circuit/amps.ts";
import { POWER_VOLTS, Rig, type Mod, type Netlist } from "@rustybuns/gear/circuit";
import type { AmpSettings } from "./messages.ts";

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
export interface Live { rig: Rig; chain: string; keys: string[]; mic: string; scale: number }

/** Each `Pot` part's turn, in netlist order (what `Rig.setPot` numbers them by). */
const potTurns = (net: Netlist): number[] => net.parts.flatMap((p) => (p.kind === "Pot" ? [p.at ?? 0.5] : []));
/** What a link is built from, its pots' turns left out: turning one (the wah's treadle, a bench board's knob) is a `setPot`, not a new circuit. */
const linkKey = (net: Netlist, mods: Mod[] = []) => JSON.stringify([{ ...net, parts: net.parts.map((p) => (p.kind === "Pot" ? { ...p, at: 0 } : p)) }, mods]);

/**
 * The rig for these settings. A different amp, a pedal in or out, or a new
 * oversampling builds a new chain; otherwise only links whose parts changed are
 * rebuilt (a tone knob: the tone stack; the pedal's knob or a part swap: the pedal, an LFO keeping its phase),
 * a moved mic makes a new impulse response, and pots, the power stage and its bias tremolo are just set.
 */
export function applySettings(s: AmpSettings, live: Live | null, sampleRate: number): Live {
  const amp = AMPS.find((a) => a.id === s.amp) ?? AMPS[0];
  const bench = s.bench;
  const def: PedalDef | undefined = s.pedal === "bench" && bench ? { id: "bench", name: "Bench", blurb: "", net: () => bench } : PEDALS.find((p) => p.id === s.pedal);
  // The loop's machines are switched and turned in place, never a new chain: a tape keeps its echoes.
  // A board plays in place of the one pedal: its pedals ahead of the amp, a split's sides side by side.
  const front = s.board ? boardLinks(s.board) : null;
  const pedal = !front && def ? { def, drive: s.drive, swaps: s.swaps } : undefined;
  const base = s.direct ? deskRig(pedal) : buildRig(amp, s.knobs, pedal, { ...DEFAULT_ROOM, mic: s.mic });
  const spec = { ...base, ...(front ? { links: [...front.links, ...base.links], blends: front.blends } : {}), loop: s.loop ?? [] };
  // A new shape (how many links, which run side by side) is a new chain; a split's blend is just set.
  const shape = front ? `${front.links.length}:${front.blends.map((b) => `${b.at}/${b.lanes.join(",")}`).join(";")}` : def?.id ?? "";
  const chain = `${s.direct ? "direct" : amp.id}|${shape}|${s.oversample}`, scale = s.direct ? LINE_SCALE : FULL_SCALE;
  const keys = spec.links.map((l) => linkKey(l.net, l.mods)), mic = JSON.stringify(s.mic);
  if (!live || live.chain !== chain) return { rig: new Rig(spec, sampleRate, s.oversample), chain, keys, mic, scale };
  if (mic !== live.mic && !s.direct) live.rig.setMic(s.mic);
  spec.links.forEach((l, i) => {
    if (keys[i] !== live.keys[i]) live.rig.setLink(i, l.net, l.mods);
    else potTurns(l.net).forEach((at, p) => live.rig.setPot(i, p, at));
    live.rig.setGain(i, l.gain ?? 1);
  });
  live.rig.setPower(spec.power);
  live.rig.setTrem(spec.output?.trem);
  live.rig.setNoise(spec.noise ?? 0);
  live.rig.setLoop(spec.loop);
  (spec.blends ?? []).forEach((b, i) => live.rig.setMix(i, b.mix));
  return { rig: live.rig, chain, keys, mic, scale };
}
