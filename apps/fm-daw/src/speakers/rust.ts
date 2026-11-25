// A speaker plan's box in Rust (native/crates/fm_daw/src/enclosure.rs), in the same wasm as the engine: the plan goes
// over as `encodePlan`'s numbers, the curve and the audio come back. `BoxFilter` and `curveOf` in @rustybuns/gear are
// the TypeScript side; test/enclosure.test.ts holds the two together.
import type { Exports } from "../engine/wasm.ts";

const CHUNK = 512;

/** Copies f64s into wasm memory, runs `call`, frees them. */
function withF64<T>(x: Exports, data: Float64Array, call: (p: number) => T): T {
  const p = x.fm_alloc_f64(data.length);
  new Float64Array(x.memory.buffer, p, data.length).set(data);
  try { return call(p); } finally { x.fm_dealloc_f64(p, data.length); }
}

/** The response in dB at `freqs`, worked out in Rust. */
export function rustCurve(x: Exports, plan: Float64Array, freqs: Float64Array): Float64Array {
  const out = x.fm_alloc_f64(freqs.length);
  try {
    const ok = withF64(x, plan, (pp) => withF64(x, freqs, (fp) => x.fm_box_curve(pp, plan.length, fp, out, freqs.length)));
    if (!ok) throw new Error("rust refused the plan");
    return new Float64Array(x.memory.buffer, out, freqs.length).slice();
  } finally { x.fm_dealloc_f64(out, freqs.length); }
}

/** Audio through the plan's box, in Rust. */
export class RustBox {
  private readonly h: number;
  private readonly buf: number;

  constructor(private readonly x: Exports, plan: Float64Array, readonly sampleRate = 48000) {
    this.h = withF64(x, plan, (p) => x.fm_box_new(sampleRate, p, plan.length));
    if (!this.h) throw new Error("rust refused the plan or the sample rate");
    this.buf = x.fm_alloc(CHUNK);
  }

  /** In place. */
  process(audio: Float32Array): void {
    for (let at = 0; at < audio.length; at += CHUNK) {
      const n = Math.min(CHUNK, audio.length - at), view = new Float32Array(this.x.memory.buffer, this.buf, n);
      view.set(audio.subarray(at, at + n));
      this.x.fm_box_process(this.h, this.buf, n);
      audio.set(new Float32Array(this.x.memory.buffer, this.buf, n), at);
    }
  }

  free(): void { this.x.fm_box_free(this.h); this.x.fm_dealloc(this.buf, CHUNK); }
}
