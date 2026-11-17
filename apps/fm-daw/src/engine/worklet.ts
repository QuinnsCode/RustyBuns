// The audio thread. Owns one FmEngine (TS, or Rust compiled to wasm) and the
// sequencer that drives it. The page talks to it only through messages; the
// worklet keeps a mirror of every param so it can swap engines mid-groove.
import { TsEngine, sendTrackEq, type FmEngine } from "./engine.ts";
import { WasmEngine, WasmEq, instantiateFm } from "./wasm.ts";
import { TsEq, flatEq, withEqLane, type EqBand, type EqDoc, type EqListen, type EqStage } from "./eq.ts";
import { Delay, LinearEq } from "./linear.ts";
import { Sequencer } from "./sequencer.ts";
import { Space } from "./space.ts";
import { Squash } from "./squash.ts";
import { TRACKS, NPARAMS } from "./params.ts";
import { TakeCapture, TakeDeck } from "../take.ts";
import { AmpInserts } from "../amp/insert.ts";
import type { ToWorklet } from "./messages.ts";
import type { Lane } from "../project.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

const REPORT_EVERY = 1 / 30; // seconds

class FmProcessor extends AudioWorkletProcessor {
  private params = new Float64Array(TRACKS * NPARAMS);
  private muted = new Array<boolean>(TRACKS).fill(false);
  private master = 0;
  private bend = new Float64Array(TRACKS);
  private engine: FmEngine = new TsEngine(sampleRate);
  private kind: "ts" | "rust" = "ts";
  private seq = new Sequencer(this.engine, sampleRate);
  private space = new Space(sampleRate);
  private squash = new Squash(sampleRate);
  /** The EQ as saved, and as it plays right now (with its automation on). */
  private eqDoc: EqDoc = flatEq();
  private eqPlayed: EqDoc = this.eqDoc;
  private eq: EqStage = new TsEq(sampleRate);
  /** Each track's Shape, the insert inside the engine, as saved. */
  private trackEq: EqDoc[] = Array.from({ length: TRACKS }, flatEq);
  private trackLast: EqBand[][] = Array.from({ length: TRACKS }, () => []);
  /** Shape's minimum-phase stage (TS or Rust) is kept while linear phase plays, so switching back is instant. */
  private minEq: EqStage = this.eq;
  private linear: LinearEq | null = null;
  /** Space's send, held back as long as the linear EQ holds the mix. */
  private sendDelay: Delay | null = null;
  private listening: EqListen | null = null;
  /** The output's own latency, from the page; the sequencer's is this plus the EQ's. */
  private outLatency = 0;
  private buf = new Float32Array(256);
  private send = new Float32Array(256);
  private meter = new Float32Array(4);
  private sinceReport = 0;
  /** The tracks' takes, played after the engine; and the input, recorded onto `armed` while recording. */
  private deck = new TakeDeck(TRACKS, sampleRate);
  private capture = new TakeCapture(sampleRate);
  private amps = new AmpInserts(TRACKS, sampleRate);
  /** The input heard through the armed track's amp: off until the player turns it on. */
  private monitor = false;
  private armed = -1;
  private inLatency = 0;
  private capturing = false;
  /** Whole passes recorded since Rec went on: once there is one, a pass cut short by Stop doesn't replace it. */
  private passes = 0;
  private mono = new Float32Array(256);

  constructor() {
    super();
    this.engine.setMaster(0);
    this.seq.onRecord = (r) => this.port.postMessage({ t: "rec", ...r });
    this.seq.onMove = (r) => this.port.postMessage({ t: "move", ...r });
    this.seq.onEq = (i, v) => { const d = withEqLane(this.eqPlayed, i, v); if (d !== this.eqPlayed) { this.eqPlayed = d; this.eq.set(d); } };
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => { void this.handle(e.data); };
  }

  private async handle(m: ToWorklet) {
    const s = this.seq;
    switch (m.t) {
      case "load":
        m.params.forEach((v, i) => { this.params[i] = v; this.engine.setParam((i / NPARAMS) | 0, i % NPARAMS, v); });
        m.notes.forEach((n, t) => s.setNotes(t, n));
        m.auto.forEach((a, t) => s.setAuto(t, a));
        s.bpm = m.bpm; s.setSwing(m.swing); s.setLoopBeats(m.loopBeats);
        this.setAudible(m.audible);
        this.space.setTempo(m.bpm); this.space.setAmount(m.space);
        this.squash.setAmount(m.squash);
        this.setEq(m.eq, m.eqAuto);
        m.trackEq.forEach((d, t) => this.setTrackEq(t, d));
        this.setLinear(m.eqLinear);
        m.amps.forEach((a, t) => this.amps.set(t, a));
        break;
      case "param":
        this.params[m.track * NPARAMS + m.i] = m.v;
        this.engine.setParam(m.track, m.i, m.v);
        break;
      case "notes": s.setNotes(m.track, m.notes); break;
      case "auto": s.setAuto(m.track, m.lanes); break;
      case "audible": this.setAudible(m.mask); break;
      case "tempo": s.bpm = m.bpm; s.setSwing(m.swing); s.setLoopBeats(m.loopBeats); this.space.setTempo(m.bpm); break;
      case "space": this.space.setAmount(m.amount); break;
      case "squash": this.squash.setAmount(m.amount); break;
      case "eq": this.setEq(m.bands, m.lanes); break;
      case "trackEq": this.setTrackEq(m.track, m.bands); break;
      case "eqListen": this.listening = m.band; this.eq.listen(m.band); break;
      case "eqPhase": this.setLinear(m.linear); break;
      case "master": this.master = m.gain; this.engine.setMaster(m.gain); break;
      case "play": s.play(m.countIn); break;
      case "stop": this.endTake(); s.stop(); this.engine.allOff(); break;
      case "rec": s.recording = m.on; this.endTake(); this.passes = 0; if (!m.on) s.untouch(); break;
      case "take": this.deck.set(m.track, m.pcm, m.beat); break;
      case "amp": this.amps.set(m.track, m.amp); break;
      case "monitor": this.monitor = m.on; break;
      case "arm": this.endTake(); this.passes = 0; this.monitor = false; this.armed = m.track; this.inLatency = m.inLatency; break;
      case "metro": s.metronome = m.on; break;
      case "latency": this.outLatency = m.seconds; this.setLatency(); break;
      case "on": s.liveOn(m.track, m.midi, m.vel, m.rec ?? true); break;
      case "off": s.liveOff(m.track, m.midi); break;
      case "panic": s.stop(); s.setRepeat(0); this.engine.panic(); this.space.reset(); this.squash.reset(); this.eq.reset(); this.sendDelay?.reset(); break;
      case "bend": if (m.track >= 0 && m.track < TRACKS) { this.bend[m.track] = m.semis; this.engine.setBend(m.track, m.semis); } break;
      case "repeat": s.setRepeat(m.beats); break;
      case "move": s.move(m.track, m.i, m.v, m.was); break;
      case "engine": await this.swap(m); break;
    }
  }

  /** The pass recorded so far goes to the page, which puts it on the track. */
  private endTake(whole = false) {
    const pcm = this.capture.take();
    this.capturing = false;
    if (whole) this.passes++;
    else if (this.passes > 0) return;
    if (pcm && this.armed >= 0) this.port.postMessage({ t: "taken", track: this.armed, beat: this.capture.beat, pcm, rate: sampleRate }, [pcm.buffer]);
  }

  /** The input onto the armed track: from the beat the player heard when it came in, one loop's pass at a time. */
  private record(input: Float32Array[] | undefined, frames: number, pos: number) {
    const s = this.seq, L = s.loopBeats;
    const mono = this.downmix(input, frames);
    if (!this.capturing) {
      this.capturing = true;
      const back = (s.latency + this.inLatency) * (s.bpm / 60);
      this.capture.beat = (((pos - back) % L) + L) % L;
    }
    if (this.capture.push(mono, frames, (L * 60) / s.bpm)) this.endTake(true);
  }

  /** The input's channels as one, in `mono`. */
  private downmix(input: Float32Array[] | undefined, frames: number): Float32Array {
    if (this.mono.length < frames) this.mono = new Float32Array(frames);
    const mono = this.mono;
    mono.fill(0, 0, frames);
    const chans = input?.length ?? 0;
    for (let c = 0; c < chans; c++) { const x = input![c]; for (let f = 0; f < frames; f++) mono[f] += x[f] / chans; }
    return mono;
  }

  private setAudible(mask: boolean[]) {
    for (let t = 0; t < TRACKS; t++) this.muted[t] = !mask[t];
    this.seq.setAudible(mask);
  }

  /** A new EQ or new lanes: play it as saved until the lanes move it on the next tick. */
  private setEq(doc: EqDoc, lanes: Lane[]) {
    this.eqDoc = this.eqPlayed = doc;
    this.eq.set(doc);
    this.seq.setEqAuto(lanes);
  }

  private setTrackEq(t: number, doc: EqDoc) {
    if (t < 0 || t >= TRACKS) return;
    this.trackEq[t] = doc;
    sendTrackEq(this.engine, t, doc, this.trackLast[t]);
  }

  /**
   * Linear phase on or off. It runs in TypeScript whichever engine plays; the delay
   * changes, so the old tail is dropped rather than doubled.
   */
  private setLinear(on: boolean) {
    if (on === !!this.linear) return;
    if (on) {
      const lin = new LinearEq(sampleRate);
      lin.set(this.eqPlayed); lin.listen(this.listening); lin.reset();
      this.linear = lin; this.eq = lin;
      this.sendDelay = new Delay(lin.latency);
    } else {
      this.linear = null; this.sendDelay = null;
      this.eq = this.minEq;
      this.eq.set(this.eqPlayed); this.eq.listen(this.listening); this.eq.reset();
    }
    this.space.reset();
    this.setLatency();
  }

  /** What the player hears is late by the output and the EQ: a key played along lands where they heard it. */
  private setLatency() { this.seq.latency = this.outLatency + (this.eq.latency ?? 0) / sampleRate; }

  private async swap(m: Extract<ToWorklet, { t: "engine" }>) {
    try {
      // the engine and Shape come from the same wasm instance, or are both TypeScript
      const x = m.kind === "rust" && m.bytes ? await instantiateFm(m.bytes) : null;
      const next: FmEngine = x ? new WasmEngine(x, sampleRate) : new TsEngine(sampleRate);
      const eq: EqStage = x ? new WasmEq(x, sampleRate) : new TsEq(sampleRate);
      eq.set(this.eqPlayed);
      eq.listen(this.listening);
      for (let i = 0; i < this.params.length; i++) next.setParam((i / NPARAMS) | 0, i % NPARAMS, this.params[i]);
      for (let t = 0; t < TRACKS; t++) { next.setMute(t, this.muted[t]); next.setBend(t, this.bend[t]); }
      next.setMaster(this.master);
      // a new engine starts with every insert where it is now, not fading in
      this.trackEq.forEach((d, t) => sendTrackEq(next, t, d, []));
      next.panic();
      const old = this.engine;
      this.engine = next;
      this.seq.engine = next;
      this.seq.resendAuto();
      this.kind = m.kind;
      old.panic();
      old.free?.();
      const oldEq = this.minEq;
      this.minEq = eq;
      if (!this.linear) this.eq = eq;
      oldEq.free?.();
      this.port.postMessage({ t: "engine", kind: this.kind });
    } catch (e) {
      this.port.postMessage({ t: "engine", kind: this.kind, error: String((e as Error)?.message ?? e) });
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0], R = out[1] ?? out[0];
    const frames = L.length;
    if (this.buf.length < frames * 2) { this.buf = new Float32Array(frames * 2); this.send = new Float32Array(frames * 2); }
    try {
      const pos = this.seq.pos, playing = this.seq.playing;
      this.seq.process(this.buf, frames, this.send);
      const hear = this.monitor && this.armed >= 0 && this.amps.has(this.armed) ? { track: this.armed, input: this.downmix(inputs[0], frames) } : undefined;
      this.amps.mix(this.deck, this.buf, frames, pos, this.seq.bpm, this.seq.loopBeats, (t) => !this.muted[t], this.master, playing, hear);
      if (playing && this.seq.recording && this.armed >= 0) this.record(inputs[0], frames, pos);
      this.eq.process(this.buf, frames);
      this.sendDelay?.process(this.send, frames);
      this.squash.process(this.buf, frames);
      this.space.process(this.buf, this.send, frames);
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
        peakL: this.meter[0], peakR: this.meter[1], minGain: this.meter[2], nans: this.meter[3], ampMisses: this.amps.misses,
      });
    }
    return true;
  }
}

registerProcessor("fm-daw", FmProcessor);
