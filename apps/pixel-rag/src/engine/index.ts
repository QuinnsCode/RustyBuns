// The vector index: n codes in ONE shared WebAssembly.Memory, searched by a pool of workers that
// each scan a slice of the rows and write their best k back into that same memory. Nothing is
// copied to a worker; it gets the memory once and then only row ranges. The same class runs in a
// page (Web Workers on wasm or the TypeScript twin) and on the desktop host (Bun workers on the
// native crate, pointing straight at the memory's bytes).
import { distAt, idxAt, layout, MAX_K, MAX_PAGES, MAX_WORKERS, queryAt, STACK_SLICE, wasmExports, WORDS, WORDS32, type Layout, type PixelRagWasm } from "./layout.ts";
import * as twin from "./twin.ts";
import type { JobOut, Reply, Engine } from "./protocol.ts";

export type { Engine };

/** Without wasm the memory still starts past this, so offsets look alike in every lane. */
const TS_BASE = 2 << 20;

export interface Hit { row: number; dist: number }
export interface Search { hits: Hit[]; ms: number; workers: number[] }

/** Can this page share memory with its workers? Needs cross-origin isolation (COOP + COEP). */
export function canShare(): boolean {
  return typeof SharedArrayBuffer !== "undefined" && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated !== false;
}

/** The main thread's handle on the memory: wasm when there is a module, else the twin on views. */
class Local {
  constructor(readonly memory: WebAssembly.Memory, readonly wasm: PixelRagWasm | null) {}
  u8 = (at: number, len: number) => new Uint8Array(this.memory.buffer, at, len);
  u32 = (at: number, len: number) => new Uint32Array(this.memory.buffer, at, len);
  f32 = (at: number, len: number) => new Float32Array(this.memory.buffer, at, len);
  fill(at: number, count: number, seed: number) {
    if (this.wasm) this.wasm.pr_fill(at, count, seed);
    else twin.fill(this.u32(at, count), seed);
  }
  quantize(vecs: number, n: number, dims: number, out: number) {
    if (this.wasm) this.wasm.pr_quantize(vecs, n, dims, out);
    else twin.quantize(this.f32(vecs, n * dims), n, dims, this.u32(out, n * (dims / 32)));
  }
  embed(rgba: number, bytes: number, width: number, x: number, y: number, size: number, out: number) {
    if (this.wasm) this.wasm.pr_embed(rgba, width, x, y, size, out);
    else twin.embed(this.u8(rgba, bytes), width, x, y, size, this.f32(out, 1024));
  }
  dhash(rgba: number, bytes: number, width: number, x: number, y: number, size: number): bigint {
    return this.wasm ? BigInt.asUintN(64, this.wasm.pr_dhash(rgba, width, x, y, size)) : twin.dhash(this.u8(rgba, bytes), width, x, y, size);
  }
  topk(l: Layout, start: number, end: number, k: number, slot: number): number {
    if (this.wasm) return this.wasm.pr_topk(l.codes, start, end, WORDS, queryAt(l, 0), k, idxAt(l, slot), distAt(l, slot));
    return twin.topk(this.u32(l.codes, l.n * WORDS32), start, end, this.u32(queryAt(l, 0), WORDS32), k, this.u32(idxAt(l, slot), MAX_K), this.u32(distAt(l, slot), MAX_K));
  }
}

export interface IndexOptions {
  /** Codes it can hold. */
  capacity: number;
  /** Bytes of free scratch after the results (a screenshot's pixels, vectors to quantize). */
  scratch?: number;
  /** pixel_rag.wasm, patched for a shared memory; null runs the twin. */
  wasm: Uint8Array | null;
}

export class SharedIndex {
  readonly memory: WebAssembly.Memory;
  readonly layout: Layout;
  readonly local: Local;
  private module: WebAssembly.Module | null;
  private pool: Worker[] = [];
  private poolEngine: Engine | "mixed" | null = null;
  private seq = 0;
  private waiting = new Map<number, (r: Reply) => void>();
  /** Rows filled so far; a search scans [0, used). */
  used = 0;

  private constructor(memory: WebAssembly.Memory, module: WebAssembly.Module | null, local: Local, l: Layout) {
    this.memory = memory; this.module = module; this.local = local; this.layout = l;
  }

  static async create(o: IndexOptions): Promise<SharedIndex> {
    const shared = canShare();
    // Probe the layout's size with the largest base the wasm could ask for, then size the memory.
    const pagesFor = (bytes: number) => Math.ceil(bytes / 65536);
    let module: WebAssembly.Module | null = null;
    if (o.wasm && shared) {
      try { module = await WebAssembly.compile(o.wasm); } catch (e) { console.warn("[pixel-rag] wasm refused, the twin runs instead", e); }
    }
    const want = layout(4 << 20, o.capacity, o.scratch ?? 0).end;
    if (pagesFor(want) > MAX_PAGES) throw new Error(`an index of ${o.capacity.toLocaleString()} codes needs ${(want / 2 ** 30).toFixed(1)} GiB; the most is 1 GiB`);
    const memory = new WebAssembly.Memory({ initial: pagesFor(want), maximum: MAX_PAGES, shared });
    let wasm: PixelRagWasm | null = null;
    if (module) {
      wasm = wasmExports(await WebAssembly.instantiate(module, { env: { memory } }));
      wasm.__stack_pointer.value = (1 << 20);
    }
    const base = wasm ? Number(wasm.__heap_base.value) : TS_BASE;
    return new SharedIndex(memory, module, new Local(memory, wasm), layout(base, o.capacity, o.scratch ?? 0));
  }

  /** "wasm" when the Rust build loaded, else "ts". */
  get engine(): Engine { return this.local.wasm ? "wasm" : "ts"; }

  /** The codes as u32 words, row r at r * WORDS32. */
  codes(): Uint32Array { return this.local.u32(this.layout.codes, this.used * WORDS32); }

  /** Random codes: the benchmark's index, the same bits in every lane for a seed. */
  fillRandom(seed: number) { this.local.fill(this.layout.codes, this.layout.n * WORDS32, seed); this.used = this.layout.n; }

  /**
   * Start `count` workers on `engine`, or round-robin over several (native and wasm side by side).
   * `spawn` makes one worker: src/engine/search-worker.ts in a page, src/engine/host-worker.ts on
   * the host, written inline as `new Worker(new URL(...))` so the bundlers pick the file up. 0
   * searches on this thread.
   */
  async start(count: number, engine: Engine | Engine[], spawn: () => Worker) {
    this.stop();
    if (count > 0 && !canShare()) throw new Error("this page can't share memory with workers (not cross-origin isolated)");
    const lanes = Array.isArray(engine) ? engine : [engine];
    if (lanes.includes("wasm") && !this.module) throw new Error("no wasm build loaded");
    const n = Math.min(count, MAX_WORKERS - 1);
    const ready: Promise<unknown>[] = [];
    for (let w = 0; w < n; w++) {
      const worker = spawn();
      worker.onmessage = (e: MessageEvent<Reply>) => {
        const done = this.waiting.get(e.data.id);
        if (done) { this.waiting.delete(e.data.id); done(e.data); }
      };
      this.pool.push(worker);
      // Slot 0 is this thread's; worker w gets slot w + 1 for its stack and its results.
      ready.push(this.send(worker, { type: "init", engine: lanes[w % lanes.length], memory: this.memory, module: this.module, stack: (1 << 20) - (w + 1) * STACK_SLICE, layout: this.layout }));
    }
    await Promise.all(ready);
    this.poolEngine = lanes.length === 1 ? lanes[0] : "mixed";
  }

  stop() {
    for (const w of this.pool) w.terminate();
    this.pool = [];
    this.poolEngine = null;
  }

  get workers(): number { return this.pool.length; }

  private send(worker: Worker, job: JobOut): Promise<Reply> {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.waiting.set(id, (r) => (r.ok ? res(r) : rej(new Error(r.error))));
      worker.postMessage({ ...job, id });
    });
  }

  /** The k rows nearest `query` (WORDS32 u32s), nearest first, ties to the lower row. */
  async search(query: Uint32Array, k: number): Promise<Search> {
    const l = this.layout;
    k = Math.min(k, MAX_K);
    this.local.u32(queryAt(l, 0), WORDS32).set(query);
    const t0 = performance.now();
    const parts: { slot: number; count: number }[] = [];
    const workers: number[] = [];
    if (this.pool.length === 0) {
      parts.push({ slot: 0, count: this.local.topk(l, 0, this.used, k, 0) });
      workers.push(performance.now() - t0);
    } else {
      const W = this.pool.length;
      const replies = await Promise.all(this.pool.map((w, i) => this.send(w, {
        type: "search", start: Math.floor((i * this.used) / W), end: Math.floor(((i + 1) * this.used) / W), k, slot: i + 1,
      })));
      replies.forEach((r, i) => { parts.push({ slot: i + 1, count: r.ok ? r.count : 0 }); workers.push(r.ok ? r.ms : 0); });
    }
    const hits: Hit[] = [];
    for (const p of parts) {
      const idx = this.local.u32(idxAt(l, p.slot), p.count), dist = this.local.u32(distAt(l, p.slot), p.count);
      for (let i = 0; i < p.count; i++) hits.push({ row: idx[i], dist: dist[i] });
    }
    hits.sort((a, b) => a.dist - b.dist || a.row - b.row);
    return { hits: hits.slice(0, k), ms: performance.now() - t0, workers };
  }

  /** Which engine the pool runs, or this thread's when there is no pool. */
  get searchEngine(): Engine | "mixed" { return this.poolEngine ?? this.engine; }
}
