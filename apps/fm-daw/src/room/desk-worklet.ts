// The gear room's desk on the audio thread: what comes in (Q Amp's output, the guitar's channel) through the desk
// (src/mixer.ts), its aux returns running FM DAW's Space or the gear cabled into them, out to both speakers.
import { AUXES, Mixer, RigReturn, SpaceReturn, type Desk } from "../mixer.ts";
import { limit } from "../amp/live.ts";
import type { AmpSettings } from "../amp/messages.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

/** The desk, and what each aux's cabled gear plays (null: nothing whole cabled in). */
export type ToDesk = { t: "desk"; desk: Desk; channel: string; cabled: (AmpSettings | null)[] };

class DeskProcessor extends AudioWorkletProcessor {
  private readonly mixer = new Mixer(sampleRate);
  private readonly space = new SpaceReturn(sampleRate);
  private readonly rigs: (RigReturn | null)[] = Array.from({ length: AUXES }, () => null);
  private readonly inputs = new Map<string, Float32Array>();
  private channel = "";
  private input = new Float32Array(128);
  private out = new Float32Array(256);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToDesk>) => {
      const m = e.data;
      this.mixer.set(m.desk);
      this.channel = m.channel;
      for (const r of m.desk.returns) {
        const i = r.aux - 1, s = m.cabled[i];
        if (r.fx === "space") { this.mixer.setReturn(r.aux, this.space); continue; }
        if (!s) { this.rigs[i] = null; this.mixer.setReturn(r.aux, null); continue; }
        if (this.rigs[i]) this.rigs[i]?.set(s); else this.rigs[i] = new RigReturn(sampleRate, s);
        this.mixer.setReturn(r.aux, this.rigs[i]);
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0];
    const n = left.length;
    if (this.input.length < n) { this.input = new Float32Array(n); this.out = new Float32Array(n * 2); }
    const src = inputs[0]?.[0];
    if (src) this.input.set(src.subarray(0, n)); else this.input.fill(0, 0, n);
    this.inputs.clear();
    if (this.channel) this.inputs.set(this.channel, this.input);
    this.mixer.process(this.inputs, this.out, n);
    for (let i = 0; i < n; i++) { left[i] = limit(this.out[i * 2]); if (right) right[i] = limit(this.out[i * 2 + 1]); }
    return true;
  }
}

registerProcessor("q-desk", DeskProcessor);
