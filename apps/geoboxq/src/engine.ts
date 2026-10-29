// The Rust engine (wasm/src/lib.rs) from TypeScript: one memoized load and one typed call.
// Works in the browser (Vite resolves the .wasm URL) and under Bun (tests).
import init, { solve as solveJson } from "./wasm-pkg/geoboxq_engine.js";
import { unseal } from "@rustybuns/seal";
import { obj, str } from "@rustybuns/util/guard";
import { readJson } from "@rustybuns/util/http";

/** A box (its inside) or a product (its outside). `wall` above 0 makes a product a box that opens. */
export interface Thing { name: string; l: number; w: number; h: number; qty?: number; wall?: number; inner?: V3 }
export type V3 = [number, number, number];
/** A piece in its parent's frame. Axis k of that frame is axis `turn[k]` of the piece's own; `inside` sits relative to `cav`. */
export interface Placed { name: string; size: V3; turn: [number, number, number]; pos: V3; cav: V3; inside: Placed[] }
export interface Solution {
  boxes: { name: string; fits: boolean; fill: number }[];
  best: number | null;
  packed: Placed[];
  pieces: { name: string; size: V3; inside: Placed[] }[];
  nested: number;
}

let loading: Promise<unknown> | undefined;

/**
 * Sealed builds (VITE_GEOBOXQ_SEALED=1) fetch the encrypted wasm and the key the server gets from
 * artstewengine; no payment, no key, no engine. Plain builds (dev, tests) load the wasm as is.
 */
async function sealedSource(): Promise<ArrayBuffer> {
  const got = await readJson(await fetch("/api/engine/key"), obj({ key: str(4096) }));
  if (!got) throw new Error("engine locked: license not paid");
  const sealed = new Uint8Array(await (await fetch("/engine.sealed")).arrayBuffer());
  return (await unseal(sealed, got.key)).buffer as ArrayBuffer;
}

/**
 * Load and instantiate the engine once; later calls share the promise. A server passes the .wasm it
 * bundled (a compiled module in a Worker, a file path under Bun); the browser loads its own.
 */
export function loadEngine(source?: WebAssembly.Module | string): Promise<unknown> {
  loading ??= (async () => {
    if (source) {
      await init({ module_or_path: typeof source === "string" ? await Bun.file(source).arrayBuffer() : source });
      return;
    }
    if ((import.meta as { env?: Record<string, string> }).env?.VITE_GEOBOXQ_SEALED === "1") {
      await init({ module_or_path: await sealedSource() });
      return;
    }
    const url = new URL("./wasm-pkg/geoboxq_engine_bg.wasm", import.meta.url);
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
