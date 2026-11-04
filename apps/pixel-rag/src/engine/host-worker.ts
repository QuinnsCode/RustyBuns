// One search worker on the desktop host: a Bun worker with the crate over bun:ffi, handed a raw
// pointer into the very bytes the page-side wasm workers would see. ts and wasm jobs run here too,
// so the host can race all three lanes on one memory.
import { ptr, type Pointer } from "bun:ffi";
import { nativeLib } from "./native.ts";
import { distAt, idxAt, queryAt, wasmExports, WORDS, type Layout, type PixelRagWasm } from "./layout.ts";
import { scan } from "./scan.ts";
import type { Job, Reply } from "./protocol.ts";

let memory: WebAssembly.Memory | null = null;
let l: Layout | null = null;
let wasm: PixelRagWasm | null = null;
let native: Awaited<ReturnType<typeof nativeLib>> = null;
let base = 0;
/** A byte offset into the shared memory as a native pointer. */
const at = (offset: number) => (base + offset) as Pointer;

const post = (r: Reply) => (self as unknown as Worker).postMessage(r);

self.onmessage = async (e: MessageEvent<Job>) => {
  const j = e.data;
  try {
    if (j.type === "init") {
      memory = j.memory; l = j.layout;
      if (j.engine === "native") {
        native = await nativeLib();
        if (!native) throw new Error("no native build for this platform (bun run build:native)");
        base = ptr(new Uint8Array(memory.buffer));
      } else if (j.engine === "wasm") {
        if (!j.module) throw new Error("no wasm module");
        wasm = wasmExports(await WebAssembly.instantiate(j.module, { env: { memory } }));
        wasm.__stack_pointer.value = j.stack;
      }
      return post({ id: j.id, ok: true, count: 0, ms: 0 });
    }
    if (!memory || !l) throw new Error("search before init");
    const t0 = performance.now();
    const count = native
      ? native.pr_topk(at(l.codes), j.start, j.end, WORDS, at(queryAt(l, 0)), j.k, at(idxAt(l, j.slot)), at(distAt(l, j.slot)))
      : scan(memory, l, wasm, j);
    post({ id: j.id, ok: true, count, ms: performance.now() - t0 });
  } catch (err) {
    post({ id: j.id, ok: false, error: String(err instanceof Error ? err.message : err) });
  }
};
