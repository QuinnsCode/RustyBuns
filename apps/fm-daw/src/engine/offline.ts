// Render the current project without the audio thread: bounce and bench.
import { sendTrackEq, type FmEngine } from "./engine.ts";
import { renderPattern } from "./sequencer.ts";
import { Space } from "./space.ts";
import { Squash } from "./squash.ts";
import { TsEq, withEqLane, type EqStage } from "./eq.ts";
import { LinearEq } from "./linear.ts";
import { audible, loopBeats, type Project } from "../project.ts";
import { TakeDeck } from "../take.ts";
import { P } from "./params.ts";
import { AmpInserts } from "../amp/insert.ts";
import type { AmpSettings } from "../amp/messages.ts";
import { faderGain, RigReturn, UNITY } from "../mixer.ts";

/**
 * The project as it plays, offline. `takes` gives a take's sound by id (the page keeps it): each track's take
 * is mixed in after the engine and before the master EQ (through its Amp insert when it has one, with the track's
 * synth tapped out of the engine after its Shape), as the audio thread does, so the bounce sounds like playback.
 * `aux2`: the gear cabled into the desk's aux 2 return (the sesh's gear room patch); the tracks' sends to it come
 * back on the return's fader. The players' channels are live sound, so a bounce has none of them.
 */
export function renderProject(engine: FmEngine, p: Project, sampleRate: number, seconds: number, masterGain: number, takes?: (id: string) => Float32Array | undefined, aux2?: AmpSettings | null): Float32Array {
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
  let at = 0;
  const all = renderPattern(engine, sampleRate, (frames + late) / sampleRate, (seq) => {
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
      for (let f = 0; f < n * 2; f++) block[f] += wet[f] * back;
    }
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
  space.process(out, sent, out.length >> 1);
  return out;
}

/** Seconds for n loops, plus a tail for releases. */
export const loopSeconds = (p: Project, loops: number) => (loopBeats(p) * loops * 60) / p.bpm + 1.5;
