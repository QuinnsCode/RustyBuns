// Crossovers (#6473): which amp channel carries which band of a box, where the bands split, and what the sum sounds
// like when the split is set right or wrong. A channel's DSP is a high-pass and a low-pass (Linkwitz-Riley or
// Butterworth, 12 to 48 dB/oct), gain, delay and polarity, as an amp's DSP has them (the PLD4.5's: crossover 20 Hz to
// 20 kHz, 6 to 48 dB/oct, delay 0 to 50 ms). The math is the filters' complex response, so the sum of the bands at a
// frequency carries their phase: a sub out of polarity or late against the tops leaves a hole at the split, as it
// does in the field. Plain TS, no audio: the page plays it through Web Audio's own filters (apps/fm-daw).

export const SLOPES = [12, 24, 48] as const;
export type Slope = (typeof SLOPES)[number];
export type FilterType = "lr" | "bw";
/** One edge of a band: where it turns over, how steep, and its family (Linkwitz-Riley sums flat at the split). */
export type Edge = { hz: number; slope: Slope; type: FilterType };
/** One amp channel's DSP. */
export type ChannelDsp = { hp?: Edge; lp?: Edge; gainDb: number; delayMs: number; polarity: 1 | -1; /** dBFS the limiter holds the channel under */ limitDb?: number };
/** The DSP limits of the amp it runs in. */
export const PLD_DSP = { minHz: 20, maxHz: 20000, maxDelayMs: 50 } as const;

type C = [number, number];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const pow = (a: C, n: number): C => { let r: C = [1, 0]; for (let i = 0; i < n; i++) r = mul(r, a); return r; };

/** Butterworth's poles for order n as its normalised polynomial's quadratic (and, for odd n, linear) factors at s. */
function butter(s: C, n: number): C {
  let d: C = [1, 0];
  for (let k = 0; k < Math.floor(n / 2); k++) {
    const q = 2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * n)); // s^2 + q s + 1
    d = mul(d, [s[0] * s[0] - s[1] * s[1] + q * s[0] + 1, 2 * s[0] * s[1] + q * s[1]]);
  }
  if (n % 2) d = mul(d, [s[0] + 1, s[1]]);
  return d;
}
/** The order of a slope (6 dB/oct each) and how a family builds it: LR of order n is Butterworth n/2 twice. */
const order = (slope: Slope) => slope / 6;

/** The complex response of one edge at `f` Hz: `high` passes above it (a high-pass), else below. */
export function edge(e: Edge, f: number, high: boolean): C {
  const w = f / e.hz, s: C = [0, high ? -1 / w : w]; // a high-pass is the low-pass at 1/s, and 1/(jw) = -j/w
  const n = order(e.slope);
  const lp = e.type === "lr" ? pow(div([1, 0], butter(s, n / 2)), 2) : div([1, 0], butter(s, n));
  return lp;
}

/** One channel's complex response at `f`: its filters, gain, polarity and delay. */
export function channelAt(ch: ChannelDsp, f: number): C {
  let h: C = [Math.pow(10, ch.gainDb / 20) * ch.polarity, 0];
  if (ch.hp) h = mul(h, edge(ch.hp, f, true));
  if (ch.lp) h = mul(h, edge(ch.lp, f, false));
  const ph = -2 * Math.PI * f * (ch.delayMs / 1000);
  return mul(h, [Math.cos(ph), Math.sin(ph)]);
}

/** dB of the sum of channels at `f` (each a band of the same box or rig, at the listener with any extra delay). */
export function sumDb(chs: readonly ChannelDsp[], f: number): number {
  const s = chs.reduce<C>((a, ch) => { const h = channelAt(ch, f); return [a[0] + h[0], a[1] + h[1]]; }, [0, 0]);
  return 20 * Math.log10(Math.max(1e-9, Math.hypot(s[0], s[1])));
}

/** Frequencies on a log sweep, `n` per octave, from `lo` to `hi`. */
export const sweep = (lo: number, hi: number, n = 12): number[] => {
  const out: number[] = [];
  for (let f = lo; f <= hi * 1.0001; f *= Math.pow(2, 1 / n)) out.push(f);
  return out;
};

/** The sum's flatness over a band: its deepest dip and highest bump against the passband's level, and where. */
export function flatness(chs: readonly ChannelDsp[], lo: number, hi: number): { dipDb: number; dipHz: number; bumpDb: number; bumpHz: number } {
  let dip = { db: Infinity, hz: lo }, bump = { db: -Infinity, hz: lo };
  for (const f of sweep(lo, hi, 96)) {
    const db = sumDb(chs, f);
    if (db < dip.db) dip = { db, hz: f };
    if (db > bump.db) bump = { db, hz: f };
  }
  return { dipDb: Math.round(dip.db * 10) / 10, dipHz: Math.round(dip.hz), bumpDb: Math.round(bump.db * 10) / 10, bumpHz: Math.round(bump.hz) };
}

/** A driver's band as its sheet gives it: what it can take (below `lowHz` a horn or a small cone is hurt). */
export type Way = { name: string; lowHz: number; highHz: number };

/** What's wrong with a channel's DSP for the way it feeds: no high-pass, or one below what the driver can take. */
export function wayWarnings(way: Way, ch: ChannelDsp): string[] {
  const out: string[] = [];
  if (way.lowHz > 25 && !ch.hp) out.push(`the ${way.name} has no high-pass: it gets the lows and the limiter can't save it`);
  else if (ch.hp && ch.hp.hz < way.lowHz * 0.8) out.push(`the ${way.name} is fed from ${Math.round(ch.hp.hz)} Hz, under the ${way.lowHz} Hz it can take: it will blow`);
  if (ch.lp && ch.lp.hz > way.highHz * 1.25) out.push(`the ${way.name} plays to ${Math.round(ch.lp.hz)} Hz, past its ${way.highHz} Hz: it beams and breaks up there`);
  if (ch.delayMs < 0 || ch.delayMs > PLD_DSP.maxDelayMs) out.push(`delay ${ch.delayMs} ms is outside the amp's 0 to ${PLD_DSP.maxDelayMs} ms`);
  for (const e of [ch.hp, ch.lp]) if (e && (e.hz < PLD_DSP.minHz || e.hz > PLD_DSP.maxHz)) out.push(`${Math.round(e.hz)} Hz is outside the amp's ${PLD_DSP.minHz} Hz to 20 kHz`);
  return out;
}

/** The delay (ms) that lines a sub up with the tops when the sub stands `metres` further from the listener (or nearer: negative). */
export const alignMs = (metres: number, c = 343) => Math.round((metres / c) * 1e5) / 100;

// ---- each rig's preset: its amp channels' bands, from the makers' sheets ----------------------------------------

/** One amp channel's band in a rig: the box and way it feeds, its DSP, the way's driver range, and the sheet read. */
export type Band = { box: string; way: string; dsp: ChannelDsp; range: Way; ref: string; /** what the sheet doesn't give, and what we set instead */ guess?: string };
const lr24 = (hz: number): Edge => ({ hz, slope: 24, type: "lr" });
const bw24 = (hz: number): Edge => ({ hz, slope: 24, type: "bw" });
const ch = (o: Partial<ChannelDsp>): ChannelDsp => ({ gainDb: 0, delayMs: 0, polarity: 1, ...o });

/** Every rig's crossover (packages/gear systems.ts ids), its bands low to high. */
export const RIG_CROSSOVERS: Readonly<Record<string, readonly Band[]>> = {
  // Funktion-One's "Res2 Active with F121/F221" preset (their crossover-settings page, archived 2025-01-22): 21" 28 Hz
  // (24 dB Butterworth) to 85, +8 dB; the Res2's 15" 85 to 250, +7 dB; its 8" and 1" together (the passive mid-high
  // pair, as the "Res2 with BR221" preset runs them) from 250, 3.268 ms late. Their 32 kHz top is past the amp's 20 kHz:
  // left open. No preset has the F215 between them: it shares the 15"'s band (its sheet's 55-250 Hz takes it).
  "dance-stack": [
    { box: "horn-sub-21", way: '21" bass horns', dsp: ch({ hp: bw24(28), lp: lr24(85), gainDb: 8 }), range: { name: '21" bass horn', lowHz: 25, highHz: 125 }, ref: "F1 crossover settings, Res2 Active with F121/F221; F221 sheet 25-125 Hz" },
    { box: "stack-mid-bass", way: '15" mid-bass horns', dsp: ch({ hp: lr24(85), lp: lr24(250), gainDb: 7 }), range: { name: '15" mid-bass horn', lowHz: 55, highHz: 250 }, ref: "F215 MkII sheet 55-250 Hz", guess: "no F1 preset has an F215 with a Res2 and F221: it runs on the Res2 15\"'s band" },
    { box: "stack-mid-high", way: '15" of the Res2', dsp: ch({ hp: lr24(85), lp: lr24(250), gainDb: 7 }), range: { name: 'Res2 15"', lowHz: 35, highHz: 250 }, ref: "F1 crossover settings, Res2 Active with F121/F221; Res2 sheet 35-250 Hz" },
    { box: "stack-mid-high", way: '8" and 1" of the Res2', dsp: ch({ hp: lr24(250), delayMs: 3.268 }), range: { name: 'Res2 8" and 1"', lowHz: 250, highHz: 20000 }, ref: "F1 crossover settings, Res2 with BR221: 8\"+1\" 250-32k, 3.268 ms" },
  ],
  // Danley: the TH118 sheet asks for a 30 Hz high-pass, 24 dB Butterworth; the SH50 is three ways on one channel through
  // its own passive network. Neither gives where the sub and the top split.
  synergy: [
    { box: "tapped-horn-18", way: "tapped horn", dsp: ch({ hp: bw24(30), lp: lr24(100) }), range: { name: "tapped horn", lowHz: 29, highHz: 213 }, ref: "TH118 sheet: 30 Hz HP 24 dB Butterworth; 37-213 Hz +/-3 dB", guess: "the low-pass, 100 Hz LR24, is ours" },
    { box: "synergy-horn", way: "synergy horn", dsp: ch({ hp: lr24(100) }), range: { name: "synergy horn", lowHz: 50, highHz: 18000 }, ref: "SH50 sheet: 50 Hz-18 kHz +/-3 dB, passive network inside", guess: "the 100 Hz LR24 high-pass is ours" },
  ],
  // Void's Air Motion user guide (UG10519): the LF section 140 to 600 Hz, the 8" and 1.5" above that through its own
  // 1.7 kHz passive network. The Incubus guide leaves its crossover to the amps' presets.
  sculpted: [
    { box: "triple-21-sub", way: "triple 21", dsp: ch({ hp: bw24(25), lp: lr24(140) }), range: { name: "triple 21 sub", lowHz: 25, highHz: 150 }, ref: "Incubus guide UG10570: 25 Hz, preset dependent", guess: "25 Hz HP and the 140 Hz LR24 low-pass meeting the Air Motion's LF are ours" },
    { box: "sculpted-3way", way: '12" LF', dsp: ch({ hp: lr24(140), lp: lr24(600) }), range: { name: '12" LF', lowHz: 135, highHz: 600 }, ref: "Air Motion guide UG10519: LF section 140 Hz and 600 Hz", guess: "slopes not given: LR24" },
    { box: "sculpted-3way", way: '8" and 1.5" (passive 1.7 kHz)', dsp: ch({ hp: lr24(600) }), range: { name: '8" and 1.5"', lowHz: 600, highHz: 20000 }, ref: "Air Motion guide UG10519: MHF from 600 Hz, 1.7 kHz passive", guess: "slope not given: LR24" },
  ],
  // Turbosound's Flashlight manual (issue 1.4): the TFS-780H's 12" 150 Hz-1.3 kHz, 6.5" 1.3-8 kHz, 1" above 8 kHz; the
  // 780L's 21" up to 150 Hz; the LMS-D6 controller at 24 dB/oct. It gives neither the filter family nor the delays.
  "tri-amp": [
    { box: "tri-amp-bass", way: '21" TurboBass', dsp: ch({ hp: bw24(30), lp: lr24(150) }), range: { name: '21" bass', lowHz: 30, highHz: 150 }, ref: "Flashlight manual: 780L up to 150 Hz, 24 dB/oct", guess: "the 30 Hz high-pass and LR for the family are ours" },
    { box: "tri-amp-top", way: '12" TurboMid', dsp: ch({ hp: lr24(150), lp: lr24(1300) }), range: { name: '12" TurboMid', lowHz: 150, highHz: 1300 }, ref: "Flashlight manual: 150 Hz-1.3 kHz", guess: "LR for the family is ours" },
    { box: "tri-amp-top", way: '6.5" TurboMid', dsp: ch({ hp: lr24(1300), lp: lr24(8000) }), range: { name: '6.5" TurboMid', lowHz: 1300, highHz: 8000 }, ref: "Flashlight manual: 1.3-8 kHz", guess: "LR for the family is ours" },
    { box: "tri-amp-top", way: '1" on its waveguide', dsp: ch({ hp: lr24(8000) }), range: { name: '1" compression driver', lowHz: 8000, highHz: 20000 }, ref: "Flashlight manual: above 8 kHz", guess: "LR for the family is ours" },
  ],
  // QSC: the KS118's low-pass menu is 80 or 100 Hz, 80 the default for K.2 and CP tops, time-aligned with a top on a
  // pole over it (KS user manual, KS118 FAQ). The LA108's own crossover isn't published: its high-pass meets the sub's.
  "line-array": [
    { box: "sub-18", way: '18" sub', dsp: ch({ lp: lr24(80) }), range: { name: '18" sub', lowHz: 0, highHz: 98 }, ref: "KS118 manual: LP 80 Hz (default for K.2/CP tops); sheet 41-98 Hz -6 dB; powered, its own DSP guards its low end", guess: "slope not given: LR24" },
    { box: "line-array-10", way: "line array box", dsp: ch({ hp: lr24(80) }), range: { name: "line array box", lowHz: 62, highHz: 20000 }, ref: "LA108 sheet: 62 Hz-20 kHz -6 dB", guess: "the 80 Hz LR24 high-pass meeting the KS118 is ours" },
  ],
};

/**
 * The bands as the room plays them, summed through one signal. A maker's preset lines up real drivers of different
 * sensitivity standing apart (the F221's +8 dB, the Res2 horn's 3.268 ms); the set played through one sum has neither,
 * so each band is heard as its move away from the preset: its gain change, its delay change (shifted so none is
 * negative), its polarity against the preset's, and a band two boxes share (an F215 beside the Res2's 15") split
 * between them. The lowest band's high-pass guards its driver: the room's own low cut (PaRoom) plays that part, so it
 * isn't summed against the split above it.
 */
export function heardBands(bands: readonly ChannelDsp[], preset: readonly ChannelDsp[]): ChannelDsp[] {
  const key = (d: ChannelDsp | undefined) => `${d?.hp?.hz ?? 0}-${d?.lp?.hz ?? 0}`;
  const shared = (i: number) => preset.filter((x) => key(x) === key(preset[i])).length || 1;
  const shift = Math.max(0, ...bands.map((b, i) => (preset[i]?.delayMs ?? 0) - b.delayMs));
  return bands.map((b, i) => {
    const p = preset[i] ?? b;
    const out: ChannelDsp = { ...b, gainDb: b.gainDb - p.gainDb - 20 * Math.log10(shared(i)), delayMs: b.delayMs - p.delayMs + shift, polarity: b.polarity === p.polarity ? 1 : -1 };
    if (i === 0 && b.hp && p.hp && b.hp.hz === p.hp.hz) delete out.hp;
    return out;
  });
}
/** dB of the set as the room plays it at `f`, against the preset as it plays (0 at the preset). */
export const heardDb = (bands: readonly ChannelDsp[], preset: readonly ChannelDsp[], f: number): number =>
  sumDb(heardBands(bands, preset), f) - sumDb(heardBands(preset, preset), f);

/** A rig's crossover preset, low band first (none for a rig with no preset). */
export const rigCrossover = (id: string): readonly Band[] => RIG_CROSSOVERS[id] ?? [];

/** The bands as they reach you with the lowest one (the sub) standing `subAheadM` metres nearer than the rest: its
 *  sound arrives that much early, which only delay on its channel takes back (`alignMs`). */
export const placed = (bands: readonly ChannelDsp[], subAheadM: number): readonly ChannelDsp[] =>
  subAheadM ? bands.map((b, i) => (i ? b : { ...b, delayMs: b.delayMs - alignMs(subAheadM) })) : bands;

/**
 * What's wrong with a rig's crossover as set: each band's warnings, and the deepest hole and highest bump from 40 Hz
 * to 16 kHz as the room plays it (`heardDb`). The preset reads 0; a move away from it reads as what it does to the
 * sound (a flipped sub's hole at the split, a gap, a bump). With the sub standing `subAheadM` in front of the tops, the
 * preset reads a hole until the sub's delay lines them up again.
 */
export function crossoverCheck(bands: readonly Band[], preset: readonly ChannelDsp[] = bands.map((b) => b.dsp), subAheadM = 0): { warnings: string[]; dipDb: number; dipHz: number; bumpDb: number; bumpHz: number } {
  const warnings = bands.flatMap((b) => wayWarnings(b.range, b.dsp).map((w) => `${b.box}: ${w}`));
  const now = placed(bands.map((b) => b.dsp), subAheadM);
  let dip = { db: Infinity, hz: 40 }, bump = { db: -Infinity, hz: 40 };
  for (const f of sweep(40, 16000, 96)) {
    const db = heardDb(now, preset, f);
    if (db < dip.db) dip = { db, hz: f };
    if (db > bump.db) bump = { db, hz: f };
  }
  const r = (v: number) => Math.round(v * 10) / 10 || 0;
  return { warnings, dipDb: r(dip.db), dipHz: Math.round(dip.hz), bumpDb: r(bump.db), bumpHz: Math.round(bump.hz) };
}

/** The response plot's curves, 20 Hz to 20 kHz: each band as the room plays it, and their sum against the preset
 *  (a flat 0 when it is set right), in dB. */
export function response(bands: readonly ChannelDsp[], preset: readonly ChannelDsp[], subAheadM = 0, perOctave = 24): { hz: number[]; bands: number[][]; sum: number[] } {
  const hz = sweep(20, 20000, perOctave), now = placed(bands, subAheadM);
  const db = (d: ChannelDsp, f: number) => { const h = channelAt(d, f); return 20 * Math.log10(Math.max(1e-9, Math.hypot(h[0], h[1]))); };
  return { hz, bands: heardBands(now, preset).map((d) => hz.map((f) => db(d, f))), sum: hz.map((f) => heardDb(now, preset, f)) };
}

// ---- each speaker on its own: what splits it inside, and what its own DSP or the amp's has to ----------------------

/** What a speaker needs of a crossover on its own: whether it is powered (its DSP is inside) or passive (it takes amp
 *  channels), the split inside it (Hz, where the sheet gives it), the settings its own menu offers against a sub or a
 *  top, in plain words, and the sheet read. */
export type BoxCrossover = { drive: "powered" | "passive"; internalHz?: number; menu?: { edge: "hp" | "lp"; hz: readonly number[] }; says: string; ref: string };
const K2: BoxCrossover = { drive: "powered", menu: { edge: "hp", hz: [80, 100, 125] }, says: "powered: its own DSP splits it inside; over a sub, high-pass it at 80, 100 or 125 Hz, the sub's low-pass at the same", ref: "QSC, KS Series Crossover Settings: Do and Don't (the K.2's high-pass settings)" };
const oneWay = (ref: string): BoxCrossover => ({ drive: "passive", says: "passive, one way: no network inside; the amp channel's DSP sets its whole band", ref });
const airMotion: BoxCrossover = { drive: "passive", internalHz: 1700, says: 'two amp channels: the 12" on one, the 8" and 1.5" on another, split inside at 1.7 kHz', ref: "Air Motion guide UG10519" };
/** Every speaker in the catalog, by gear id. A split the maker doesn't publish is left out and said so. */
export const BOX_CROSSOVERS: Readonly<Record<string, BoxCrossover>> = {
  "top-12-powered": K2,
  "fill-8-powered": K2,
  "sub-18": { drive: "powered", menu: { edge: "lp", hz: [80, 100] }, says: "powered sub: low-pass it at 80 Hz (the default for K.2 and CP tops) or 100 Hz", ref: "KS118 manual and FAQ" },
  "wedge-12": { drive: "powered", menu: { edge: "hp", hz: [80] }, says: "powered: its own DSP splits it inside; its Ext Sub voicings high-pass it at 80 Hz", ref: "QSC CP12 presets (Default Ext Sub, Dance Ext Sub)" },
  "line-array-10": { drive: "powered", says: "powered: its own DSP splits it inside; the split is not published", ref: "LA108 sheet" },
  "top-15-passive": { drive: "passive", internalHz: 2200, says: "passive two-way: its own network splits at 2.2 kHz, so one amp channel runs it full range", ref: "JBL JRX215 product page: crossover frequency 2.2 kHz" },
  "wedge-12-passive": { drive: "passive", internalHz: 2000, says: "passive two-way: its own network splits at 2.0 kHz, so one amp channel runs it full range", ref: "JBL PRX412M spec sheet: crossover frequency 2.0 kHz" },
  "line-array-box": { drive: "passive", says: "passive, four amp channels (LF, LF, MF, HF): the split points are in the maker's amp presets, not published here", ref: "JBL VTX A12 spec sheet" },
  "cab-4x12": { drive: "passive", says: "passive, four 12s full range: no crossover, the guitar amp drives it", ref: "Marshall 1960A: a 4x12 guitar cabinet" },
  "stack-mid-high": { drive: "passive", says: 'two amp channels: the 15" on one, the 8" and 1" on another through their own passive network (its point not published)', ref: "F1 crossover settings, Res2 with BR221" },
  "stack-mid-bass": oneWay("F215 MkII sheet, 55-250 Hz"),
  "horn-sub-21": oneWay("F221 sheet, 25-125 Hz"),
  "horn-sub-18": oneWay("F218 MkII sheet"),
  "horn-sub-24": oneWay("F124 sheet D0037-01, 35-160 Hz"),
  "infra-sub-18": oneWay("Infrabass 218 sheet D0059-00"),
  "skeletal-mid-high": { drive: "passive", says: 'passive: its own network splits the 8" and 1" (its point not published); it plays from 250 Hz', ref: "Res 2SH sheet D0028-01, 250 Hz-18 kHz" },
  "skeletal-mid": oneWay("Res 2S8 sheet, 250 Hz-5 kHz"),
  "sculpted-3way": airMotion,
  "sculpted-3way-lh": airMotion,
  "arc-sub-18": oneWay("Arcline 118 sheet TD10753-2.0"),
  "triple-21-sub": oneWay("Incubus guide UG10570"),
  "synergy-horn": { drive: "passive", says: "passive: three ways on one amp channel through its own network (points not published)", ref: "SH50 sheet" },
  "tapped-horn-18": oneWay("TH118 sheet: high-pass it at 30 Hz, 24 dB Butterworth"),
  "tri-amp-top": { drive: "passive", says: 'tri-amped: three amp channels (12", 6.5", 1"), no network inside; split at 1.3 and 8 kHz in the drive rack', ref: "Turbosound Flashlight manual, issue 1.4" },
  "tri-amp-bass": oneWay("Turbosound Flashlight manual: up to 150 Hz"),
};
