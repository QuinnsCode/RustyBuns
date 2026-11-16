// Render the current project without the audio thread: bounce and bench.
import type { FmEngine } from "./engine.ts";
import { renderPattern } from "./sequencer.ts";
import { Space } from "./space.ts";
import { Squash } from "./squash.ts";
import { TsEq, withEqLane, type EqStage } from "./eq.ts";
import { LinearEq } from "./linear.ts";
import { audible, loopBeats, type Project } from "../project.ts";

export function renderProject(engine: FmEngine, p: Project, sampleRate: number, seconds: number, masterGain: number): Float32Array {
  const frames = Math.round(seconds * sampleRate);
  const eq: EqStage = p.eqLinear ? new LinearEq(sampleRate) : new TsEq(sampleRate);
  // linear phase holds the mix back: render that much more and drop it off the front, so beat one is at 0
  const late = eq.latency ?? 0;
  const send = new Float32Array((frames + late) * 2);
  let played = p.eq;
  eq.set(played);
  eq.reset();
  const all = renderPattern(engine, sampleRate, (frames + late) / sampleRate, (seq) => {
    p.tracks.forEach((t, ti) => { t.params.forEach((v, i) => engine.setParam(ti, i, v)); seq.setNotes(ti, t.notes); seq.setAuto(ti, t.auto ?? []); });
    seq.bpm = p.bpm; seq.setSwing(p.swing); seq.setLoopBeats(loopBeats(p)); seq.setAudible(audible(p));
    engine.setMaster(masterGain);
    seq.setEqAuto(p.eqAuto ?? []);
    seq.onEq = (i, v) => { const d = withEqLane(played, i, v); if (d !== played) { played = d; eq.set(d); } };
  }, send, (block, n) => eq.process(block, n));
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
