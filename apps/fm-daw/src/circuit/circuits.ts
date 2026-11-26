// Pedals and tube-amp pieces, each a tscircuit board in `circuits/*.tsx` from a
// textbook topology. Values are starting points to tune by ear, not copies of any
// one product. The netlist comes from the board (tscircuit.ts); this file only
// says which part each knob turns, and which parts a player can swap.
// Pedals run on a split supply (op-amp rails ±4 V around ground) instead of a
// 9 V battery and a 4.5 V bias divider: the same circuit, minus the bias parts.
import type { MachineCircuits, Netlist } from "@rustybuns/gear/circuit";
import { DIODE_PARTS, boardToNetlist, readBoard, type BoardOptions, type Junction } from "./tscircuit.ts";
import dist from "../../circuits/dist.circuit.json";
import drive from "../../circuits/drive.circuit.json";
import fuzzBoard from "../../circuits/fuzz.circuit.json";
import triode from "../../circuits/triode.circuit.json";
import tone from "../../circuits/tone.circuit.json";
import phase from "../../circuits/phase.circuit.json";
import vibe from "../../circuits/vibe.circuit.json";
import trem from "../../circuits/trem.circuit.json";
import wah from "../../circuits/wah.circuit.json";
import autowah from "../../circuits/autowah.circuit.json";
import comp from "../../circuits/comp.circuit.json";
import octave from "../../circuits/octave.circuit.json";
import germ from "../../circuits/germ.circuit.json";
import spring from "../../circuits/spring.circuit.json";
import tape from "../../circuits/tape.circuit.json";

/** Each board's circuit JSON, read through `readBoard` before anything trusts it. */
export const BOARDS = { dist, drive, fuzz: fuzzBoard, triode, tone, phase, vibe, trem, wah, autowah, comp, octave, germ, spring, tape };
/** The effects' boards (effects.ts), named by their pedals' ids. */
export type EffectBoard = "phase" | "vibe" | "trem" | "wah" | "autowah" | "comp" | "octave" | "germ";
export type BoardId = keyof typeof BOARDS;

// ---- part swaps ----

/** What can sit in a clipper socket: the part (a `DIODE_PARTS` number, '' for none) and its junction. */
const diode = (part: string): { part: string; junction: Junction } => {
  const junction = DIODE_PARTS[part];
  if (!junction) throw new Error(`no diode part `);
  return { part, junction };
};
export const CLIPPERS = {
  silicon: { label: "Silicon", note: "about 0.6 V, a sharp knee", ...diode("1N4148") },
  germanium: { label: "Germanium", note: "about 0.3 V, soft and early", ...diode("1N34A") },
  led: { label: "LED", note: "about 1.7 V, louder and more open", ...diode("LED-RED-3MM") },
  mosfet: { label: "MOSFET", note: "about 1.2 V, the softest knee", ...diode("BS170") },
  none: { label: "None", note: "an empty socket: the op-amp clips on its own", part: "", junction: null },
} satisfies Record<string, { label: string; note: string; part: string; junction: Junction | null }>;
export type Clipper = keyof typeof CLIPPERS;

/** A capacitor socket or a resistor takes the stock value times one of these, as the nearest part you can buy (`stepValue`). */
export const STEPS = ["0.22", "0.47", "1", "2.2", "4.7"] as const;

const E6 = [1, 1.5, 2.2, 3.3, 4.7, 6.8];
/** A stock value (farads or ohms) times `step`, snapped to the nearest E6 value (10n, 15n, 22n, 33n, 47n, 68n, 100n...). */
export function stepValue(stock: number, step: number): number {
  if (step === 1) return stock;
  const want = stock * step, decade = 10 ** Math.floor(Math.log10(want) + 1e-9);
  const off = (m: number) => Math.abs(Math.log((m * decade) / want));
  const best = [...E6, 10].reduce((x, m) => (off(m) < off(x) ? m : x));
  return Number((best * decade).toPrecision(3));
}

/** Farads as a part's printed value: 4.7µF, 22nF, 470pF. */
export function farads(f: number): string {
  const [unit, scale] = f >= 1e-6 ? ["µF", 1e6] : f >= 1e-9 ? ["nF", 1e9] : ["pF", 1e12];
  return `${Number((f * scale).toPrecision(3))}${unit}`;
}

/** Ohms as a part's printed value: 2.2k, 470, 1M (`bom.csv`'s way; the page adds Ω). */
export function ohms(r: number): string {
  const [unit, scale] = r >= 1e6 ? ["M", 1e-6] : r >= 1e3 ? ["k", 1e-3] : ["", 1];
  return `${Number((r * scale).toPrecision(3))}${unit}`;
}

/**
 * A place on a board a player can change: a clipper (the diodes sharing two nets) and a capacitor sit in sockets;
 * a fixed resistor (not a pot, whose knob sets it) is soldered, a value you pick for your own build.
 */
export type Socket =
  | { id: string; kind: "clipper"; parts: string[] }
  | { id: string; kind: "cap"; parts: [string]; farads: number }
  | { id: string; kind: "res"; parts: [string]; ohms: number };

/** A player's version of a board: socket id → a `Clipper` or a `STEPS` entry. Anything else is stock. */
export type Swaps = Record<string, string>;

/** The swappable sockets on a board, in board order. */
export function sockets(board: BoardId): Socket[] {
  const out: Socket[] = [], pairs = new Map<string, string[]>();
  for (const p of readBoard(BOARDS[board]).parts) {
    if (p.kind === "C") out.push({ id: p.name, kind: "cap", parts: [p.name], farads: p.farads });
    else if (p.kind === "R" && !p.name.startsWith("RV")) out.push({ id: p.name, kind: "res", parts: [p.name], ohms: p.ohms });
    else if (p.kind === "D") {
      const key = [p.a, p.k].sort().join("|");
      const group = pairs.get(key);
      if (group) group.push(p.name);
      else { const parts = [p.name]; pairs.set(key, parts); out.push({ id: p.name, kind: "clipper", parts }); }
    }
  }
  return out;
}

/** A clipper choice by its id. */
export const isClipper = (v: string | undefined): v is Clipper => v !== undefined && Object.hasOwn(CLIPPERS, v);
const isStep = (v: string | undefined): v is (typeof STEPS)[number] => STEPS.some((s) => s === v);

/** The board options a set of swaps comes to. Unknown sockets and choices are ignored. */
export function swapOptions(board: BoardId, swaps: Swaps = {}): Pick<BoardOptions, "values" | "diodes"> {
  const values: Record<string, number> = {}, diodes: Record<string, Junction | null> = {};
  for (const s of sockets(board)) {
    const v = swaps[s.id];
    if (s.kind === "clipper" && isClipper(v)) for (const d of s.parts) diodes[d] = CLIPPERS[v].junction;
    if (s.kind === "cap" && isStep(v)) values[s.id] = stepValue(s.farads, Number(v));
    if (s.kind === "res" && isStep(v)) values[s.id] = stepValue(s.ohms, Number(v));
  }
  return { values, diodes };
}

/** `json` reads another copy of the board in place of `BOARDS[board]`: a remake of it (Q Builder's retest). */
const pedal = (board: BoardId, pot: number, swaps?: Swaps, o: BoardOptions = {}, json: unknown = BOARDS[board]): Netlist => {
  const s = swapOptions(board, swaps);
  return boardToNetlist(json, { ...o, diodes: s.diodes, values: { ...s.values, RV1: pot } });
};

// ---- the circuits ----

/**
 * Hard-clip distortion: an op-amp gain stage (up to ×101 above ~34 Hz), then
 * two silicon diodes to ground that flatten the tops, then a one-pole tone.
 * `gain` is the feedback resistor, RV1.
 */
export function hardClip(gain = 100_000, swaps?: Swaps, json?: unknown): Netlist {
  return pedal("dist", gain, swaps, {}, json);
}

/**
 * Mid-hump overdrive: the diodes sit in the op-amp's feedback, so they round
 * the wave off instead of cutting it, and the 4.7k/47nF leg only gives gain
 * above ~720 Hz, so the lows stay clean and the mids push. `drive` 0 to 1.
 */
export function overdrive(drive = 0.5, swaps?: Swaps, json?: unknown): Netlist {
  return pedal("drive", 51e3 + drive * 500e3, swaps, {}, json);
}

/**
 * Fuzz: an op-amp at up to ×2000, its feedback diodes rounding the wave off,
 * then two diodes to ground squaring what's left. Its 1M input resistor hisses,
 * and that hiss gets the same ×2000 and the same clipping as the guitar: the
 * fizz around the notes and the wash when you stop. `drive` 0 to 1.
 */
export function fuzz(drive = 0.7, swaps?: Swaps, json?: unknown): Netlist {
  return pedal("fuzz", 20e3 + drive ** 2 * 2e6, swaps, { noisy: ["R1"] }, json);
}

/** One 12AX7 gain stage: coupling cap and grid leak, grid stopper, plate load, cathode resistor (and bypass cap). */
export interface StageSpec {
  /** Cathode resistor: bigger is colder, cleaner and more asymmetric when it clips. */
  rk: number;
  /** Cathode bypass cap (0 for none): more gain above 1/(2π·rk·ck). Small values keep the lows tight. */
  ck: number;
  /** Coupling cap into the grid: smaller cuts more lows before this stage. */
  cc?: number;
  rp?: number;
  bplus?: number;
  /** Its grid stopper and plate load hiss (the first stage: everything after amplifies it). */
  noisy?: boolean;
}

export function triodeStage(s: StageSpec): Netlist {
  return boardToNetlist(BOARDS.triode, {
    values: { C1: s.cc ?? 22e-9, RK: s.rk, CK: s.ck, RP: s.rp ?? 100e3 },
    supplies: { B_PLUS: s.bplus ?? 300 },
    noisy: s.noisy ? ["R2", "RP"] : [],
  });
}

// ---- the loop machines' circuits ----

const DRIVER = ["V1", "C1", "R1", "R2", "RK1", "CK1", "RP1"];
const RECOVERY = ["V2", "C2", "R3", "R4", "RK2", "CK2", "RP2"];

/**
 * The tubes and op-amp inside the effects loop's machines, read from their boards (`spring`, `tape`) and handed to
 * gear's machines (`RigSpec.machines`). The spring board holds both stages, so each is read with the other left out.
 */
export const MACHINES: MachineCircuits = {
  springDriver: boardToNetlist(BOARDS.spring, { leaveOut: RECOVERY, output: "DRIVE", supplies: { B_DRIVE: 250 }, tubes: { V1: "12AT7" } }),
  springRecovery: boardToNetlist(BOARDS.spring, { leaveOut: DRIVER, input: "TANK", supplies: { B_PLUS: 300 } }),
  recordAmp: boardToNetlist(BOARDS.tape),
};

/** The passive bass/mid/treble network most guitar amps share. Knobs 0 to 10. */
export interface ToneSpec { bass: number; mid: number; treble: number; slope?: number; cTreble?: number; cBass?: number; cMid?: number }

export function toneStack(t: ToneSpec): Netlist {
  const pot = (k: number) => Math.min(Math.max(k / 10, 0.001), 0.999);
  const tr = pot(t.treble), bass = pot(t.bass) ** 2, mid = pot(t.mid) ** 2; // bass and mid are log-taper pots
  const TREBLE = 220e3, BASS = 1e6, MID = 25e3;
  return boardToNetlist(BOARDS.tone, {
    values: {
      C1: t.cTreble ?? 470e-12, RT1: (1 - tr) * TREBLE, RT2: tr * TREBLE,
      R1: t.slope ?? 33e3, C2: t.cBass ?? 22e-9, C3: t.cMid ?? 22e-9, RB: bass * BASS, RM: mid * MID,
    },
  });
}
