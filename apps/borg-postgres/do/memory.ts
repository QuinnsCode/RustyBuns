// Fitting PGlite into one Durable Object (128 MB for everything, #6203).
//
// Stock PGlite's wasm imports its memory with a floor of 2048 pages (128 MB), so handing it a smaller
// `initialMemory` fails to link. That floor is the only thing Emscripten's INITIAL_MEMORY changes in a
// build that imports its memory (static data ends near 3 MB, and the heap grows on demand), so
// `lowerMemoryFloor` rewrites that one number instead of rebuilding PGlite from source.
//
// The floor isn't what filled memory, though: Postgres's default 128 MB of shared buffers grew it to
// 184 MB at boot. With `shared_buffers=16MB` it stays at 64 MB through 10k rows.

/** What a Durable Object's PGlite starts with, and stays at for a preview's data. */
export const WASM_MEMORY = 64 * 1024 * 1024;

/** initdb's flags for the template cluster: 1 MB WAL segments instead of 16. */
export const INITDB_PARAMS = ["--wal-segsize=1"];

/** Run once on the fresh cluster before it's saved as the template, one statement per entry
 *  (DROP DATABASE can't share a query string). It keeps only `postgres`: each preview env is a schema in it. */
export const SLIM_SQL = [
  "update pg_database set datistemplate = false where datname in ('template0', 'template1')",
  "drop database template0",
  "drop database template1",
  "alter system set shared_buffers = '16MB'", // postgresql.auto.conf, so every copy of the template boots with it
];

const PAGE = 64 * 1024;

/** A copy of `wasm` whose imported memory's floor is `bytes`. Throws on a module that doesn't import one. */
export function lowerMemoryFloor(wasm: Uint8Array, bytes: number): Uint8Array<ArrayBuffer> {
  if (bytes % PAGE) throw new Error(`memory floor ${bytes} is not a whole number of 64 KB pages`);
  const out = new Uint8Array(wasm);
  let p = 8;
  const leb = () => { let r = 0, s = 0, x: number; do { x = out[p++]!; r += (x & 127) * 2 ** s; s += 7; } while (x & 128); return r; };
  const skipName = () => { const n = leb(); p += n; };
  while (p < out.length) {
    const id = out[p++]!;
    const end = leb() + p;
    if (id !== 2) { p = end; continue; }
    for (let n = leb(); n > 0; n--) {
      skipName(); skipName();
      const kind = out[p++]!;
      if (kind === 0) leb();                                                   // function: type index
      else if (kind === 1) { p++; const f = leb(); leb(); if (f & 1) leb(); }  // table: elem type, limits
      else if (kind === 3) p += 2;                                             // global: type, mutability
      else if (kind === 4) { p++; leb(); }                                     // tag: attribute, type index
      else if (kind === 2) {
        const flags = out[p++]!;
        const at = p;
        const old = leb();
        writeLeb(out, at, p - at, bytes / PAGE);
        if (flags & 1 && leb() * PAGE < bytes) throw new Error("memory floor above the module's maximum");
        if (old * PAGE < bytes) throw new Error(`memory floor ${bytes} is above the module's own ${old * PAGE}`);
        return out;
      } else throw new Error(`unknown import kind ${kind}`);
    }
    break;
  }
  throw new Error("this wasm doesn't import a memory");
}

/** `value` as LEB128 in exactly `width` bytes (padded, which wasm allows), so no section size moves. */
function writeLeb(out: Uint8Array, at: number, width: number, value: number) {
  for (let i = 0; i < width; i++) {
    const last = i === width - 1;
    out[at + i] = (value & 127) | (last ? 0 : 128);
    value = Math.floor(value / 128);
  }
  if (value) throw new Error(`memory floor doesn't fit the ${width} bytes the module gave it`);
}
