// Render the current project without the audio thread: bounce and bench.
import { sendTrackEq, type FmEngine } from "./engine.ts";
import { renderPattern } from "./sequencer.ts";
import { Space } from "./space.ts";
import { Squash } from "./squash.ts";
import { TsEq, flatEq, withEqLane, type EqStage } from "./eq.ts";
import { LinearEq, linearLatency } from "./linear.ts";
import { P } from "./params.ts";
import { PluginRoute } from "./plugin-route.ts";
import type { PluginEvent } from "../plugin-track.ts";
import { audible, loopBeats, type Project } from "../project.ts";
import { TakeDeck } from "../take.ts";
import { AmpInserts } from "../amp/insert.ts";
import type { AmpSettings } from "../amp/messages.ts";
import { faderGain, RigReturn, shapeStage, UNITY } from "../mixer.ts";

/** Frames a bounce of `seconds` renders: linear phase holds the mix back, so that much more, dropped off the front. */
export const bounceFrames = (p: Project, sampleRate: number, seconds: number) => Math.round(seconds * sampleRate) + (p.eqLinear ? linearLatency(sampleRate) : 0);

/** An engine that plays nothing: the sequencer runs over it to find what it would play. */
const NOTHING: FmEngine = {
  setParam() {}, setMute() {}, setMaster() {}, setTempo() {}, setBeat() {}, setBend() {}, noteOn() {}, noteOff() {}, allOff() {}, panic() {},
  click() {}, setTrackBand() {}, setTap() {}, render() {}, meter() {},
};

/**
 * What each heard plugin track plays over `frames` of the project, each note `at` its frame: the host renders the
 * track from this (src/ui/plugins.ts, `bouncePlugins`), as there is no plugin in the page to play it.
 */
export function pluginScore(p: Project, sampleRate: number, frames: number): Map<number, PluginEvent[]> {
  const hears = audible(p), route = new PluginRoute(sampleRate);
  p.tracks.forEach((t, ti) => { if (t.plugin && hears[ti]) route.set(ti, true); });
  const score = new Map<number, PluginEvent[]>();
  if (!route.any) return score;
  renderPattern(route.wrap(NOTHING), sampleRate, frames / sampleRate, (seq) => {
    p.tracks.forEach((t, ti) => { seq.setNotes(ti, t.notes); seq.setAuto(ti, t.auto ?? []); });
    seq.bpm = p.bpm; seq.setSwing(p.swing); seq.setLoopBeats(loopBeats(p)); seq.setAudible(hears);
  });
  p.tracks.forEach((_, ti) => { if (route.has(ti)) score.set(ti, route.score(ti)); });
  return score;
}

/**
 * The project as it plays, offline. `takes` gives a take's sound by id (the page keeps it): each track's take
 * is mixed in after the engine and before the master EQ (through its Amp insert when it has one, with the track's
 * synth tapped out of the engine after its Shape), as the audio thread does, so the bounce sounds like playback.
 * `plugins` gives a plugin track's sound as the host rendered it (interleaved stereo, `bounceFrames` long): it goes
 * down the track's strip (PAN, Shape, fader, SEND) into the mix where the takes do. Without it the track is silent.
 * `aux2`: the gear cabled into the desk's aux 2 return (the sesh's gear room patch); the tracks' sends to it come
 * back on the return's fader, through its Shape; the Space return's Shape plays on the sends into Space. The players'
 * channels are live sound, so a bounce has none of them.
 */
export function renderProject(engine: FmEngine, p: Project, sampleRate: number, seconds: number, masterGain: number, takes?: (id: string) => Float32Array | undefined, plugins?: (track: number) => Float32Array | undefined, aux2?: AmpSettings | null): Float32Array {
  const frames = Math.round(seconds * sampleRate);
  const eq: EqStage = p.eqLinear ? new LinearEq(sampleRate) : new TsEq(sampleRate);
  // linear phase holds the mix back: render that much more and drop it off the front, so beat one is at 0
  const late = eq.latency ?? 0;
  const send = new Float32Array((frames + late) * 2);
  let played = p.eq;
  eq.set(played);
  eq.reset();
  const deck = new TakeDeck(p.tracks.length, sampleRate);
  p.tracks.forEach((t, ti) => { if (t.take) deck.set(ti, takes?.(t.take.id) ?? null, t.take.beat); });
  const amps = new AmpInserts(p.tracks.length, sampleRate);
  p.tracks.forEach((t, ti) => { if (t.amp) amps.set(ti, t.amp); });
  const tapping = amps.any;
  const hears = audible(p), beats = loopBeats(p);
  const ret = p.desk?.aux2 ?? { fader: UNITY, mute: false };
  const rig = aux2 && !ret.mute && p.tracks.some((t) => t.params[P.SEND2] > 0) ? new RigReturn(sampleRate, aux2) : null;
  const send2 = rig ? new Float32Array((frames + late) * 2) : undefined;
  const bus = new Float32Array(128), wet = new Float32Array(256), back = faderGain(ret.fader);
  // each return's own Shape, as the desk plays it live: aux 2's on what its gear hands back, Space's on what goes in
  const retEq = rig && ret.eq ? shapeStage(null, ret.eq, sampleRate) : null;
  const spaceEq = p.desk?.space?.eq ? shapeStage(null, p.desk.space.eq, sampleRate) : null;
  // a plugin track's notes are the plugin's, not its FM voice's, whether or not its sound came
  const route = new PluginRoute(sampleRate);
  p.tracks.forEach((t, ti) => {
    if (!t.plugin) return;
    route.shape(ti, t.eq ?? flatEq());
    route.set(ti, true);
    const pcm = hears[ti] ? plugins?.(ti) : undefined;
    if (pcm) route.push(ti, pcm, true);
  });
  // where each param is as the groove plays: a lane on a plugin track's Level, Pan or Send moves its strip
  const now = p.tracks.map((t) => [...t.params]);
  const param = (t: number, i: number) => now[t]?.[i] ?? 0;
  const strip = { gain: (t: number) => (hears[t] ? param(t, P.GAIN) * masterGain : 0), pan: (t: number) => param(t, P.PAN), send: (t: number) => param(t, P.SEND) };
  let at = 0;
  const all = renderPattern(route.any ? route.wrap(engine, (t, i, v) => { const row = now[t]; if (row) row[i] = v; }) : engine, sampleRate, (frames + late) / sampleRate, (seq) => {
    p.tracks.forEach((t, ti) => { t.params.forEach((v, i) => engine.setParam(ti, i, v)); seq.setNotes(ti, t.notes); seq.setAuto(ti, t.auto ?? []); engine.setTap(ti, amps.has(ti)); });
    // each track's Shape plays from the first sample, not fading in
    if (p.tracks.some((t) => t.eq)) { p.tracks.forEach((t, ti) => { if (t.eq) sendTrackEq(engine, ti, t.eq, []); }); engine.panic(); }
    seq.bpm = p.bpm; seq.setSwing(p.swing); seq.setLoopBeats(loopBeats(p)); seq.setAudible(audible(p));
    engine.setMaster(masterGain);
    seq.setEqAuto(p.eqAuto ?? []);
    seq.onEq = (i, v) => { const d = withEqLane(played, i, v); if (d !== played) { played = d; eq.set(d); } };
  }, send, (block, n, taps) => {
    if (deck.any || tapping) amps.mix(deck, block, n, (at / sampleRate) * (p.bpm / 60), p.bpm, beats, (t) => hears[t], masterGain, true, undefined, taps);
    if (rig && send2) {
      for (let f = 0; f < n; f++) bus[f] = (send2[(at + f) * 2] + send2[(at + f) * 2 + 1]) * 0.5;
      rig.process(bus, wet, n);
      retEq?.process(wet, n);
      for (let f = 0; f < n * 2; f++) block[f] += wet[f] * back;
    }
    if (route.any) route.mix(block, n, strip, send.subarray(at * 2, (at + n) * 2));
    at += n;
    eq.process(block, n);
  }, tapping, send2);
  // the send skips the EQ, so it is already on time: the trimmed mix lines up with its start
  const out = all.slice(late * 2, (late + frames) * 2), sent = send.subarray(0, frames * 2);
  const squash = new Squash(sampleRate);
  squash.setAmount(p.squash);
  squash.process(out, out.length >> 1);
  const space = new Space(sampleRate);
  space.setTempo(p.bpm);
  space.setAmount(p.space);
  spaceEq?.process(sent, out.length >> 1);
  space.process(out, sent, out.length >> 1);
  return out;
}

/** Seconds for n loops, plus a tail for releases. */
export const loopSeconds = (p: Project, loops: number) => (loopBeats(p) * loops * 60) / p.bpm + 1.5;
