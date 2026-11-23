// The sound wall on its own audio thread (src/wall/wall.ts, WALL.md): the modules in the case and the patch cables
// between them, run a sample at a time, out of its Q Out modules to both speakers. The page sends the wall whenever
// the room changes it (`listen().wall.spec`), the keys played and the sesh's tempo for Q Keys, and asks what each
// module is doing for its probe.
import { Wall, type WallSpec } from "../wall/wall.ts";
import { limit } from "../amp/live.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

export type ToWall = { t: "wall"; spec: WallSpec } | { t: "note"; midi: number; vel: number } | { t: "tempo"; bpm: number; beat: number | null } | { t: "state" };
export type FromWall = { t: "state"; modules: ReturnType<Wall["state"]>; load: number };

class WallProcessor extends AudioWorkletProcessor {
  private readonly wall = new Wall(sampleRate);
  private right = new Float32Array(128);
  /** How much of the audio thread's time the wall took, the last block. */
  private load = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToWall>) => {
      const m = e.data;
      if (m.t === "wall") this.wall.set(m.spec);
      else if (m.t === "note") this.wall.note(m.midi, m.vel);
      else if (m.t === "tempo") this.wall.tempo(m.bpm, m.beat);
      else this.port.postMessage({ t: "state", modules: this.wall.state(), load: this.load } satisfies FromWall);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0];
    const n = left.length;
    if (this.right.length < n) this.right = new Float32Array(n);
    const r = right ?? this.right, t = Date.now();
    this.wall.process(left, r, n);
    // Date.now is whole milliseconds here, so the load is a running average over about a second of blocks.
    this.load += 0.003 * ((Date.now() - t) / ((n / sampleRate) * 1000) - this.load);
    for (let i = 0; i < n; i++) { left[i] = limit(left[i]); r[i] = limit(r[i]); }
    return true;
  }
}

registerProcessor("q-wall", WallProcessor);
