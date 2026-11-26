// A preview database's PGlite fits a Durable Object (#6203): the template do/setup.ts makes boots in 64 MB of
// wasm memory, and a copy of it holding 10k rows is still in 64 MB after a reload.
import { expect, setDefaultTimeout, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { INITDB_PARAMS, lowerMemoryFloor, SLIM_SQL, WASM_MEMORY } from "../do/memory.ts";

setDefaultTimeout(120_000); // two PGlite boots and an initdb

const stock = readFileSync(join(dirname(Bun.resolveSync("@electric-sql/pglite", import.meta.dir)), "pglite.wasm"));

test("the template and a copy of it with 10k rows stay in 64 MB", async () => {
  const opts = { pgliteWasmModule: new WebAssembly.Module(lowerMemoryFloor(stock, WASM_MEMORY)), initialMemory: WASM_MEMORY };
  const fresh = await PGlite.create({ ...opts, initDbStartParams: INITDB_PARAMS });
  for (const sql of SLIM_SQL) await fresh.exec(sql);
  const template = await fresh.dumpDataDir("gzip");
  await fresh.close();

  const db = await PGlite.create({ ...opts, loadDataDir: template });
  await db.exec(`create table notes (id serial primary key, body text, meta jsonb);
    insert into notes (body, meta) select 'note ' || g, jsonb_build_object('n', g) from generate_series(1, 10000) g;`);
  const copy = await db.dumpDataDir("gzip");
  await db.close();

  const again = await PGlite.create({ ...opts, loadDataDir: copy });
  expect((await again.query("select count(*)::int as n from notes")).rows).toEqual([{ n: 10000 }]);
  expect((await again.query("select datname from pg_database")).rows).toEqual([{ datname: "postgres" }]);
  expect((await again.query("show wal_segment_size")).rows).toEqual([{ wal_segment_size: "1MB" }]);
  expect(again.Module.HEAPU8.buffer.byteLength).toBe(WASM_MEMORY);
  await again.close();
});

test("a wasm with no memory import is refused, not passed through", () => {
  const empty = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  expect(() => lowerMemoryFloor(empty, WASM_MEMORY)).toThrow("doesn't import a memory");
});
