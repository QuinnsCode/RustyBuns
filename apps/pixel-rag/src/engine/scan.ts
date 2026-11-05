// One worker's share of a search: rows [start, end) into its slot, by the crate or the twin.
import { distAt, idxAt, MAX_K, queryAt, WORDS, WORDS32, type Layout, type PixelRagWasm } from "./layout.ts";
import { topk } from "./twin.ts";
import type { Job } from "./protocol.ts";

export function scan(mem: WebAssembly.Memory, lay: Layout, w: PixelRagWasm | null, j: Extract<Job, { type: "search" }>): number {
  if (w) return w.pr_topk(lay.codes, j.start, j.end, WORDS, queryAt(lay, 0), j.k, idxAt(lay, j.slot), distAt(lay, j.slot));
  const b = mem.buffer;
  return topk(new Uint32Array(b, lay.codes, lay.n * WORDS32), j.start, j.end, new Uint32Array(b, queryAt(lay, 0), WORDS32),
    j.k, new Uint32Array(b, idxAt(lay, j.slot), MAX_K), new Uint32Array(b, distAt(lay, j.slot), MAX_K));
}
