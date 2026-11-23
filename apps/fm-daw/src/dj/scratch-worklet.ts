// A scratch (player-panel.ts): while the DJ holds the top platter, this plays the track wherever the platter is,
// forwards or back at whatever speed the hand moves. The page posts a stretch of the track around the platter
// (`{ chans, start, rate }`), then the platter's place in seconds as it moves (`{ to }`), and `{ on: false }` on
// letting go. The read head glides after the platter (player.ts `followStep`) so a pointer's steps play smooth.
import { followCoef, followStep, readAt, scratchGain } from "./player.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

const isChans = (v: unknown): v is Float32Array[] => Array.isArray(v) && v.every((c) => c instanceof Float32Array);

class ScratchProcessor extends AudioWorkletProcessor {
  private chans: Float32Array[] = [];
  /** The stretch's first sample, in track seconds, and its sample rate. */
  private start = 0;
  private rate = sampleRate;
  private head = 0;
  private target = 0;
  private gain = 0;
  private on = false;
  private readonly a = followCoef(sampleRate);
  private readonly ga = 1 - Math.exp(-1 / (sampleRate * 0.004));

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<unknown>) => {
      const m = e.data;
      if (typeof m !== "object" || m === null) return;
      if ("chans" in m && isChans(m.chans) && "start" in m && typeof m.start === "number" && "rate" in m && typeof m.rate === "number") {
        this.chans = m.chans; this.start = m.start; this.rate = m.rate;
      }
      if ("to" in m && typeof m.to === "number") {
        if (!this.on) { this.head = m.to; this.gain = 0; }
        this.target = m.to; this.on = true;
      }
      if ("on" in m && m.on === false) this.on = false;
    };
  }

  process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]!, left = out[0]!, n = left.length;
    if (!this.on || !this.chans.length) { for (const c of out) c.fill(0); return true; }
    const l = this.chans[0]!, r = this.chans[1] ?? l;
    for (let i = 0; i < n; i++) {
      const prev = this.head;
      this.head = followStep(this.head, this.target, this.a);
      this.gain += (scratchGain((this.head - prev) * sampleRate) - this.gain) * this.ga;
      const at = (this.head - this.start) * this.rate;
      left[i] = readAt(l, at) * this.gain;
      if (out[1]) out[1][i] = readAt(r, at) * this.gain;
    }
    return true;
  }
}

registerProcessor("q-scratch", ScratchProcessor);
