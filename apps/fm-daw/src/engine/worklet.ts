// The audio thread. Owns one FmEngine (TS, or Rust compiled to wasm) and the
// sequencer that drives it. The page talks to it only through messages; the
// worklet keeps a mirror of every param so it can swap engines mid-groove.
import { TsEngine, type FmEngine } from "./engine.ts";
import { WasmEngine, instantiateFm } from "./wasm.ts";
import { Sequencer } from "./sequencer.ts";
import { TRACKS, NPARAMS } from "./params.ts";
import type { ToWorklet } from "./messages.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

const REPORT_EVERY = 1 / 30; // seconds

class FmProcessor extends AudioWorkletProcessor {
  private params = new Float64Array(TRACKS * NPARAMS);
  private muted = new Array<boolean>(TRACKS).fill(false);
  private master = 0;
  private engine: FmEngine = new TsEngine(sampleRate);
  private kind: "ts" | "rust" = "ts";
  private seq = new Sequencer(this.engine, sampleRate);
  private buf = new Float32Array(256);
  private meter = new Float32Array(4);
  private sinceReport = 0;

  constructor() {
    super();
    this.engine.setMaster(0);
    this.seq.onRecord = (r) => this.port.postMessage({ t: "rec", ...r });
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => { void this.handle(e.data); };
  }

  private async handle(m: ToWorklet) {
    const s = this.seq;
    switch (m.t) {
      case "load":
        m.params.forEach((v, i) => { this.params[i] = v; this.engine.setParam((i / NPARAMS) | 0, i % NPARAMS, v); });
        m.notes.forEach((n, t) => s.setNotes(t, n));
        s.bpm = m.bpm; s.setSwing(m.swing); s.setLoopBeats(m.loopBeats);
        this.setAudible(m.audible);
        break;
      case "param":
        this.params[m.track * NPARAMS + m.i] = m.v;
        this.engine.setParam(m.track, m.i, m.v);
        break;
      case "notes": s.setNotes(m.track, m.notes); break;
      case "audible": this.setAudible(m.mask); break;
      case "tempo": s.bpm = m.bpm; s.setSwing(m.swing); s.setLoopBeats(m.loopBeats); break;
      case "master": this.master = m.gain; this.engine.setMaster(m.gain); break;
      case "play": s.play(m.countIn); break;
      case "stop": s.stop(); this.engine.allOff(); break;
      case "rec": s.recording = m.on; break;
      case "metro": s.metronome = m.on; break;
      case "latency": s.latency = m.seconds; break;
      case "on": s.liveOn(m.track, m.midi, m.vel); break;
      case "off": s.liveOff(m.track, m.midi); break;
      case "panic": s.stop(); this.engine.panic(); break;
      case "engine": await this.swap(m); break;
    }
  }

  private setAudible(mask: boolean[]) {
    for (let t = 0; t < TRACKS; t++) this.muted[t] = !mask[t];
    this.seq.setAudible(mask);
  }

  private async swap(m: Extract<ToWorklet, { t: "engine" }>) {
    try {
      const next: FmEngine = m.kind === "rust" && m.bytes
        ? new WasmEngine(await instantiateFm(m.bytes), sampleRate)
        : new TsEngine(sampleRate);
      for (let i = 0; i < this.params.length; i++) next.setParam((i / NPARAMS) | 0, i % NPARAMS, this.params[i]);
      for (let t = 0; t < TRACKS; t++) next.setMute(t, this.muted[t]);
      next.setMaster(this.master);
      const old = this.engine;
      this.engine = next;
      this.seq.engine = next;
      this.kind = m.kind;
      old.panic();
      old.free?.();
      this.port.postMessage({ t: "engine", kind: this.kind });
    } catch (e) {
      this.port.postMessage({ t: "engine", kind: this.kind, error: String((e as Error)?.message ?? e) });
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0], R = out[1] ?? out[0];
    const frames = L.length;
    if (this.buf.length < frames * 2) this.buf = new Float32Array(frames * 2);
    try {
      this.seq.process(this.buf, frames);
    } catch (e) {
      // A trapped wasm engine: fall back to TS rather than go silent for good.
      this.buf.fill(0);
      if (this.kind === "rust") void this.swap({ t: "engine", kind: "ts" });
      this.port.postMessage({ t: "engine", kind: "ts", error: `engine crashed: ${String((e as Error)?.message ?? e)}` });
    }
    for (let f = 0; f < frames; f++) { L[f] = this.buf[f * 2]; R[f] = this.buf[f * 2 + 1]; }
    this.sinceReport += frames / sampleRate;
    if (this.sinceReport >= REPORT_EVERY) {
      this.sinceReport = 0;
      this.engine.meter(this.meter);
      this.port.postMessage({
        t: "tick", pos: this.seq.pos, playing: this.seq.playing, countIn: this.seq.countIn,
        peakL: this.meter[0], peakR: this.meter[1], minGain: this.meter[2], nans: this.meter[3],
      });
    }
    return true;
  }
}

registerProcessor("fm-daw", FmProcessor);
