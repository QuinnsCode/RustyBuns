// What the audio thread needs to mirror a project: the DAW and the jam room (src/studio/) both send it.
import { audible, loopBeats, type Project } from "../project.ts";
import { flatEq } from "../engine/eq.ts";
import type { ToWorklet } from "../engine/messages.ts";

/** Everything the worklet needs to mirror a project. */
export function loadMsg(p: Project): ToWorklet {
  return {
    t: "load", params: p.tracks.flatMap((t) => t.params), notes: p.tracks.map((t) => t.notes), auto: p.tracks.map((t) => t.auto ?? []),
    bpm: p.bpm, swing: p.swing, loopBeats: loopBeats(p), audible: audible(p), space: p.space, squash: p.squash, eq: p.eq, eqAuto: p.eqAuto ?? [], eqLinear: !!p.eqLinear,
    trackEq: p.tracks.map((t) => t.eq ?? flatEq()),
  };
}
