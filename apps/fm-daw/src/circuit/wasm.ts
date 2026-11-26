// The circuit amp in Rust (native/crates/fm_daw/src/circuit.rs), compiled into
// the same wasm as the engine, behind the same knobs as `Rig` in rig.ts.
import type { Exports } from "../engine/wasm.ts";
import { DEFAULT_POWER, SCOPE_SAMPLES, cabIR, encodeNetlist, nodeNumbers, type Fault, type Mic, type Netlist, type RigSpec, type ScopeAt, type Trem } from "@rustybuns/gear/circuit";

const CHUNK = 512;

export class WasmRig {
  private readonly h: number;
  private readonly buf: number;
  private readonly lv: number;
  private readonly links: number;
  /** Each link's netlist, to number a scope's node by (Rust has no names), and the scope. */
  private readonly nets: Netlist[];
  private at: ScopeAt | null = null;
  private sc = 0;

  constructor(private readonly x: Exports, spec: RigSpec, readonly sampleRate = 48000, readonly oversample = 4) {
    if (spec.blends?.length) throw new Error("the Rust rig runs its links one after another: no splits yet");
    this.h = x.fm_amp_new(sampleRate, oversample, spec.inputVolts, spec.power, spec.noise ?? 0);
    if (!this.h) throw new Error("rust amp rejected the sample rate or oversampling");
    const o = spec.output ?? DEFAULT_POWER;
    x.fm_amp_set_output(this.h, o.pairs, o.sag, o.load);
    this.setTrem(o.trem);
    if (spec.cab) this.setCab(cabIR(spec.cab, sampleRate));
    for (const l of spec.links) {
      if (this.send(l.net, (p, n) => x.fm_amp_push(this.h, p, n, l.gain ?? 1)) < 0) {
        x.fm_amp_free(this.h);
        throw new Error("rust amp refused a circuit: a node with no path to ground?");
      }
    }
    this.links = spec.links.length;
    this.nets = spec.links.map((l) => l.net);
    this.buf = x.fm_alloc(CHUNK);
    this.lv = x.fm_alloc(Math.max(1, this.links));
  }

  /** Copies a netlist into wasm memory for `call`, then frees it. */
  private send(net: Netlist | Float64Array, call: (ptr: number, len: number) => number): number {
    const d = net instanceof Float64Array ? net : encodeNetlist(net), p = this.x.fm_alloc_f64(d.length);
    new Float64Array(this.x.memory.buffer, p, d.length).set(d);
    const r = call(p, d.length);
    this.x.fm_dealloc_f64(p, d.length);
    return r;
  }

  setGain(i: number, g: number): void { this.x.fm_amp_set_gain(this.h, i >>> 0, g); }
  setPot(i: number, pot: number, at: number): void { this.x.fm_amp_set_pot(this.h, i >>> 0, pot >>> 0, at); }
  setPower(p: number): void { this.x.fm_amp_set_power(this.h, p); }
  setNoise(n: number): void { this.x.fm_amp_set_noise(this.h, n); }
  setLoad(ohms: number): void { this.x.fm_amp_set_load(this.h, ohms); }
  setTrem(t?: Trem): void { this.x.fm_amp_set_trem(this.h, t?.hz ?? 0, t?.depth ?? 0); }
  /** The impulse response is made here (cab.ts) and handed over; Rust only convolves. */
  setMic(mic: Mic): void { this.setCab(cabIR(mic, this.sampleRate)); }
  setCab(ir: Float64Array): void { this.send(ir, (p, n) => { this.x.fm_amp_set_cab(this.h, p, n); return 0; }); }
  get fault(): Fault | null { return this.x.fm_amp_fault(this.h) ? "open-load" : null; }
  get supply(): number { return this.x.fm_amp_supply(this.h); }
  setLink(i: number, net: Netlist): void {
    if (!this.send(net, (p, n) => this.x.fm_amp_set_link(this.h, i >>> 0, p, n))) throw new Error(`rust amp refused link ${i}`);
    this.nets[i] = net;
    if (this.at?.link === i) this.setScope(this.at);
  }

  /** As `Rig.setScope`, on a node (the Rust rig has no mods, so no control nets). */
  setScope(at: ScopeAt | null): boolean {
    const net = at ? this.nets[at.link] : undefined, node = at && net ? nodeNumbers(net).get(at.net) ?? -1 : -1;
    const ok = node >= 0 && !!this.x.fm_amp_set_scope(this.h, at?.link ?? -1, node);
    if (!ok) this.x.fm_amp_set_scope(this.h, -1, -1);
    this.at = ok ? at : null;
    return ok;
  }
  /** As `Rig.scope`. */
  scope(): Float32Array {
    if (!this.at) return new Float32Array(0);
    this.sc ||= this.x.fm_alloc(SCOPE_SAMPLES);
    const n = this.x.fm_amp_scope(this.h, this.sc, SCOPE_SAMPLES);
    return new Float32Array(this.x.memory.buffer, this.sc, n).slice();
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
    if (this.sc) this.x.fm_dealloc(this.sc, SCOPE_SAMPLES);
    this.x.fm_amp_free(this.h);
  }
}
