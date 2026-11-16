// Pedals and tube-amp pieces, each a tscircuit board in `circuits/*.tsx` from a
// textbook topology. Values are starting points to tune by ear, not copies of any
// one product. The netlist comes from the board (tscircuit.ts); this file only
// says which part each knob turns, and which parts a player can swap.
// Pedals run on a split supply (op-amp rails ±4 V around ground) instead of a
// 9 V battery and a 4.5 V bias divider: the same circuit, minus the bias parts.
import type { Netlist } from "./mna.ts";
import { boardToNetlist, readBoard, type BoardOptions, type Junction } from "./tscircuit.ts";
import dist from "../../circuits/dist.circuit.json";
import drive from "../../circuits/drive.circuit.json";
import fuzzBoard from "../../circuits/fuzz.circuit.json";
import triode from "../../circuits/triode.circuit.json";
import tone from "../../circuits/tone.circuit.json";

/** Each board's circuit JSON, read through `readBoard` before anything trusts it. */
export const BOARDS = { dist, drive, fuzz: fuzzBoard, triode, tone };
export type BoardId = keyof typeof BOARDS;

// ---- part swaps ----

/** What can sit in a clipper socket. Each junction is tuned to its forward drop at about 1 mA. */
export const CLIPPERS = {
  silicon: { label: "Silicon", note: "about 0.6 V, a sharp knee", junction: { is: 2.52e-9, n: 1.752 } },
  germanium: { label: "Germanium", note: "about 0.3 V, soft and early", junction: { is: 1.4e-7, n: 1.3 } },
  led: { label: "LED", note: "about 1.7 V, louder and more open", junction: { is: 5e-18, n: 2 } },
  mosfet: { label: "MOSFET", note: "about 1.2 V, the softest knee", junction: { is: 2e-10, n: 3 } },
  none: { label: "None", note: "an empty socket: the op-amp clips on its own", junction: null },
} satisfies Record<string, { label: string; note: string; junction: Junction | null }>;
export type Clipper = keyof typeof CLIPPERS;

/** A capacitor socket takes the stock value times one of these, as the nearest part you can buy (`capValue`). */
export const CAP_STEPS = ["0.22", "0.47", "1", "2.2", "4.7"] as const;

const E6 = [1, 1.5, 2.2, 3.3, 4.7, 6.8];
/** The stock capacitance times `step`, snapped to the nearest E6 value (10n, 15n, 22n, 33n, 47n, 68n, 100n...). */
export function capValue(farads: number, step: number): number {
  if (step === 1) return farads;
  const want = farads * step, decade = 10 ** Math.floor(Math.log10(want) + 1e-9);
  const off = (m: number) => Math.abs(Math.log((m * decade) / want));
  const best = [...E6, 10].reduce((x, m) => (off(m) < off(x) ? m : x));
  return Number((best * decade).toPrecision(3));
}

/** Farads as a part's printed value: 4.7µF, 22nF, 470pF. */
export function farads(f: number): string {
  const [unit, scale] = f >= 1e-6 ? ["µF", 1e6] : f >= 1e-9 ? ["nF", 1e9] : ["pF", 1e12];
  return `${Number((f * scale).toPrecision(3))}${unit}`;
}

/** A socket on a board: a clipper (the diodes sharing two nets) or one capacitor. */
export type Socket =
  | { id: string; kind: "clipper"; parts: string[] }
  | { id: string; kind: "cap"; parts: [string]; farads: number };

/** A player's version of a board: socket id → a `Clipper` or a `CAP_STEPS` entry. Anything else is stock. */
export type Swaps = Record<string, string>;

/** The swappable sockets on a board, in board order. */
export function sockets(board: BoardId): Socket[] {
  const out: Socket[] = [], pairs = new Map<string, string[]>();
  for (const p of readBoard(BOARDS[board])) {
    if (p.kind === "C") out.push({ id: p.name, kind: "cap", parts: [p.name], farads: p.farads });
    else if (p.kind === "D") {
      const key = [p.a, p.k].sort().join("|");
      const group = pairs.get(key);
      if (group) group.push(p.name);
      else { const parts = [p.name]; pairs.set(key, parts); out.push({ id: p.name, kind: "clipper", parts }); }
    }
  }
  return out;
}

const isClipper = (v: string | undefined): v is Clipper => v !== undefined && Object.hasOwn(CLIPPERS, v);
const isStep = (v: string | undefined): v is (typeof CAP_STEPS)[number] => CAP_STEPS.some((s) => s === v);

/** The board options a set of swaps comes to. Unknown sockets and choices are ignored. */
export function swapOptions(board: BoardId, swaps: Swaps = {}): Pick<BoardOptions, "values" | "diodes"> {
  const values: Record<string, number> = {}, diodes: Record<string, Junction | null> = {};
  for (const s of sockets(board)) {
    const v = swaps[s.id];
    if (s.kind === "clipper" && isClipper(v)) for (const d of s.parts) diodes[d] = CLIPPERS[v].junction;
    if (s.kind === "cap" && isStep(v)) values[s.id] = capValue(s.farads, Number(v));
  }
  return { values, diodes };
}

const pedal = (board: BoardId, pot: number, swaps?: Swaps, o: BoardOptions = {}): Netlist => {
  const s = swapOptions(board, swaps);
  return boardToNetlist(BOARDS[board], { ...o, diodes: s.diodes, values: { ...s.values, RV1: pot } });
};

// ---- the circuits ----

/**
 * Hard-clip distortion: an op-amp gain stage (up to ×101 above ~34 Hz), then
 * two silicon diodes to ground that flatten the tops, then a one-pole tone.
 * `gain` is the feedback resistor, RV1.
 */
export function hardClip(gain = 100_000, swaps?: Swaps): Netlist {
  return pedal("dist", gain, swaps);
}

/**
 * Mid-hump overdrive: the diodes sit in the op-amp's feedback, so they round
 * the wave off instead of cutting it, and the 4.7k/47nF leg only gives gain
 * above ~720 Hz, so the lows stay clean and the mids push. `drive` 0 to 1.
 */
export function overdrive(drive = 0.5, swaps?: Swaps): Netlist {
  return pedal("drive", 51e3 + drive * 500e3, swaps);
}

/**
 * Fuzz: an op-amp at up to ×2000, its feedback diodes rounding the wave off,
 * then two diodes to ground squaring what's left. Its 1M input resistor hisses,
 * and that hiss gets the same ×2000 and the same clipping as the guitar: the
 * fizz around the notes and the wash when you stop. `drive` 0 to 1.
 */
export function fuzz(drive = 0.7, swaps?: Swaps): Netlist {
  return pedal("fuzz", 20e3 + drive ** 2 * 2e6, swaps, { noisy: ["R1"] });
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
