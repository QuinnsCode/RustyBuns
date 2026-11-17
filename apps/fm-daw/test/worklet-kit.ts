// The audio thread (src/engine/worklet.ts) outside a browser, for the tests that play through it. The module
// registers its processor once per process, so every test file gets the class from here, not by importing it.
import { afterAll, beforeAll } from "bun:test";
import type { FromWorklet, ToWorklet } from "../src/engine/messages.ts";

export const SR = 48000, BLOCK = 128;
export interface Proc { port: { onmessage: (e: { data: ToWorklet }) => void }; process(i: Float32Array[][], o: Float32Array[][]): boolean }
/** Everything any processor posted to the page, oldest first. */
export const posted: FromWorklet[] = [];
let Processor: (new () => Proc) | undefined;
const globals = ["sampleRate", "AudioWorkletProcessor", "registerProcessor"] as const;

/** Call at the top of a test file: the worklet's globals are there for its tests, and gone after. */
export function useWorklet() {
  beforeAll(async () => {
    Object.assign(globalThis, {
      sampleRate: SR,
      AudioWorkletProcessor: class { port = { postMessage: (m: FromWorklet) => posted.push(m), onmessage: null } },
      registerProcessor: (_: string, c: new () => Proc) => { Processor = c; },
    });
    await import("../src/engine/worklet.ts");
  });
  afterAll(() => { for (const g of globals) Reflect.deleteProperty(globalThis, g); });
}

/** A new audio thread, and a way to message it; `posted` starts empty again. */
export function processor(): { p: Proc; say: (m: ToWorklet) => void } {
  if (!Processor) throw new Error("useWorklet() first");
  posted.length = 0;
  const p = new Processor();
  return { p, say: (m) => p.port.onmessage({ data: m }) };
}

/** Play `seconds` through it, `input` (seconds -> sample) coming in; the left side out. */
export async function run(p: Proc, seconds: number, input?: (t: number) => number, from = 0): Promise<Float32Array> {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let at = 0; at < out.length; at += BLOCK) {
    const x = new Float32Array(BLOCK).map((_, i) => input?.((from + at + i) / SR) ?? 0);
    const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
    p.process([[x]], [[L, R]]);
    out.set(L.subarray(0, Math.min(BLOCK, out.length - at)), at);
  }
  await Promise.resolve();
  return out;
}
