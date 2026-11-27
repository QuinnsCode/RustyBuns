// The Rust engine compiled to WebAssembly, behind the same FmEngine interface
// as TsEngine. Runs inside the AudioWorklet (live) and on the main thread (bench).
import { tapCode, type FmEngine, type Tap } from "./engine.ts";
import { TRACKS } from "./params.ts";
import type { RemoteLine } from "./remote.ts";
import { sendEq, sendListen, type EqBand, type EqDoc, type EqListen, type EqStage } from "./eq.ts";

export interface Exports {
  memory: WebAssembly.Memory;
  fm_new(sr: number): number;
  fm_free(e: number): void;
  fm_set_param(e: number, track: number, index: number, value: number): void;
  fm_set_mute(e: number, track: number, muted: number): void;
  fm_set_master(e: number, gain: number): void;
  fm_set_tempo(e: number, bpm: number): void;
  fm_set_beat(e: number, beats: number): void;
  fm_set_bend(e: number, track: number, semitones: number): void;
  fm_note_on(e: number, track: number, id: number, midi: number, velocity: number): void;
  fm_note_off(e: number, track: number, id: number): void;
  fm_all_off(e: number): void;
  fm_panic(e: number): void;
  fm_click(e: number, accent: number): void;
  fm_render(e: number, out: number, send: number, taps: number, send2: number, frames: number): void;
  fm_set_tap(e: number, track: number, on: number): void;
  fm_meter(e: number, out: number): void;
  fm_track_eq_set(e: number, track: number, band: number, kind: number, freq: number, gain: number, width: number, slope: number, on: number): void;
  fm_eq_new(sr: number): number;
  fm_eq_free(q: number): void;
  fm_eq_set(q: number, band: number, kind: number, freq: number, gain: number, width: number, slope: number, on: number): void;
  fm_eq_reset(q: number): void;
  fm_eq_process(q: number, buf: number, frames: number): void;
  fm_amp_new(sr: number, oversample: number, inputVolts: number, power: number, noise: number): number;
  fm_amp_free(r: number): void;
  fm_amp_push(r: number, net: number, len: number, gain: number): number;
  fm_amp_set_link(r: number, i: number, net: number, len: number): number;
  fm_amp_set_gain(r: number, i: number, gain: number): void;
  fm_amp_set_pot(r: number, i: number, pot: number, at: number): void;
  fm_amp_set_power(r: number, power: number): void;
  fm_amp_set_noise(r: number, noise: number): void;
  fm_amp_set_output(r: number, pairs: number, sag: number, load: number): void;
  fm_amp_set_load(r: number, load: number): void;
  fm_amp_set_trem(r: number, hz: number, depth: number): void;
  fm_amp_set_cab(r: number, ir: number, len: number): void;
  fm_amp_fault(r: number): number;
  fm_amp_supply(r: number): number;
  fm_amp_process(r: number, buf: number, frames: number): void;
  fm_amp_levels(r: number, out: number): void;
  fm_amp_set_scope(r: number, link: number, node: number): number;
  fm_amp_scope(r: number, out: number, max: number): number;
  fm_amp_misses(r: number): number;
  fm_amp_iterations(r: number): number;
  fm_remote_new(nominal: number): number;
  fm_remote_free(r: number): void;
  fm_remote_set_nominal(r: number, nominal: number): void;
  fm_remote_push(r: number, beat: number, buf: number, len: number): void;
  fm_remote_mix(r: number, out: number, frames: number, beat0: number, bpf: number, gain: number): void;
  fm_remote_late(r: number): number;
  fm_box_new(sr: number, plan: number, len: number): number;
  fm_box_free(b: number): void;
  fm_box_process(b: number, buf: number, frames: number): void;
  fm_box_curve(plan: number, len: number, freqs: number, out: number, n: number): number;
  fm_alloc_f64(len: number): number;
  fm_dealloc_f64(p: number, len: number): void;
  fm_alloc(len: number): number;
  fm_dealloc(p: number, len: number): void;
}

const CHUNK = 512;

export async function instantiateFm(bytes: BufferSource): Promise<Exports> {
  // bytes in -> { module, instance } out (the Module overload returns a bare Instance)
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- WebAssembly hands back untyped exports; this is the shape the module was built with
  const { instance } = (await WebAssembly.instantiate(bytes, {})) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- WebAssembly hands back untyped exports; this is the shape the module was built with
  return instance.exports as unknown as Exports;
}

export class WasmEngine implements FmEngine {
  private readonly h: number;
  private readonly buf: number;
  private readonly snd: number;
  private readonly snd2: number;
  private readonly tap: number;
  private readonly met: number;
  constructor(private readonly x: Exports, sampleRate: number) {
    this.h = x.fm_new(sampleRate);
    if (!this.h) throw new Error("rust engine rejected the sample rate");
    this.buf = x.fm_alloc(CHUNK * 2);
    this.snd = x.fm_alloc(CHUNK * 2);
    this.snd2 = x.fm_alloc(CHUNK * 2);
    this.tap = x.fm_alloc(CHUNK * TRACKS);
    this.met = x.fm_alloc(4);
  }
  setParam(t: number, i: number, v: number) { this.x.fm_set_param(this.h, t >>> 0, i >>> 0, v); }
  setMute(t: number, m: boolean) { this.x.fm_set_mute(this.h, t >>> 0, m ? 1 : 0); }
  setMaster(g: number) { this.x.fm_set_master(this.h, g); }
  setTempo(bpm: number) { this.x.fm_set_tempo(this.h, bpm); }
  setBeat(b: number) { this.x.fm_set_beat(this.h, b); }
  setBend(t: number, s: number) { this.x.fm_set_bend(this.h, t >>> 0, s); }
  noteOn(t: number, id: number, midi: number, vel: number) { this.x.fm_note_on(this.h, t >>> 0, id >>> 0, midi, vel); }
  noteOff(t: number, id: number) { this.x.fm_note_off(this.h, t >>> 0, id >>> 0); }
  allOff() { this.x.fm_all_off(this.h); }
  panic() { this.x.fm_panic(this.h); }
  click(accent: boolean) { this.x.fm_click(this.h, accent ? 1 : 0); }
  setTrackBand(t: number, i: number, k: number, f: number, g: number, q: number, sl: number, on: boolean) { this.x.fm_track_eq_set(this.h, t >>> 0, i >>> 0, k >>> 0, f, g, q, sl, on ? 1 : 0); }
  setTap(t: number, on: Tap) { this.x.fm_set_tap(this.h, t >>> 0, tapCode(on)); }
  render(out: Float32Array, frames: number, send?: Float32Array, taps?: Float32Array, send2?: Float32Array) {
    const n = Math.min(frames, out.length >> 1, send ? send.length >> 1 : Infinity, taps ? (taps.length / TRACKS) | 0 : Infinity, send2 ? send2.length >> 1 : Infinity);
    for (let at = 0; at < n; at += CHUNK) {
      const k = Math.min(CHUNK, n - at);
      this.x.fm_render(this.h, this.buf, send ? this.snd : 0, taps ? this.tap : 0, send2 ? this.snd2 : 0, k);
      // a fresh view each time: memory.grow detaches old ones
      out.set(new Float32Array(this.x.memory.buffer, this.buf, k * 2), at * 2);
      if (send) send.set(new Float32Array(this.x.memory.buffer, this.snd, k * 2), at * 2);
      if (send2) send2.set(new Float32Array(this.x.memory.buffer, this.snd2, k * 2), at * 2);
      if (taps) taps.set(new Float32Array(this.x.memory.buffer, this.tap, k * TRACKS), at * TRACKS);
    }
  }
  meter(out: Float32Array) {
    this.x.fm_meter(this.h, this.met);
    out.set(new Float32Array(this.x.memory.buffer, this.met, 4));
  }
  free() { this.x.fm_dealloc(this.buf, CHUNK * 2); this.x.fm_dealloc(this.snd, CHUNK * 2); this.x.fm_dealloc(this.tap, CHUNK * TRACKS); this.x.fm_dealloc(this.met, 4); this.x.fm_free(this.h); }
}

/** Shape, the master EQ, in Rust: the same instance as the engine, so one wasm file holds both. */
export class WasmEq implements EqStage {
  private readonly h: number;
  private readonly buf: number;
  private readonly last: EqBand[] = [];
  private readonly heard = { at: null as EqListen | null };
  constructor(private readonly x: Exports, sampleRate: number) {
    this.h = x.fm_eq_new(sampleRate);
    if (!this.h) throw new Error("rust EQ rejected the sample rate");
    this.buf = x.fm_alloc(CHUNK * 2);
  }
  set(doc: EqDoc) { sendEq(doc, this.last, (i, k, f, g, q, sl, on) => this.x.fm_eq_set(this.h, i, k, f, g, q, sl, on ? 1 : 0)); }
  listen(b: EqListen | null) { sendListen(b, this.heard, (i, k, f, g, q, sl, on) => this.x.fm_eq_set(this.h, i, k, f, g, q, sl, on ? 1 : 0)); }
  reset() { this.x.fm_eq_reset(this.h); }
  process(io: Float32Array, frames: number) {
    const n = Math.min(frames, io.length >> 1);
    for (let at = 0; at < n; at += CHUNK) {
      const k = Math.min(CHUNK, n - at);
      new Float32Array(this.x.memory.buffer, this.buf, k * 2).set(io.subarray(at * 2, (at + k) * 2));
      this.x.fm_eq_process(this.h, this.buf, k);
      io.set(new Float32Array(this.x.memory.buffer, this.buf, k * 2), at * 2);
    }
  }
  free() { this.x.fm_dealloc(this.buf, CHUNK * 2); this.x.fm_eq_free(this.h); }
}

/** The longest slice pushed at once (SOUND_MAX_FRAMES, and a take-sized margin). */
const PUSH = 8192;
/** Someone else's sound on its beat, in Rust (src/engine/remote.ts is the TS twin). */
export class WasmRemote implements RemoteLine {
  private readonly h: number;
  private readonly buf: number;
  constructor(private readonly x: Exports, nominal: number) {
    this.h = x.fm_remote_new(nominal);
    if (!this.h) throw new Error("rust remote line rejected the tempo");
    this.buf = x.fm_alloc(PUSH);
  }
  setNominal(spb: number) { this.x.fm_remote_set_nominal(this.h, spb); }
  /** A slice longer than PUSH (none is: SOUND_MAX_FRAMES) is cut short. */
  push(beat: number, samples: Float32Array) {
    const k = Math.min(PUSH, samples.length);
    new Float32Array(this.x.memory.buffer, this.buf, k).set(samples.subarray(0, k));
    this.x.fm_remote_push(this.h, beat, this.buf, k);
  }
  /** In one call up to PUSH frames, so each frame's beat is worked out as the TS twin does it. */
  mix(out: Float32Array, frames: number, beat0: number, bpf: number, gain: number) {
    const n = Math.min(frames, out.length);
    for (let at = 0; at < n; at += PUSH) {
      const k = Math.min(PUSH, n - at);
      new Float32Array(this.x.memory.buffer, this.buf, k).set(out.subarray(at, at + k));
      this.x.fm_remote_mix(this.h, this.buf, k, beat0 + at * bpf, bpf, gain);
      out.set(new Float32Array(this.x.memory.buffer, this.buf, k), at);
    }
  }
  get late() { return this.x.fm_remote_late(this.h); }
  free() { this.x.fm_dealloc(this.buf, PUSH); this.x.fm_remote_free(this.h); }
}
