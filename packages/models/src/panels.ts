// Each speaker's connector panel as its maker's sheet shows it: which connectors, how many, and where. A socket the
// games plug into carries the jack name the catalog (@rustybuns/gear) and the cables use; the rest are on the panel to
// be drawn and learned from but take no cable in the game yet (`jack: null`). Positions are millimetres in the box's
// own frame: on a front or back face [x across, y up from the floor], on a bottom face [x across, z front to back], x
// centred, +x to the box's right as you face its front (so to your left when you stand behind it).
// The sheets are in ~/.cache/rustybuns/gear-refs/<maker>/; `ref` names the one read and how sure the place is.

import type { Carries, ConnectorType, End, Gender } from "@rustybuns/util/connectors";
import type { GearId } from "./gear.ts";

export type Socket = {
  /** The game's jack name (`speaker-in`, `xlr-out`, `power-in`), or null for a socket no cable goes into yet. */
  jack: string | null;
  type: ConnectorType;
  /** The socket's own gender (a male panel takes a female plug; speakON has none). */
  gender: Gender;
  /** What the sheet calls it: "input", "link", "thru", "mains in". */
  role: string;
  /** Millimetres on the panel's face, as the file's top says. */
  at: [number, number];
  /** What runs through it where it isn't the connector's usual: a speaker line on an XLR. */
  carries?: Carries;
};

export type Panel = {
  face: "back" | "front" | "bottom";
  /** passive (one amp channel), biamp or triamp (two or three channels down one cable), or powered (its amp inside). */
  drive: "passive" | "biamp" | "triamp" | "powered";
  /** How the pins are wired, as the sheet gives it, or what we assumed. */
  pins: string;
  sockets: Socket[];
  /** The sheet and page read, and how sure the place is. */
  ref: string;
};

const nl4 = (jack: string | null, role: string, x: number, y: number): Socket => ({ jack, type: "nl4", gender: "none", role, at: [x, y] });
const nl8 = (jack: string | null, role: string, x: number, y: number): Socket => ({ jack, type: "nl8", gender: "none", role, at: [x, y] });
const pair = (make: typeof nl4, at: [[number, number], [number, number]]) => [make("speaker-in", "input", ...at[0]), make("speaker-out", "link", ...at[1])];

/** K.2 tops: two locking combo inputs, a 3.5 mm input, a thru per combo, a mix out and a locking IEC (K.2 manual p10-11). */
const k2 = (s: number): Socket[] => [
  { jack: "xlr-in", type: "combo", gender: "female", role: "input A", at: [40 * s, 420 * s] },
  { jack: null, type: "combo", gender: "female", role: "input B", at: [-40 * s, 420 * s] },
  { jack: null, type: "trs-mini", gender: "female", role: "input C", at: [-110 * s, 470 * s] },
  { jack: "xlr-out", type: "xlr3", gender: "male", role: "thru A", at: [40 * s, 340 * s] },
  { jack: null, type: "xlr3", gender: "male", role: "thru B", at: [-40 * s, 340 * s] },
  { jack: null, type: "xlr3", gender: "male", role: "mix out", at: [110 * s, 340 * s] },
  { jack: "power-in", type: "iec", gender: "male", role: "mains in (locking)", at: [0, 120 * s] },
];

/** Every speaker's panel, by gear id. */
export const PANELS: { readonly [id in GearId]?: Panel } = {
  "stack-mid-high": {
    face: "back", drive: "biamp", pins: "LF on 1+/1-, mid and HF on 2+/2- (the maker's usual; the sheet gives no pins)",
    sockets: pair(nl4, [[42, 770], [-42, 770]]), ref: "f1/res2-spec.pdf p1 (2 x NL4), res2-wd.png: plate on the centre line ~150 mm down",
  },
  "stack-mid-bass": {
    face: "back", drive: "passive", pins: "1+/1- (sheet: dual NL4M, pins not given)",
    sockets: pair(nl4, [[34, 422], [-34, 422]]), ref: "f1/f215-dd.pdf, f215-wd.png: plate dead centre",
  },
  "horn-sub-21": {
    face: "back", drive: "passive", pins: "1+/1- (the drawing's \"dual NL4TM\" is two NL4 chassis sockets)",
    sockets: pair(nl4, [[54, 432], [-54, 432]]), ref: "f1/f221-dd.pdf, f221-wd.png: recessed dish, sockets ~150 mm down",
  },
  "horn-sub-18": {
    face: "back", drive: "biamp", pins: "two drivers wired independently, on 1+/1- and 2+/2- (sheet)",
    sockets: pair(nl4, [[44, 248], [-44, 248]]), ref: "f1/f218-datasheet.pdf p1, f218-wd.png: plate dead centre",
  },
  "sculpted-3way": {
    face: "bottom", drive: "biamp", pins: "LF on 1+/1-, mid and HF on 2+/2- through a passive crossover; the link is in parallel (user guide)",
    sockets: pair(nl4, [[-35, 0], [35, 0]]), ref: "void/UG10519 p9-11; under the mid driver's rear dome (drawing, low confidence)",
  },
  "triple-21-sub": {
    face: "back", drive: "passive", pins: "driver 1 on 1+/1-, 2 on 2+/2-, 3 on 3+/3-, 4 unused; one bridged amp channel (user guide)",
    sockets: pair(nl8, [[0, 392], [0, 304]]), ref: "void/UG10570 p19-20, Incubus-Sub-Line-Drawing: plate dead centre, stacked",
  },
  "arc-sub-18": {
    face: "back", drive: "passive", pins: "1+/1- (sheet: 4-pin locking, pins not given)",
    sockets: [...pair(nl4, [[-84, 199], [-84, 111]]), nl4(null, "front input (cardioid)", -280, 100), nl4(null, "front link (cardioid)", -280, 60)],
    ref: "void/TD10753 p2: rear plate right of centre in the lower half; the front pair (drawn on the back face here) is inferred",
  },
  "tri-amp-top": {
    face: "back", drive: "triamp", pins: "1 LMF-, 2 LMF+, 3 HMF-, 4 HMF+, 5 HF-, 6 HF+ (sheet)",
    sockets: [
      { jack: "speaker-in", type: "ep6", gender: "female", role: "input", at: [35, 600] },
      { jack: "speaker-out", type: "ep6", gender: "female", role: "link", at: [-35, 600] },
    ],
    ref: "turbosound/tfs780-specsheet.pdf p2 (2 x EP-6); no drawing of the panel, place assumed",
  },
  "tri-amp-bass": {
    face: "back", drive: "passive", pins: "speaker level on XLR: pin 2+, pin 1- (sheet)",
    sockets: [
      { jack: "speaker-in", type: "xlr3", gender: "female", role: "input", at: [35, 400], carries: "speaker" },
      { jack: "speaker-out", type: "xlr3", gender: "male", role: "link", at: [-35, 400], carries: "speaker" },
    ],
    ref: "turbosound/tfs780-specsheet.pdf p3 (2 x XLR-3 at speaker level); no drawing of the panel, place assumed",
  },
  "top-15-passive": {
    face: "back", drive: "passive", pins: "NL4 1+/1- = jack tip/sleeve, 2+/2- not connected (plate)",
    sockets: [nl4("speaker-in", "input", -30, 274), { jack: "speaker-out", type: "ts", gender: "female", role: "link (in parallel)", at: [30, 274] }],
    ref: "jbl/jrx215-spec-sheet p2, jrx215-back.jpg: plate centred, its bottom 226 mm up",
  },
  "wedge-12-passive": {
    face: "back", drive: "passive", pins: "1+ = tip, 1- = sleeve (sheet)",
    sockets: [
      { jack: "speaker-in", type: "nl2-combo", gender: "female", role: "input", at: [0, 247] },
      { jack: "speaker-out", type: "nl2-combo", gender: "female", role: "link (in parallel)", at: [0, 194] },
    ],
    ref: "jbl/prx412m-spec-sheet p1-2: two speakON/jack combos stacked (drawing, medium confidence)",
  },
  "line-array-box": {
    face: "back", drive: "passive", pins: "1+/1- LF, 2+/2- LF, 3+/3- MF, 4+/4- HF (user manual)",
    sockets: pair(nl8, [[38, 110], [-38, 110]]),
    ref: "jbl/vtx-a12-user-manual.pdf p17, vtx-a12-back.webp: the VTX A12 is passive; plate between the handle pockets",
  },
  "top-12-powered": { face: "back", drive: "powered", pins: "XLR pin 1 ground, 2 hot, 3 cold", sockets: k2(1), ref: "qsc/q_spk_k2_usermanual.pdf p10-11 (K12.2)" },
  "fill-8-powered": { face: "back", drive: "powered", pins: "XLR pin 1 ground, 2 hot, 3 cold", sockets: k2(0.75), ref: "qsc/q_spk_k2_usermanual.pdf p10-11 (K8.2, the same panel smaller)" },
  "sub-18": {
    face: "back", drive: "powered", pins: "XLR pin 1 ground, 2 hot, 3 cold",
    sockets: [
      { jack: "xlr-in", type: "combo", gender: "female", role: "input A", at: [-20, 400] },
      { jack: null, type: "combo", gender: "female", role: "input B", at: [-70, 400] },
      { jack: "xlr-out", type: "xlr3", gender: "male", role: "thru A", at: [-20, 340] },
      { jack: null, type: "xlr3", gender: "male", role: "thru B", at: [-70, 340] },
      { jack: "power-in", type: "iec", gender: "male", role: "mains in (locking)", at: [90, 371] },
    ],
    ref: "qsc/q_spk_ks_118_specs.pdf, ks_118_2ddrawing: amp plate centred ~267 mm down, IEC at its left",
  },
  "wedge-12": {
    face: "back", drive: "powered", pins: "XLR pin 1 ground, 2 hot, 3 cold",
    sockets: [
      { jack: "xlr-in", type: "combo", gender: "female", role: "input A", at: [0, 250] },
      { jack: null, type: "combo", gender: "female", role: "input B", at: [0, 200] },
      { jack: null, type: "trs-mini", gender: "female", role: "input C", at: [0, 160] },
      { jack: "xlr-out", type: "xlr3", gender: "male", role: "mix out", at: [-60, 225] },
      { jack: "power-in", type: "iec", gender: "male", role: "mains in", at: [60, 100] },
    ],
    ref: "qsc/q_spk_cp_usermanual.pdf p8: combos stacked, 3.5 mm under them; the IEC's place isn't drawn",
  },
  "line-array-10": {
    face: "back", drive: "powered", pins: "XLR pin 1 ground, 2 hot, 3 cold; Dante on the etherCONs",
    sockets: [
      { jack: "xlr-in", type: "xlr3", gender: "female", role: "input", at: [60, 170] },
      { jack: "xlr-out", type: "xlr3", gender: "male", role: "thru", at: [110, 170] },
      { jack: null, type: "ethercon", gender: "female", role: "network in", at: [60, 110] },
      { jack: null, type: "ethercon", gender: "female", role: "network thru", at: [110, 110] },
      { jack: "power-in", type: "powercon-true1", gender: "male", role: "mains in", at: [-120, 90] },
      { jack: null, type: "powercon-true1", gender: "female", role: "mains thru", at: [-170, 90] },
    ],
    ref: "qsc/q_spk_l_class_la108-la112_specsheet.pdf, la108_2ddrawing: connectors from the sheet, layout inferred",
  },
};

/** The socket a game jack is on, if its box has a panel. */
export function socketOf(id: GearId, jack: string): (End & { carries?: Carries }) | null {
  const s = PANELS[id]?.sockets.find((x) => x.jack === jack);
  return s ? { type: s.type, gender: s.gender, carries: s.carries } : null;
}
