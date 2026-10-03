// The Rust engine compiled to WebAssembly, behind the same FmEngine interface
// as TsEngine. Runs inside the AudioWorklet (live) and on the main thread (bench).
import type { FmEngine } from "./engine.ts";

interface Exports {
  memory: WebAssembly.Memory;
  fm_new(sr: number): number;
  fm_free(e: number): void;
  fm_set_param(e: number, track: number, index: number, value: number): void;
  fm_set_mute(e: number, track: number, muted: number): void;
  fm_set_master(e: number, gain: number): void;
  fm_note_on(e: number, track: number, id: number, midi: number, velocity: number): void;
  fm_note_off(e: number, track: number, id: number): void;
  fm_all_off(e: number): void;
  fm_panic(e: number): void;
  fm_click(e: number, accent: number): void;
  fm_render(e: number, out: number, frames: number): void;
  fm_meter(e: number, out: number): void;
  fm_alloc(len: number): number;
  fm_dealloc(p: number, len: number): void;
}

const CHUNK = 512;

export async function instantiateFm(bytes: BufferSource): Promise<Exports> {
  // bytes in -> { module, instance } out (the Module overload returns a bare Instance)
  const { instance } = (await WebAssembly.instantiate(bytes, {})) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
  return instance.exports as unknown as Exports;
}

export class WasmEngine implements FmEngine {
  private readonly h: number;
  private readonly buf: number;
  private readonly met: number;
  constructor(private readonly x: Exports, sampleRate: number) {
    this.h = x.fm_new(sampleRate);
    if (!this.h) throw new Error("rust engine rejected the sample rate");
    this.buf = x.fm_alloc(CHUNK * 2);
    this.met = x.fm_alloc(4);
  }
  setParam(t: number, i: number, v: number) { this.x.fm_set_param(this.h, t >>> 0, i >>> 0, v); }
  setMute(t: number, m: boolean) { this.x.fm_set_mute(this.h, t >>> 0, m ? 1 : 0); }
  setMaster(g: number) { this.x.fm_set_master(this.h, g); }
  noteOn(t: number, id: number, midi: number, vel: number) { this.x.fm_note_on(this.h, t >>> 0, id >>> 0, midi, vel); }
  noteOff(t: number, id: number) { this.x.fm_note_off(this.h, t >>> 0, id >>> 0); }
  allOff() { this.x.fm_all_off(this.h); }
  panic() { this.x.fm_panic(this.h); }
  click(accent: boolean) { this.x.fm_click(this.h, accent ? 1 : 0); }
  render(out: Float32Array, frames: number) {
    const n = Math.min(frames, out.length >> 1);
    for (let at = 0; at < n; at += CHUNK) {
      const k = Math.min(CHUNK, n - at);
      this.x.fm_render(this.h, this.buf, k);
      // a fresh view each time: memory.grow detaches old ones
      out.set(new Float32Array(this.x.memory.buffer, this.buf, k * 2), at * 2);
    }
  }
  meter(out: Float32Array) {
    this.x.fm_meter(this.h, this.met);
    out.set(new Float32Array(this.x.memory.buffer, this.met, 4));
  }
  free() { this.x.fm_dealloc(this.buf, CHUNK * 2); this.x.fm_dealloc(this.met, 4); this.x.fm_free(this.h); }
}
