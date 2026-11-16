// The amp page's audio thread: whatever comes in (the riff or a guitar) through
// the pedalboard (src/amp/board.ts, built by live.ts), out to the speakers
// through a limiter at −1 dBFS, with a meter report to the page 30 times a second.
import type { Board } from "./board.ts";
import { FULL_SCALE, applySettings, limit } from "./live.ts";
import type { AmpSettings, FromAmp, ToAmp } from "./messages.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

const REPORT_EVERY = 1 / 30; // seconds

class AmpProcessor extends AudioWorkletProcessor {
  private board: Board | null = null;
  private pending: AmpSettings | null = null;
  private bypass = false;
  private input = new Float32Array(128);
  private outL = new Float32Array(128);
  private outR = new Float32Array(128);
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
      this.board = applySettings(this.pending, this.board, sampleRate);
      this.bypass = this.pending.bypass;
      this.pending = null;
    }
    const [left, right] = outputs[0];
    const n = left.length;
    if (this.input.length < n) { this.input = new Float32Array(n); this.outL = new Float32Array(n); this.outR = new Float32Array(n); }
    const src = inputs[0]?.[0];
    if (src) this.input.set(src.subarray(0, n)); else this.input.fill(0, 0, n);
    const board = this.bypass ? null : this.board;
    if (board) board.process(this.input, this.outL, this.outR, n);
    for (let i = 0; i < n; i++) {
      const l = limit(board ? this.outL[i] / FULL_SCALE : this.input[i]);
      const r = limit(board ? this.outR[i] / FULL_SCALE : this.input[i]);
      left[i] = l;
      if (right) right[i] = r;
      const a = Math.max(Math.abs(l), Math.abs(r));
      if (a > this.peak) this.peak = a;
    }
    // Date.now() ticks in whole milliseconds, but summed over a report it averages out.
    this.busyMs += Date.now() - t0;
    this.frames += n;
    if (this.frames >= REPORT_EVERY * sampleRate) {
      const budget = (this.frames / sampleRate) * 1000;
      const msg: FromAmp = {
        t: "meter",
        levels: board ? board.levels() : [],
        out: this.peak,
        load: this.busyMs / budget,
        slots: (this.board?.times() ?? []).map((s) => ({ id: s.id, load: s.ms / budget })),
        stereo: !!board?.stereo,
        chain: this.board?.chain ?? "",
        misses: this.board?.misses ?? 0,
      };
      this.port.postMessage(msg);
      this.frames = 0; this.busyMs = 0; this.peak = 0;
    }
    return true;
  }
}

registerProcessor("q-amp", AmpProcessor);
