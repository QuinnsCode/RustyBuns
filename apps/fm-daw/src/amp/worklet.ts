// The amp page's audio thread: whatever comes in (the riff or a guitar) through
// the rig (src/amp/live.ts), out to both speakers through a limiter at −1 dBFS,
// with a meter report to the page 30 times a second. Split across threads (ring.ts),
// it plays the rig's first part and the speakers get the last part's blocks back.
import { limit } from "./live.ts";
import { Head, REPORT_EVERY } from "./ring.ts";
import type { FromAmp, ToAmp } from "./messages.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

class AmpProcessor extends AudioWorkletProcessor {
  private head = new Head(sampleRate);
  private input = new Float32Array(128);
  private output = new Float32Array(128);
  private busyMs = 0;
  private frames = 0;
  private peak = 0;

  constructor() {
    super();
    // Knob drags send many; only the newest is applied, at the start of the next block.
    this.port.onmessage = (e: MessageEvent<ToAmp>) => { if (e.data.t === "set") this.head.set(e.data); else this.head.connect(e.data.rings); };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const t0 = Date.now();
    const [left, right] = outputs[0];
    const n = left.length;
    if (this.input.length < n) { this.input = new Float32Array(n); this.output = new Float32Array(n); }
    const src = inputs[0]?.[0];
    if (src) this.input.set(src.subarray(0, n)); else this.input.fill(0, 0, n);
    const played = this.head.block(this.input, this.output, n);
    const scale = this.head.scale;
    for (let i = 0; i < n; i++) {
      const y = limit(played ? this.output[i] / scale : this.input[i]);
      left[i] = y;
      if (right) right[i] = y;
      if (Math.abs(y) > this.peak) this.peak = Math.abs(y);
    }
    // Date.now() ticks in whole milliseconds, but summed over a report it averages out.
    this.busyMs += Date.now() - t0;
    this.frames += n;
    if (this.frames >= REPORT_EVERY * sampleRate) {
      const rig = played ? this.head.live?.rig : null;
      const msg: FromAmp = {
        t: "meter",
        levels: rig ? rig.levels() : [],
        out: this.peak,
        load: this.busyMs / ((this.frames / sampleRate) * 1000),
        misses: this.head.live?.rig.misses ?? 0,
        work: rig ? rig.work() : [],
        late: this.head.late,
      };
      this.port.postMessage(msg);
      this.frames = 0; this.busyMs = 0; this.peak = 0;
    }
    return true;
  }
}

registerProcessor("q-amp", AmpProcessor);
