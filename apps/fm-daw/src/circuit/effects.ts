// Circuit effects (ANALOG.md section 3): a phaser, a vibe, an optical tremolo, a wah,
// an envelope wah, an optical compressor, an octave up and a germanium fuzz, each a
// tscircuit board in `circuits/<pedal id>.tsx`. Their moving parts are drawn as what
// moves (a JFET's channel, an LDR under a lamp or in a vactrol, a pot under a foot) and
// read as `VarR`s through `moved`: the control a rig `Mod` sets, and the range in ohms.
// No netlist is written here: this file says what moves, what the knob turns, and the
// player's part swaps. Each also reads another copy of its board as `json` (Q Builder's remake, to retest it).
import type { Netlist } from "@rustybuns/gear/circuit";
import { boardToNetlist, type BoardOptions } from "./tscircuit.ts";
import { BOARDS, swapOptions, type EffectBoard, type Swaps } from "./circuits.ts";

const OPAMPS = ["U1", "U2", "U3", "U4", "U5", "U6"];
const each = (names: string[], ctl: string, hi: number, lo: number) => Object.fromEntries(names.map((n) => [n, { ctl, hi, lo }]));
const effect = (board: EffectBoard, swaps: Swaps | undefined, json: unknown, o: BoardOptions): Netlist => {
  const s = swapOptions(board, swaps, json);
  return boardToNetlist(json ?? BOARDS[board], { ...o, diodes: s.diodes, values: { ...s.values, ...o.values } });
};

/**
 * Phaser: four all-pass stages whose resistors are JFET channels, all on one gate
 * voltage (control "gate", an LFO). Mixed with the dry signal, two notches sweep;
 * some of the last stage is fed back in (R16) to sharpen them.
 */
export const phaser = (swaps?: Swaps, json?: unknown): Netlist => effect("phase", swaps, json, { linear: OPAMPS, moved: each(["Q1", "Q2", "Q3", "Q4"], "gate", 40e3, 2.5e3) });

/**
 * Vibe: four phase-shift stages, each a different capacitor, their LDRs all under
 * one lamp (control "lamp"). The lamp heats faster than it cools, so the sweep
 * lingers at the dark end: the lopsided throb, set by the `Mod`'s lags.
 */
export const vibe = (swaps?: Swaps, json?: unknown): Netlist => effect("vibe", swaps, json, { linear: OPAMPS, moved: each(["LDR1", "LDR2", "LDR3", "LDR4"], "lamp", 250e3, 4e3) });

/** Optical tremolo: a series resistor and an LDR to ground (control "led"), buffered. The LDR's slow recovery softens each dip's back edge. */
export const opticalTremolo = (swaps?: Swaps, json?: unknown): Netlist => effect("trem", swaps, json, { linear: ["U1"], moved: each(["U2"], "led", 1e6, 600) });

/**
 * Wah: a 0.5 H inductor and a small capacitor ring at a peak; a second capacitor
 * hangs off an inverting stage whose gain is the treadle pot, so it looks
 * (1 + gain) times bigger (Miller) and pulls the peak down: heel ~550 Hz, toe ~1.8 kHz.
 * `treadle` 0 (heel) to 1 (toe) turns RV1 (220k), so turning it is a `setPot` that
 * glides, never a new circuit: an expression pedal or a MIDI CC rocks it.
 */
export const wah = (treadle = 0.5, swaps?: Swaps, json?: unknown): Netlist => effect("wah", swaps, json, { linear: ["U1", "U2", "U3"], knobs: { RV1: (1 - treadle) ** 2 } });

/** Envelope wah: the wah with a vactrol in the treadle's place, its LED lit by how hard you play (control "foot"). */
export const envelopeWah = (swaps?: Swaps, json?: unknown): Netlist => effect("autowah", swaps, json, { linear: ["U1", "U2", "U3"], moved: each(["U4"], "foot", 220e3, 100) });

/**
 * Optical compressor: a series resistor and an LDR to ground ahead of an op-amp
 * gain stage; the stage's output lights the LED (control "led", an envelope
 * `Mod`) that darkens the LDR. Feedback: the louder it gets, the more it is
 * turned down, and the LDR's slow recovery is the smooth release. `sustain` 0 to 1 is the stage's gain (RV1).
 */
export const opticalComp = (sustain = 0.5, swaps?: Swaps, json?: unknown): Netlist =>
  effect("comp", swaps, json, { moved: each(["U2"], "led", 2e6, 300), values: { RV1: 10e3 + sustain ** 2 * 300e3 } });

/**
 * Octave up: a diode-clipped op-amp fuzz, an inverter beside it, and two diodes
 * keeping whichever is higher. Folding the negative half up doubles the pitch;
 * the fuzz first squares the wave so the fold is clean. `fuzz` 0 to 1 (RV1).
 */
export const octaveUp = (fuzz = 0.6, swaps?: Swaps, json?: unknown): Netlist => effect("octave", swaps, json, { linear: ["U2"], values: { RV1: 10e3 + fuzz ** 2 * 200e3 } });

/** Q Germ's transistors at `celsius`: germanium's saturation and leakage both double every 10 °C. */
export function germaniumAt(celsius: number): Pick<BoardOptions, "germanium" | "bjt"> {
  const warm = 2 ** ((celsius - 25) / 10);
  const ge = { is: 2e-6 * warm, bf: 90, br: 4, leak: 5e-6 * warm };
  return { germanium: ["Q1", "Q2"], bjt: { Q1: ge, Q2: ge } };
}

/**
 * Two-transistor germanium fuzz: PNP on a negative supply, the second stage's
 * emitter feeding the first one's base for bias. Germanium leaks, and the leak
 * doubles every 10 °C: `celsius` moves the bias, and with it the fuzz from
 * gated and spitty (cold) to smooth and then mushy (hot).
 */
export function germaniumFuzz(celsius = 25, swaps?: Swaps, json?: unknown): Netlist {
  return effect("germ", swaps, json, { supplies: { V_NEG: -9 }, ...germaniumAt(celsius) });
}
