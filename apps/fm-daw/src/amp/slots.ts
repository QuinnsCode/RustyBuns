// What can go on Q Amp's pedalboard, and a board as the page saves it and the
// audio thread reads it (board.ts runs it). No circuits in here: the page imports it.
import { AMPS, PEDALS, type AmpDef } from "../circuit/amps.ts";

/** The amp a settings id names, or the first. */
export const ampOf = (id: string): AmpDef => AMPS.find((a) => a.id === id) ?? AMPS[0];

/** The amp's own slot on the board: pedals before it are in front, pedals after it are in the loop. */
export const AMP_SLOT = "amp";

export interface EffectDef {
  id: string;
  name: string;
  blurb: string;
  /** Its one knob's label. */
  knob: string;
  /** Where it starts on a fresh board, 0 to 10. */
  dflt: number;
  /** It makes two channels out of one: everything after it is stereo. */
  stereo: boolean;
}

/** Every effect a board can hold, in the order a fresh board lays them out (the amp slot goes before Q Space). */
export const EFFECTS: EffectDef[] = [
  ...PEDALS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, knob: "Drive", dflt: { drive: 3, dist: 5, fuzz: 7 }[p.id] ?? 5, stereo: false })),
  { id: "space", name: "Q Space", blurb: "A ping-pong delay into a hall reverb, wide and slowly turning. Stereo from here on. In the loop it sounds like a studio; in front of the amp, the tubes crunch the echoes too.", knob: "Amount", dflt: 4, stereo: true },
];

/** One slot as the settings send it: which effect, its footswitch, its knob. */
export interface Slot { id: string; on: boolean; knob: number }

/** A fresh board: every pedal off in front, the amp, then Q Space off in the loop. */
export function freshBoard(): Slot[] {
  const slot = (e: EffectDef): Slot => ({ id: e.id, on: false, knob: e.dflt });
  return [...EFFECTS.filter((e) => !e.stereo).map(slot), { id: AMP_SLOT, on: true, knob: 0 }, ...EFFECTS.filter((e) => e.stereo).map(slot)];
}

/**
 * The board in `order`, every effect once and the amp once, whatever came in:
 * unknown ids dropped, repeats dropped, missing ones added where a fresh board has them.
 */
export function tidyBoard(slots: Slot[]): Slot[] {
  const seen = new Set<string>(), out: Slot[] = [];
  const known = new Set([AMP_SLOT, ...EFFECTS.map((e) => e.id)]);
  for (const s of slots) if (known.has(s.id) && !seen.has(s.id)) { seen.add(s.id); out.push(s.id === AMP_SLOT ? { ...s, on: true } : s); }
  const fresh = freshBoard();
  fresh.forEach((s, i) => {
    if (seen.has(s.id)) return;
    // Put it after whatever comes before it on a fresh board.
    const before = fresh.slice(0, i).reverse().find((b) => seen.has(b.id));
    out.splice(before ? out.findIndex((o) => o.id === before.id) + 1 : 0, 0, s);
    seen.add(s.id);
  });
  return out;
}
