// Long Trail: ten minutes of dark, symphonic, dubby liquid drum and bass at
// 172 in A minor, a ride through the parks at night. 432 bars in nine
// sections; the drums never leave for long (an octave down through most of
// it, back up for the drops), the violin is there nearly throughout (plucked
// pizzicato early and in the builds, bowed for the themes), and the long
// moves are filter sweeps written as automation.
//
//   bars   1-32   Dawn        pizzicato violin, hats and shaker opening up, deep kick then snare
//   bars  33-64   Trailhead   deep two-step, the womp bass rising out of a hi-cut, stabs
//   bars  65-128  Canyon      trumpet into the dub delay, then the bowed theme over the horns
//   bars 129-176  Starfield   breakdown: slow themes, horns, ride; a pizzicato build under a rising low-cut
//   bars 177-240  Summit      the drop: drums up an octave, the womp wobbling, both themes
//   bars 241-304  Dub Valley  half-time, the trumpet's throws, drums sinking under a hi-cut
//   bars 305-336  Switchbacks a second build: sixteenth plucks, a snare roll, the low-cut climbing
//   bars 337-400  Ridgeline   everything: themes, trumpet answering, horns
//   bars 401-432  Last Light  the kit leaves piece by piece and everything closes down
import { demoProject } from "./presets.ts";
import { GROOVES, KITS, applyKit, laneNotes } from "./drums.ts";
import { P } from "./engine/params.ts";
import * as T from "./themes.ts";
import type { Lane, Note, Project, TrackDoc } from "./project.ts";

const BARS = 432;
const K = 0, S = 1, H = 2, SH = 3, R = 4, WOMP = 5, STAB = 6, TRP = 7, HL = 8, HR = 9, VLN = 10;
const ALL = [K, S, H, SH, R, WOMP, STAB, TRP, HL, HR, VLN];
const DRUMS = [K, S, H, SH, R];
const NOT_VIOLIN = ALL.filter((t) => t !== VLN);
const b = (bar: number) => bar * 4; // bar (0-based) to beat

/** Cycle starts (beats) from bar `from` up to bar `to`. */
const cycles = (from: number, to: number) => {
  const out: number[] = [];
  for (let c = b(from); c < b(to); c += T.CYCLE) out.push(c);
  return out;
};

export function longTrail(): Project {
  const p = applyKit({ ...demoProject(), bars: BARS }, KITS[1]);
  const tracks = p.tracks.slice();
  const put = (i: number, d: Partial<TrackDoc>) => { tracks[i] = { ...tracks[i], ...d }; };
  put(WOMP, { name: "Womp bass", kind: "synth", root: T.A1, params: T.womp() });
  put(STAB, { name: "Stabs", kind: "synth", root: 60, params: T.stabs() });
  put(TRP, { name: "Trumpet", kind: "synth", root: 72, params: T.trumpet() });
  put(HL, { name: "Horns L", kind: "synth", root: 48, params: T.horn(1.004, -0.8) });
  put(HR, { name: "Horns R", kind: "synth", root: 48, params: T.horn(0.996, 0.8) });
  put(VLN, { name: "Violin", kind: "synth", root: 72, params: T.violin() });
  const notes: Note[][] = tracks.map(() => []);
  const add = (t: number, ns: Note[]) => { for (const n of ns) notes[t].push(n); };
  const base = (t: number, i: number) => tracks[t].params[i];

  // ---- automation, written in time order per lane ----
  const lanes = new Map<string, { t: number; i: number; pts: [number, number][]; cur: number }>();
  const lane = (t: number, i: number) => {
    const k = `${t}:${i}`;
    if (!lanes.has(k)) lanes.set(k, { t, i, pts: [[0, base(t, i)]], cur: base(t, i) });
    return lanes.get(k)!;
  };
  /** Jump to v at beat x. */
  const step = (t: number, i: number, x: number, v: number) => { const l = lane(t, i); l.pts.push([x, l.cur], [x, v]); l.cur = v; };
  /** A straight line from wherever it is at x0 to v at x1. */
  const ramp = (t: number, i: number, x0: number, x1: number, v: number) => { const l = lane(t, i); l.pts.push([x0, l.cur], [x1, v]); l.cur = v; };
  /** Silence these tracks from x0 to x1 (gain), then back. */
  const cut = (ts: number[], x0: number, x1: number) => { for (const t of ts) { step(t, P.GAIN, x0, 0); step(t, P.GAIN, x1, base(t, P.GAIN)); } };
  const articulate = (x: number, how: [number, number][]) => { for (const [i, v] of how) step(VLN, i, x, v); };

  // ---- drums ----
  const roller = GROOVES[0], late = GROOVES.find((g) => g.name === "Late night")!;
  const roots = tracks.map((t) => t.root);
  /** A lane of a groove from bar `from` to `to`, an octave down when `deep`. */
  const drum = (t: number, from: number, to: number, deep: boolean, g = roller) =>
    add(t, laneNotes(g, t, to - from, roots[t]).map((n) => ({ ...n, s: n.s + b(from), m: n.m - (deep ? 12 : 0) })));
  /** A snare roll that tightens: quarters, eighths, sixteenths, thirty-seconds, getting louder. */
  const roll = (from: number, to: number, deep = false) => {
    const x0 = b(from), x1 = b(to), len = x1 - x0;
    for (let x = x0; x < x1;) {
      const f = (x - x0) / len;
      const stepLen = f < 0.5 ? 1 : f < 0.75 ? 0.5 : f < 0.9 ? 0.25 : 0.125;
      notes[S].push({ s: x, l: Math.min(stepLen, 0.25), m: roots[S] - (deep ? 12 : 0), v: 0.4 + 0.6 * f });
      x += stepLen;
    }
  };
  const fourFloor = (from: number, to: number) => { for (let x = b(from); x < b(to); x++) notes[K].push({ s: x, l: 0.25, m: roots[K], v: 0.95 }); };

  // ---- the parts ----
  const womp = (from: number, to: number) => { for (const c of cycles(from, to)) add(WOMP, T.toNotes(T.BASS, c)); };
  const stabs = (from: number, to: number) => { for (const c of cycles(from, to)) add(STAB, T.stabNotes(c)); };
  const horns = (from: number, to: number, v = 0.8) => { for (const c of cycles(from, to)) { add(HL, T.hornNotes(c, v)); add(HR, T.hornNotes(c + T.HAAS, v)); } };
  const trumpet = (from: number, to: number) => { for (const c of cycles(from, to)) add(TRP, T.toNotes(T.TRUMPET, c)); };
  const pizz = (from: number, to: number, stepLen = 0.5, up = 0) => { for (const c of cycles(from, to)) add(VLN, T.pizzNotes(c, stepLen, up)); };
  const theme = (ph: T.Phrase, from: number, to: number, scale = 1) => {
    for (let c = b(from); c < b(to); c += T.CYCLE * scale) add(VLN, T.toNotes(ph, c, scale).filter((n) => n.s >= b(from) - 1 && n.s < b(to)));
  };

  // Dawn, bars 1-32: everything starts behind a closed hi-cut and opens over the section.
  for (const t of ALL) { step(t, P.HICUT, 0, 0.5); ramp(t, P.HICUT, 0, b(32), 0); }
  articulate(0, T.PIZZ);
  pizz(0, 32);
  horns(8, 32, 0.5);
  drum(H, 0, 32, true); drum(SH, 0, 32, true); drum(R, 8, 32, true);
  drum(K, 16, 32, true); drum(S, 24, 32, true);
  for (const t of DRUMS) { step(t, P.LOCUT, 0, 0.35); ramp(t, P.LOCUT, b(16), b(32), 0); }

  // Trailhead, bars 33-64: the deep two-step, the womp rising out of its own hi-cut.
  for (const t of [K, S, H, SH]) drum(t, 32, 64, true);
  pizz(32, 64);
  womp(32, 64);
  step(WOMP, P.HICUT, b(32), 0.45); ramp(WOMP, P.HICUT, b(32), b(64), 0);
  stabs(40, 64);

  // Canyon, bars 65-128: trumpet throws, then the bowed theme; the horns come under it.
  for (const t of DRUMS) { drum(t, 64, 96, true); drum(t, 96, 128, false); }
  womp(64, 128); stabs(64, 128);
  pizz(64, 96);
  trumpet(64, 96);
  articulate(b(96) - 1, T.ARCO);
  theme(T.VIOLIN_A, 96, 128);
  horns(96, 128);
  // the horns sit under the violin: darker, thinner
  step(HL, P.HICUT, b(96), 0.25); step(HR, P.HICUT, b(96), 0.25);

  // Starfield, bars 129-176: the breakdown. Slow themes, horns, a ride; then a
  // pizzicato build under a low-cut that climbs over everything but the violin.
  drum(R, 128, 160, false); drum(SH, 128, 160, false);
  horns(128, 176);
  stabs(128, 160);
  theme(T.VIOLIN_A, 128, 144, 2); theme(T.VIOLIN_B, 144, 160, 2);
  articulate(b(160), T.PIZZ);
  pizz(160, 176, 0.25);
  drum(H, 160, 176, false); roll(160, 176); fourFloor(168, 176);
  for (const t of NOT_VIOLIN) { ramp(t, P.LOCUT, b(160), b(176) - 1, 0.45); step(t, P.LOCUT, b(176), 0); }
  cut(NOT_VIOLIN, b(176) - 1, b(176));

  // Summit, bars 177-240: the drop. Drums up an octave, the womp wobbling on
  // quarter notes, both themes bowed, stabs thinned so the violin sits on top.
  for (const t of DRUMS) drum(t, 176, 240, false);
  womp(176, 240); stabs(176, 240); horns(176, 240);
  step(WOMP, P.LFO_RATE, b(176), 2.87); step(WOMP, P.LFO_CUT, b(176), 0.5);
  step(STAB, P.LOCUT, b(176), 0.25);
  articulate(b(176) - 1, T.ARCO);
  theme(T.VIOLIN_A, 176, 184); theme(T.VIOLIN_B, 184, 192); theme(T.VIOLIN_A, 192, 200); theme(T.VIOLIN_B, 200, 208);
  theme(T.VIOLIN_A, 208, 224, 2); theme(T.VIOLIN_B, 224, 240);
  trumpet(216, 224);

  // Dub Valley, bars 241-304: half-time, deep; the trumpet throws into the
  // delay while the drums sink under a hi-cut and come back up.
  for (const t of [K, S, H]) drum(t, 240, 304, true, late);
  drum(SH, 240, 304, true);
  step(WOMP, P.LFO_RATE, b(240), 0.16); step(WOMP, P.LFO_CUT, b(240), 0.25); step(STAB, P.LOCUT, b(240), 0);
  womp(240, 304); stabs(240, 304);
  trumpet(240, 304);
  articulate(b(240), T.PIZZ);
  pizz(256, 304, 1);
  for (const t of DRUMS) { ramp(t, P.HICUT, b(248), b(280), 0.35); ramp(t, P.HICUT, b(280), b(304), 0); }
  step(HL, P.HICUT, b(240), 0); step(HR, P.HICUT, b(240), 0);
  horns(272, 304, 0.6);

  // Switchbacks, bars 305-336: the second build. Sixteenth plucks, a roll, the low-cut climbing.
  drum(H, 304, 336, true); drum(SH, 304, 336, true);
  womp(304, 320);
  pizz(304, 320, 0.5); pizz(320, 336, 0.25, 12);
  roll(320, 336); fourFloor(328, 336);
  for (const t of NOT_VIOLIN) { ramp(t, P.LOCUT, b(304), b(336) - 1, 0.5); step(t, P.LOCUT, b(336), 0); }
  cut(NOT_VIOLIN, b(336) - 1, b(336));

  // Ridgeline, bars 337-400: everything. The themes, the trumpet answering, horns, the womp wobbling again later.
  for (const t of DRUMS) drum(t, 336, 400, false);
  womp(336, 400); stabs(336, 400); horns(336, 400);
  articulate(b(336) - 1, T.ARCO);
  theme(T.VIOLIN_B, 336, 344); theme(T.VIOLIN_A, 344, 352); theme(T.VIOLIN_B, 352, 360); theme(T.VIOLIN_A, 360, 368);
  trumpet(368, 384);
  theme(T.VIOLIN_A, 368, 400, 2);
  step(WOMP, P.LFO_RATE, b(368), 2.87); step(WOMP, P.LFO_CUT, b(368), 0.5);

  // Last Light, bars 401-432: the kit leaves piece by piece; everything closes down.
  step(WOMP, P.LFO_RATE, b(400), 0.16); step(WOMP, P.LFO_CUT, b(400), 0.15);
  drum(H, 400, 432, true); drum(SH, 400, 408, true); drum(S, 400, 416, true); drum(K, 400, 424, true);
  womp(400, 416);
  horns(400, 432, 0.6);
  articulate(b(400), T.PIZZ);
  pizz(400, 424, 1);
  articulate(b(424), T.ARCO);
  add(VLN, [{ s: b(424), l: 30, m: 81, v: 0.8 }]);
  for (const t of ALL) ramp(t, P.HICUT, b(400), b(432), 0.6);

  // ---- tracks ----
  const auto: Lane[][] = tracks.map(() => []);
  for (const l of lanes.values()) auto[l.t].push({ i: l.i, pts: l.pts });
  return {
    ...p, bpm: 172, swing: 0.2, space: 0.8,
    tracks: tracks.map((t, i) => ({ ...t, notes: i === 11 ? [] : notes[i].sort((x, y) => x.s - y.s || x.m - y.m), auto: auto[i] })),
  };
}
