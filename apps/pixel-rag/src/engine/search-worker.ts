// One search worker in the page: it gets the shared memory once, then only row ranges. It scans
// its rows with the crate (wasm on the same memory) or the twin (typed views on the same bytes)
// and writes its best k into its own slot. Nothing but a count goes back over postMessage.
import { wasmExports, type Layout, type PixelRagWasm } from "./layout.ts";
import { scan } from "./scan.ts";
import type { Job, Reply } from "./protocol.ts";

let memory: WebAssembly.Memory | null = null;
let wasm: PixelRagWasm | null = null;
let l: Layout | null = null;

const post = (r: Reply) => (self as unknown as Worker).postMessage(r);

self.onmessage = async (e: MessageEvent<Job>) => {
  const j = e.data;
  try {
    if (j.type === "init") {
      memory = j.memory; l = j.layout;
      if (j.engine === "native") throw new Error("native search runs on the desktop host, not in a page");
      if (j.engine === "wasm") {
        if (!j.module) throw new Error("no wasm module");
        wasm = wasmExports(await WebAssembly.instantiate(j.module, { env: { memory } }));
        // They all import one memory, so without this every instance would share one shadow stack.
        wasm.__stack_pointer.value = j.stack;
      }
      return post({ id: j.id, ok: true, count: 0, ms: 0 });
    }
    if (!memory || !l) throw new Error("search before init");
    const t0 = performance.now();
    const count = scan(memory, l, wasm, j);
    post({ id: j.id, ok: true, count, ms: performance.now() - t0 });
  } catch (err) {
    post({ id: j.id, ok: false, error: String(err instanceof Error ? err.message : err) });
  }
};
