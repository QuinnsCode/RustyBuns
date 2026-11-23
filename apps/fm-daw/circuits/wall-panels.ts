// The sound wall's modules as their front panels (WALL.md): each one's width in HP and where every jack and knob
// sits, in millimetres from the middle of its board (x right, y up, as tscircuit places parts). The boards
// (circuits/wall-*.tsx) put their jacks and pots here, and the gear room (src/wall/modules.ts) draws and aims the
// same panel, so the panel you cable in the room is the panel you drill. Pure data: the boards render in a scratch
// folder with this file copied beside them.

export interface PanelJack {
  /** The jack's name in the patch (`in`, `cv`, `send-a`). */
  name: string;
  label: string;
  dir: "in" | "out";
  x: number;
  y: number;
  /** The jack on the board: J1, J2, ... */
  part: string;
  /** An input that takes this other input's signal while nothing is plugged in (its jack's switch, TN). */
  normal?: string;
}
export interface PanelKnob {
  name: string;
  label: string;
  x: number;
  y: number;
  /** The pot on the board: RV1, RV2, ... */
  part: string;
  /** Where the knob starts, 0 to 1. */
  dflt: number;
  /** How the pot's resistance follows the knob: linear (B), audio (A) or reverse audio (C). */
  taper: "lin" | "log" | "rlog";
}
/** A module: its id, name, what it is in a word or two (the picker says it), width and panel. */
export interface Panel { id: string; name: string; what: string; hp: number; jacks: PanelJack[]; knobs: PanelKnob[] }

/** Eurorack (Doepfer A-100): 3U panels 128.5 mm tall, 1 HP = 5.08 mm; a panel is a few tenths under its HP's width. */
export const PANEL_H = 128.5, HP = 5.08;
export const panelWidth = (hp: number) => hp * HP - 0.3;
/** The board behind a panel: 2 mm narrower than it and 108 mm tall, so it clears the case's rails. */
export const BOARD_H = 108;
export const boardWidth = (hp: number) => Math.floor((panelWidth(hp) - 2) * 10) / 10;

const jack = (part: string, name: string, label: string, dir: "in" | "out", x: number, y: number, normal?: string): PanelJack => ({ part, name, label, dir, x, y, ...(normal ? { normal } : {}) });
const knob = (part: string, name: string, label: string, x: number, y: number, dflt = 0.5, taper: PanelKnob["taper"] = "lin"): PanelKnob => ({ part, name, label, x, y, dflt, taper });

/**
 * The eight steps' starting turns: a minor pentatonic line. A full turn is 12 V on the bus less the step's Schottky
 * (0.15 V), a sixth of it out (wall-seq.tsx's R4 and R5), so a turn of semi / 24 plus the Schottky's 0.15 / 12 is
 * that many semitones up the 2 V.
 */
const STEPS = [0, 7, 10, 12, 3, 7, 5, 15].map((semi) => semi / 24 + 0.15 / 12);

export const PANELS: Panel[] = [
  {
    id: "seq", name: "Q Steps", what: "8-step sequencer", hp: 12,
    knobs: [
      ...STEPS.map((d, i) => knob(`RV${i + 1}`, `step-${i + 1}`, `${i + 1}`, -21 + (i % 4) * 14, i < 4 ? 32 : 14, d)),
      knob("RV9", "rate", "Rate", -14, -8, 0.87),
    ],
    jacks: [jack("J1", "gate", "Gate", "out", -14, -36), jack("J2", "cv", "CV", "out", 14, -36)],
  },
  {
    id: "vco", name: "Q Saw", what: "oscillator (VCO)", hp: 10,
    knobs: [knob("RV1", "tune", "Tune", -10, 34), knob("RV2", "fine", "Fine", 10, 34), knob("RV3", "fm", "FM", -10, 12, 0), knob("RV4", "pw", "Width", 10, 12)],
    jacks: [jack("J1", "voct", "V/Oct", "in", -12, -16), jack("J2", "fm", "FM", "in", 12, -16), jack("J3", "saw", "Saw", "out", -12, -38), jack("J4", "pulse", "Pulse", "out", 12, -38)],
  },
  {
    id: "vcf", name: "Q Filter", what: "filter (VCF)", hp: 10,
    knobs: [knob("RV1", "freq", "Freq", -10, 34, 0.55), knob("RV2", "res", "Res", 10, 34, 0.7, "log"), knob("RV3", "cv", "CV", 0, 12, 0.6)],
    jacks: [jack("J1", "in", "In", "in", -12, -16), jack("J2", "cv", "CV", "in", 12, -16), jack("J3", "lp", "LP", "out", -14, -38), jack("J4", "bp", "BP", "out", 0, -38), jack("J5", "hp", "HP", "out", 14, -38)],
  },
  {
    id: "vca", name: "Q Level", what: "amplifier (VCA)", hp: 6,
    knobs: [knob("RV1", "level", "Level", 0, 34, 0), knob("RV2", "cv", "CV", 0, 12, 0.8)],
    jacks: [jack("J1", "in", "In", "in", -6.5, -16), jack("J2", "cv", "CV", "in", 6.5, -16), jack("J3", "out", "Out", "out", 0, -38)],
  },
  {
    id: "env", name: "Q Swell", what: "envelope (ASR)", hp: 6,
    knobs: [knob("RV1", "attack", "Attack", 0, 34, 0.05, "log"), knob("RV2", "release", "Release", 0, 12, 0.3, "log")],
    jacks: [jack("J1", "gate", "Gate", "in", 0, -16), jack("J2", "out", "Out", "out", 0, -38)],
  },
  {
    id: "lfo", name: "Q Wobble", what: "LFO", hp: 6,
    knobs: [knob("RV1", "rate", "Rate", 0, 34, 0.4, "rlog")],
    jacks: [jack("J1", "tri", "Tri", "out", 0, -16), jack("J2", "sqr", "Square", "out", 0, -38)],
  },
  {
    id: "mix", name: "Q Bus", what: "mixer, 2 sends and returns", hp: 16,
    knobs: [
      ...[0, 1, 2, 3].flatMap((i) => [
        knob(`RV${i * 3 + 1}`, `a-${i + 1}`, `A${i + 1}`, -30 + i * 15, 36, 0, "log"),
        knob(`RV${i * 3 + 2}`, `b-${i + 1}`, `B${i + 1}`, -30 + i * 15, 18, 0, "log"),
        knob(`RV${i * 3 + 3}`, `level-${i + 1}`, `${i + 1}`, -30 + i * 15, 0, 0.75, "log"),
      ]),
      knob("RV13", "ret-a", "Ret A", 30, 36, 0.75, "log"), knob("RV14", "ret-b", "Ret B", 30, 18, 0.75, "log"), knob("RV15", "main", "Main", 30, 0, 0.8, "log"),
    ],
    jacks: [
      ...[0, 1, 2, 3].map((i) => jack(`J${i + 1}`, `in-${i + 1}`, `In ${i + 1}`, "in", -30 + i * 15, -22)),
      jack("J5", "main", "Main", "out", 30, -22),
      jack("J6", "send-a", "Send A", "out", -30, -40), jack("J7", "ret-a", "Ret A", "in", -15, -40),
      jack("J8", "send-b", "Send B", "out", 0, -40), jack("J9", "ret-b", "Ret B", "in", 15, -40),
    ],
  },
  {
    id: "out", name: "Q Out", what: "output to the room", hp: 6,
    knobs: [knob("RV1", "left", "L", 0, 34, 0.9, "log"), knob("RV2", "right", "R", 0, 12, 0.9, "log")],
    jacks: [
      jack("J1", "in-l", "In L", "in", -6.5, -16), jack("J2", "in-r", "In R", "in", 6.5, -16, "in-l"),
      jack("J3", "out-l", "Out L", "out", -6.5, -38), jack("J4", "out-r", "Out R", "out", 6.5, -38),
    ],
  },
];

export const panel = (id: string): Panel => {
  const p = PANELS.find((x) => x.id === id);
  if (!p) throw new Error(`no sound wall module ${id} (${PANELS.map((x) => x.id).join(", ")})`);
  return p;
};
