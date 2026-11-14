// The amp page's audio thread: whatever comes in (the riff or a guitar) through
// the rig (src/amp/live.ts), out to both speakers through a limiter at −1 dBFS,
// with a meter report to the page 30 times a second.
import { FULL_SCALE, applySettings, limit, type Live } from "./live.ts";
import type { AmpSettings, FromAmp, ToAmp } from "./messages.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

const REPORT_EVERY = 1 / 30; // seconds

class AmpProcessor extends AudioWorkletProcessor {
  private live: Live | null = null;
  private pending: AmpSettings | null = null;
  private bypass = false;
  private input = new Float32Array(128);
  private output = new Float32Array(128);
  private busyMs = 0;
  private frames = 0;
  private peak = 0;

  constructor() {
    super();
    // Knob drags send many; only the newest is applied, at the start of the next block.
    this.port.onmessage = (e: MessageEvent<ToAmp>) => { if (e.data.t === "set") this.pending = e.data.settings; };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const t0 = Date.now();
    if (this.pending) {
      this.live = applySettings(this.pending, this.live, sampleRate);
      this.bypass = this.pending.bypass;
      this.pending = null;
    }
    const [left, right] = outputs[0];
    const n = left.length;
    if (this.input.length < n) { this.input = new Float32Array(n); this.output = new Float32Array(n); }
    const src = inputs[0]?.[0];
    if (src) this.input.set(src.subarray(0, n)); else this.input.fill(0, 0, n);
    const rig = this.bypass ? null : this.live?.rig;
    if (rig) rig.process(this.input, this.output, n);
    for (let i = 0; i < n; i++) {
      const y = limit(rig ? this.output[i] / FULL_SCALE : this.input[i]);
      left[i] = y;
      if (right) right[i] = y;
      if (Math.abs(y) > this.peak) this.peak = Math.abs(y);
    }
    // Date.now() ticks in whole milliseconds, but summed over a report it averages out.
    this.busyMs += Date.now() - t0;
    this.frames += n;
    if (this.frames >= REPORT_EVERY * sampleRate) {
      const msg: FromAmp = {
        t: "meter",
        levels: rig ? rig.levels() : [],
        out: this.peak,
        load: this.busyMs / ((this.frames / sampleRate) * 1000),
        misses: this.live?.rig.misses ?? 0,
      };
      this.port.postMessage(msg);
      this.frames = 0; this.busyMs = 0; this.peak = 0;
    }
    return true;
  }
}

registerProcessor("q-amp", AmpProcessor);
