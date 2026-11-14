// The circuit amp in Rust (native/crates/fm_daw/src/circuit.rs), compiled into
// the same wasm as the engine, behind the same knobs as `Rig` in rig.ts.
import type { Exports } from "../engine/wasm.ts";
import { encodeNetlist, type Netlist } from "./mna.ts";
import type { RigSpec } from "./rig.ts";

const CHUNK = 512;

export class WasmRig {
  private readonly h: number;
  private readonly buf: number;
  private readonly lv: number;
  private readonly links: number;

  constructor(private readonly x: Exports, spec: RigSpec, sampleRate = 48000, readonly oversample = 4) {
    this.h = x.fm_amp_new(sampleRate, oversample, spec.inputVolts, spec.power, spec.cab ? 1 : 0, spec.noise ?? 0);
    if (!this.h) throw new Error("rust amp rejected the sample rate or oversampling");
    for (const l of spec.links) {
      if (this.send(l.net, (p, n) => x.fm_amp_push(this.h, p, n, l.gain ?? 1)) < 0) {
        x.fm_amp_free(this.h);
        throw new Error("rust amp refused a circuit: a node with no path to ground?");
      }
    }
    this.links = spec.links.length;
    this.buf = x.fm_alloc(CHUNK);
    this.lv = x.fm_alloc(Math.max(1, this.links));
  }

  /** Copies a netlist into wasm memory for `call`, then frees it. */
  private send(net: Netlist, call: (ptr: number, len: number) => number): number {
    const d = encodeNetlist(net), p = this.x.fm_alloc_f64(d.length);
    new Float64Array(this.x.memory.buffer, p, d.length).set(d);
    const r = call(p, d.length);
    this.x.fm_dealloc_f64(p, d.length);
    return r;
  }

  setGain(i: number, g: number): void { this.x.fm_amp_set_gain(this.h, i >>> 0, g); }
  setPower(p: number): void { this.x.fm_amp_set_power(this.h, p); }
  setNoise(n: number): void { this.x.fm_amp_set_noise(this.h, n); }
  setLink(i: number, net: Netlist): void {
    if (!this.send(net, (p, n) => this.x.fm_amp_set_link(this.h, i >>> 0, p, n))) throw new Error(`rust amp refused link ${i}`);
  }

  /** Mono `n` samples from `input` (full scale ±1) to `output` (volts at the speaker). */
  process(input: Float32Array, output: Float32Array, n = input.length): void {
    for (let at = 0; at < n; at += CHUNK) {
      const k = Math.min(CHUNK, n - at);
      // a fresh view each time: memory.grow detaches old ones
      new Float32Array(this.x.memory.buffer, this.buf, k).set(input.subarray(at, at + k));
      this.x.fm_amp_process(this.h, this.buf, k);
      output.set(new Float32Array(this.x.memory.buffer, this.buf, k), at);
    }
  }

  levels(): number[] {
    this.x.fm_amp_levels(this.h, this.lv);
    return Array.from(new Float32Array(this.x.memory.buffer, this.lv, this.links));
  }

  get misses(): number { return this.x.fm_amp_misses(this.h); }
  get iterationsPerStep(): number { return this.x.fm_amp_iterations(this.h); }

  free(): void {
    this.x.fm_dealloc(this.buf, CHUNK);
    this.x.fm_dealloc(this.lv, Math.max(1, this.links));
    this.x.fm_amp_free(this.h);
  }
}
