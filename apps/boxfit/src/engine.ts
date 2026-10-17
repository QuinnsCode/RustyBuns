// The Rust engine (wasm/src/lib.rs) from TypeScript: one memoized load and one typed call.
// Works in the browser (Vite resolves the .wasm URL) and under Bun (tests).
import init, { solve as solveJson } from "./wasm-pkg/boxfit_engine.js";
import { unseal } from "./seal.ts";

/** A box (its inside) or a product (its outside). `wall` above 0 makes a product a box that opens. */
export interface Thing { name: string; l: number; w: number; h: number; qty?: number; wall?: number }
export interface Placed { name: string; size: [number, number, number]; pos: [number, number, number]; inside: Placed[] }
export interface Solution {
  boxes: { name: string; fits: boolean; fill: number }[];
  best: number | null;
  packed: Placed[];
  pieces: { name: string; size: [number, number, number]; inside: Placed[] }[];
  nested: number;
}

let loading: Promise<unknown> | undefined;

/**
 * Sealed builds (VITE_BOXFIT_SEALED=1) fetch the encrypted wasm and the key the server gets from
 * artstewengine; no payment, no key, no engine. Plain builds (dev, tests) load the wasm as is.
 */
async function sealedSource(): Promise<ArrayBuffer> {
  const res = await fetch("/api/engine/key");
  if (!res.ok) throw new Error("engine locked: license not paid");
  const { key } = await res.json() as { key: string };
  const sealed = new Uint8Array(await (await fetch("/engine.sealed")).arrayBuffer());
  return (await unseal(sealed, key)).buffer as ArrayBuffer;
}

/** Load and instantiate the engine once; later calls share the promise. */
export function loadEngine(): Promise<unknown> {
  loading ??= (async () => {
    if ((import.meta as { env?: Record<string, string> }).env?.VITE_BOXFIT_SEALED === "1") {
      await init({ module_or_path: await sealedSource() });
      return;
    }
    const url = new URL("./wasm-pkg/boxfit_engine_bg.wasm", import.meta.url);
    // Bun: read the file instead of fetching a file: URL.
    await init({ module_or_path: typeof Bun !== "undefined" && url.protocol === "file:" ? await Bun.file(url).arrayBuffer() : url });
  })();
  loading.catch(() => { loading = undefined; }); // locked today, paid tomorrow: ask again
  return loading;
}

/** Can these items go in one of these boxes, nesting boxes inside boxes? Throws the engine's message when the input is bad. */
export async function solve(boxes: Thing[], items: Thing[], pad = 0): Promise<Solution> {
  await loadEngine();
  const out = JSON.parse(solveJson(JSON.stringify({ boxes, items, pad })));
  if (out.error) throw new Error(out.error);
  return out;
}
