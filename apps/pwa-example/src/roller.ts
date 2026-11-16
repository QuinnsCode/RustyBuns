// The dice roller, twice: wasm/src/lib.rs compiled to src/dice.wasm, and @rustybuns/util's mulberry32 in TS. They roll
// the same dice from the same seed (test/roller.test.ts), so the TS one is both the reference and the fallback when
// the wasm won't load. The wasm is a raw module (three exports, numbers only), so loading it is one
// `WebAssembly.instantiate` call: no wasm-bindgen glue, no bundler plugin.
import { mulberry32 } from "@rustybuns/util";

export interface Roller {
  engine: "wasm" | "ts";
  /** `n` dice with `sides` faces each, from `seed`: the same three numbers always give the same dice. */
  roll(seed: number, n: number, sides: number): number[];
}

export const tsRoller: Roller = {
  engine: "ts",
  roll(seed, n, sides) {
    const next = mulberry32(seed);
    return Array.from({ length: n }, () => 1 + Math.floor(next() * sides));
  },
};

/** What src/dice.wasm exports (wasm/src/lib.rs). */
interface DiceExports { seed(s: number): void; roll(sides: number): number }

function isDice(x: WebAssembly.Exports): x is WebAssembly.Exports & DiceExports {
  return typeof x.seed === "function" && typeof x.roll === "function";
}

/** The Rust roller from the module's bytes. */
export async function wasmRoller(bytes: BufferSource): Promise<Roller> {
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes));
  const x = instance.exports;
  if (!isDice(x)) throw new Error("dice.wasm is missing seed or roll");
  return {
    engine: "wasm",
    roll(seed, n, sides) {
      x.seed(seed >>> 0);
      return Array.from({ length: n }, () => x.roll(sides));
    },
  };
}

/** The Rust roller fetched from `url`, or the TS one if it won't load (an old browser, a blocked fetch). */
export async function loadRoller(url: string): Promise<Roller> {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return await wasmRoller(await r.arrayBuffer());
  } catch (e) {
    console.warn("dice.wasm did not load, rolling in TS:", e);
    return tsRoller;
  }
}
