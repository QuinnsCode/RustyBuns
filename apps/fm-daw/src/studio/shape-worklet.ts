// A guitar heard on a call (guitar-line.ts) through its channel's Shape: the same TsEq the desk's audio thread runs
// on a player's channel (src/mixer.ts `Mixer`), so a call plays the Shape the desk shows. Stereo in, stereo out; a
// flat Shape passes the sound through untouched. The page posts the channel's Shape (an EqDoc) whenever it changes.
import { sanitizeEq, TsEq } from "../engine/eq.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

class ShapeProcessor extends AudioWorkletProcessor {
  private readonly eq = new TsEq(sampleRate);
  private buf = new Float32Array(256);
  private on = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<unknown>) => { const doc = sanitizeEq(e.data); this.on = doc.some(Boolean); this.eq.set(doc); };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0];
    const n = left.length, inL = inputs[0]?.[0], inR = inputs[0]?.[1] ?? inL;
    if (!inL || !inR) { left.fill(0); right?.fill(0); return true; }
    if (!this.on && !this.eq.live()) { left.set(inL.subarray(0, n)); right?.set(inR.subarray(0, n)); return true; }
    if (this.buf.length < n * 2) this.buf = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { this.buf[i * 2] = inL[i]; this.buf[i * 2 + 1] = inR[i]; }
    this.eq.process(this.buf, n);
    for (let i = 0; i < n; i++) { left[i] = this.buf[i * 2]; if (right) right[i] = this.buf[i * 2 + 1]; }
    return true;
  }
}

registerProcessor("q-shape", ShapeProcessor);
