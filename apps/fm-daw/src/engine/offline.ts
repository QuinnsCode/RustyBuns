// Render the current project without the audio thread: bounce and bench.
import type { FmEngine } from "./engine.ts";
import { renderPattern } from "./sequencer.ts";
import { audible, loopBeats, type Project } from "../project.ts";

export function renderProject(engine: FmEngine, p: Project, sampleRate: number, seconds: number, masterGain: number): Float32Array {
  return renderPattern(engine, sampleRate, seconds, (seq) => {
    p.tracks.forEach((t, ti) => { t.params.forEach((v, i) => engine.setParam(ti, i, v)); seq.setNotes(ti, t.notes); });
    seq.bpm = p.bpm; seq.setSwing(p.swing); seq.setLoopBeats(loopBeats(p)); seq.setAudible(audible(p));
    engine.setMaster(masterGain);
  });
}

/** Seconds for n loops, plus a tail for releases. */
export const loopSeconds = (p: Project, loops: number) => (loopBeats(p) * loops * 60) / p.bpm + 1.5;
