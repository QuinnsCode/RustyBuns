// A QDJ deck's voice (engine.ts drives it): it plays the track wherever the deck's motion (player.ts `Motion`) says
// it is, sample by sample: straight through at the deck's speed (tempo and pitch together, as a turntable does, and
// always so while the motor starts or brakes), or with master tempo on, at its own pitch (stretch.ts) once the speed
// holds. A loop wraps it. The page posts `{ track }` (the channels, moved here, and their rate), `{ motion }`, `{ loop }`
// and `{ keylock }`; both sides read the same motion, so the page's playhead is where this is playing.
import { inLoop } from "./analyze.ts";
import { readAt, speedAt, travel, type Motion } from "./player.ts";
import { Stretch } from "./stretch.ts";
import { check, num, obj } from "@rustybuns/util/guard";

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

const isChans = (v: unknown): v is Float32Array[] => Array.isArray(v) && v.length > 0 && v.every((c) => c instanceof Float32Array);
const N = num(-1e9, 1e9);
const MotionMsg = obj({ from: N, at: N, r0: N, r1: N, T: N });
const LoopMsg = obj({ start: N, end: N });

class DeckProcessor extends AudioWorkletProcessor {
  private chans: Float32Array[] = [];
  private rate = sampleRate;
  private m: Motion = { from: 0, at: 0, r0: 0, r1: 0, T: 0 };
  private loop: { start: number; end: number } | null = null;
  private keylock = false;
  private stretch: Stretch | null = null;
  /** How much of the output is the stretch's (0 to 1), and the voice's level (0 silent, 1 playing): both glide, so nothing clicks. */
  private mix = 0;
  private env = 0;
  private readonly glide = 1 - Math.exp(-1 / (sampleRate * 0.004));
  private readonly two = new Float32Array(2);
  private readonly read = (c: number, s: number) => readAt(this.chans[c] ?? this.chans[0]!, inLoop(s, this.loop) * this.rate);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<unknown>) => {
      const m = e.data;
      if (typeof m !== "object" || m === null) return;
      if ("track" in m) {
        const t = m.track;
        if (t === null) { this.chans = []; this.stretch = null; }
        else if (typeof t === "object" && "chans" in t && isChans(t.chans) && "rate" in t && typeof t.rate === "number") {
          this.chans = t.chans; this.rate = t.rate;
          this.stretch = new Stretch(Math.min(2, t.chans.length), sampleRate, t.rate);
        }
      }
      if ("motion" in m) { const mo = check(MotionMsg, m.motion); if (mo) this.m = mo; }
      if ("loop" in m) this.loop = m.loop === null ? null : check(LoopMsg, m.loop);
      if ("keylock" in m && typeof m.keylock === "boolean") this.keylock = m.keylock;
    };
  }

  private posAt(t: number) { return inLoop(this.m.from + travel(this.m, t - this.m.at), this.loop); }

  process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]!, left = out[0]!, right = out[1], n = left.length;
    if (!this.chans.length || !this.stretch) { for (const c of out) c.fill(0); this.env = 0; this.mix = 0; return true; }
    const m = this.m, st = this.stretch, two = this.two, stereo = this.chans.length > 1;
    for (let i = 0; i < n; i++) {
      const t = currentTime + i / sampleRate, e = t - m.at;
      const speed = speedAt(m, e), ramping = m.T > 0 && e < m.T;
      const lock = this.keylock && !ramping && speed >= 0.25 && speed <= 2.01 && Math.abs(speed - 1) > 1e-4;
      if (lock && this.mix < 1e-3) st.reset();
      this.mix += ((lock ? 1 : 0) - this.mix) * this.glide;
      this.env += ((speed !== 0 || ramping ? 1 : 0) - this.env) * this.glide;
      const p = this.posAt(t);
      let l = this.read(0, p), r = stereo ? this.read(1, p) : l;
      if (this.mix > 1e-3) {
        st.next(two, this.read, (k) => this.posAt(t + k / sampleRate));
        const sl = two[0]!, sr = stereo ? two[1]! : sl;
        l += (sl - l) * this.mix; r += (sr - r) * this.mix;
      }
      left[i] = l * this.env;
      if (right) right[i] = r * this.env;
    }
    return true;
  }
}

registerProcessor("q-deck", DeckProcessor);
