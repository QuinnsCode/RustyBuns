// The long-form arrangement: 16-bar phrases that start nearly empty and add one thing at a time. Where the sectioned
// tracks (dub.ts) keep a quarter-note engine running, this one lays down the least that makes a groove (a kick and a
// held sub), lets the room breathe, and only then brings in a clap, a ghost hat, one stab in a whole phrase, two in the
// next, a lead that answers the stab, and a wub that grows underneath. The stab becomes the lead and goes back to a
// heavy stab. A bell on the one of the first bar doesn't come back for 64 bars.
//
// Nothing sits on the grid but the kicks (the render checks them): the offbeats lie behind the beat, between a swing and
// a triplet, and every other hit drifts a few hundredths of a beat, from a hash of the bar so a take is always the same take.
import type { Bar, Part, Setup } from "./dub.ts";

const T = 2 / 3;
/** Where an offbeat sits in its beat: behind straight, short of a full triplet. */
const LAID = 0.64;
const PHRASE = 16;
const SECTIONS = ["intro", "intro", "build", "build", "drop", "drop", "break", "outro"] as const;
/** The bass note's ratio, by phrase: it stays, then walks up a tone, home, up a minor third, and back. */
const RATIO = [1, 1, 1, 9 / 8, 1, 6 / 5, 9 / 8, 1] as const;

const hash = (a: number, b: number) => {
  let x = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  x ^= x >>> 13; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const drift = (bar: number, k: number, amount: number) => (hash(bar, k) - 0.5) * 2 * amount;

type Ev = [q: number, at: number, voice: Part["voice"], len: number, vel: number, pick: number[]];
const S1 = 1 + T, S2 = 2 + T, S3 = 3 + 1 / 3;
/** Each phrase's synth events: the bar in the phrase, the beat in the bar, the voice, beats held, velocity, chord tones. */
const EVENTS: readonly (readonly Ev[])[] = [
  [[0, 0, "bell", 1, 1, [3]], [0, 0, "sub", 64, 1, []], [0, 0, "pad", 60, 0.8, [0, 2]]],
  [[0, 0, "sub", 64, 1, []], [0, 0, "pad", 64, 0.9, [0, 2, 3]]],
  [[0, 0, "sub", 64, 1, []], [0, 0, "pad", 64, 0.9, [0, 1, 2]], [6, S1, "stab", 1, 1, [0, 2]]],
  [[0, 0, "sub", 64, 1, []], [0, 0, "pad", 64, 0.9, [0, 2, 3]], [2, S1, "stab", 1, 1, [0, 2]], [10, S2, "stab", 1, 0.9, [1, 3]]],
  [[0, 0, "bell", 1, 1, [2]], [0, 0, "sub", 64, 1, []], [0, 0, "pad", 64, 0.8, [0, 2]], [2, S1, "stab", 1, 1, [0, 2]],
    [8, 0, "wub", 32, 0.8, []], [10, S2, "stab", 1, 1, [0, 2, 3]]],
  [[0, 0, "sub", 64, 1, []], [0, 0, "wub", 40, 1, []], [0, 0, "pad", 64, 0.7, [0, 3]], [14, S1, "stab", 1, 1.15, [0, 2, 3]], [15, S2, "stab", 1, 1, [0, 2]]],
  [[0, 0, "sub", 32, 0.9, []], [0, 0, "pad", 64, 0.7, [0, 2]], [12, S1, "stab", 1, 0.8, [0, 2]]],
  [[0, 0, "bell", 1, 0.9, [0]], [0, 0, "sub", 48, 0.8, []], [0, 0, "pad", 48, 0.7, [0, 2]]],
];

// The lines. Scale degrees of a minor mode (0 is the root), beat positions on triplets, rests left in on purpose.
const SCALE = [0, 2, 3, 5, 7, 9, 10] as const;
const pitch = (base: number, degree: number) => base * 2 ** ((SCALE[((degree % 7) + 7) % 7]! + 12 * Math.floor(degree / 7)) / 12);
type Note = [at: number, degree: number, len: number];
/** The bass: four one-bar cells played in turn. A held root, a triplet push, a step to the fifth or down to the seventh. */
const CELLS: readonly (readonly Note[])[] = [
  [[0, 0, 1.5], [S1, 0, 0.6], [S3, -2, 0.5]],
  [[0, 0, 1.5], [S2, 2, 0.6], [S3, 1, 0.5]],
  [[0, 0, 1.4], [S1, 0, 0.6], [S2, 4, 1.1]],
  [[0, 0, 1], [S1, -2, 0.6], [2 + 1 / 3, -1, 0.6], [S3, 0, 0.5]],
];
/** The lead's call (bars 0 to 1 of eight) and its answer (bars 4 to 7), as [bar, beat, degree, beats]. The answer comes back down and resolves. */
const CALL: readonly [number, number, number, number][] = [[0, S1, 4, 1.2], [0, S3, 5, 0.6], [1, 0, 7, 2.6]];
const RESP: readonly [number, number, number, number][] = [[4, S2, 7, 0.6], [5, 0, 6, 1.3], [5, S1, 4, 0.6], [5, S3, 2, 0.6], [6, 0, 3, 3.2]];

/** Everything that happens in bar `bar` of a long-form track. */
export function arrangeLong(setup: Setup, bar: number): Bar {
  const p = Math.min(7, Math.floor(bar / PHRASE)), q = bar % PHRASE, root = setup.root * RATIO[p]!;
  const out: Bar = { section: SECTIONS[p]!, at: q, len: PHRASE, kicks: [], backs: [], toms: [], hats: [], fx: [], bass: null, growl: 0, rise: false, stabs: [], note: false, pad: false, root, parts: [] };
  // The kick: only on the one, rarer the emptier the phrase; a triplet pickup late in the loud ones. It is the one thing on the grid.
  if (p === 0 ? q >= 8 && q % 4 === 0 : p === 1 || p === 2 ? q % 2 === 0 : p === 6 ? false : p === 7 ? q % 4 === 0 : true) out.kicks.push(0);
  if ((p === 4 || p === 5) && q % 4 === 3) out.kicks.push(2 + T);
  // The clap on the three, laid back; half the bars of the second phrase, none in the break.
  if (p === 2 ? q >= 8 : p >= 3 && p <= 5) out.backs.push(2 + 0.035 + drift(bar, 1, 0.025));
  if (p === 4 && q % 8 === 7) out.toms.push(S3 + drift(bar, 2, 0.03));
  if (p === 5 && q % 4 === 3) out.toms.push(S1 + drift(bar, 3, 0.03), S3 + drift(bar, 4, 0.03));
  // Ghost hats on the laid offbeats, a few at first, a pair a bar later; never on every one.
  const hat = (b: number, vol: number, k: number) => ({ at: b + LAID + drift(bar, 10 + k, 0.035), vol: vol * (0.75 + 0.5 * hash(bar, 20 + k)) });
  if (p === 3 && q % 2 === 1) out.hats.push(hat(1, 0.11, 0));
  if (p === 4 || p === 5) { out.hats.push(hat(1, 0.12, 0), hat(3, 0.14, 1)); if (q % 4 === 2) out.hats.push({ at: 2 + 1 / 3 + drift(bar, 5, 0.02), vol: 0.07 }); }
  if (p === 7 && q < 8) out.hats.push(hat(3, 0.08, 2));
  // The bassline walks its cells from the third phrase on: half of them first, all of them, the busy cell in the loud ones.
  const cell = CELLS[(q + (p === 5 ? 1 : 0)) % 4]!;
  if (p === 2 ? q % 2 === 0 && q >= 4 : p === 7 ? q % 4 === 0 : p !== 6 && p >= 3) {
    (p === 3 || p === 7 ? cell.slice(0, 2) : cell).forEach(([at, deg, len], i) =>
      out.parts.push({ voice: "bass", at: at + drift(bar, 50 + i, 0.02), len, hz: [pitch(root * 2, deg)], vel: (i ? 0.8 : 1) * (0.9 + 0.2 * hash(bar, 60 + i)) }));
  }
  // The lead: a call from the third phrase, the answer from the fourth, slow and long in the break, only the call at the end.
  const half = q % 8;
  const line = p < 3 ? [] : [...(p === 3 && q >= 8 ? [] : p === 7 && q >= 8 ? [] : CALL), ...(p === 4 || p === 5 ? RESP : [])];
  line.forEach(([lb, at, deg, len], i) => {
    if (lb !== half) return;
    out.parts.push({ voice: "lead", at: at + drift(bar, 70 + i, 0.03), len: len * (p === 6 ? 2 : 1), hz: [pitch(root * 4, deg + (p === 5 ? 2 : 0))], vel: (p === 6 ? 0.7 : 0.9) * (0.9 + 0.2 * hash(bar, 80 + i)) });
  });
  const chord = [2, 2.4, 3, 3.6].map((m) => root * m);
  EVENTS[p]!.forEach(([eq, at, voice, len, vel, pick], i) => {
    if (eq !== q) return;
    const hz = voice === "sub" ? [root] : voice === "wub" ? [root * 2] : voice === "bell" ? pick.map((k) => chord[k]! * 2) : voice === "lead" ? pick.map((k) => chord[k]!) : pick.map((k) => chord[k]!);
    const human = voice === "stab" || voice === "lead" ? drift(bar, 30 + i, 0.05) : 0;
    out.parts.push({ voice, at: Math.max(0, at + human), len, hz, vel: vel * (0.9 + 0.2 * hash(bar, 40 + i)) });
  });
  return out;
}
