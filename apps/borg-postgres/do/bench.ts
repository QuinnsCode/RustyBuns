// Times a preview database's life against the local spike, five runs, median and max:
// a new database, a warm query, 10k rows written and saved, a restart, and a branch of it.
//   bun do/bench.ts [http://127.0.0.1:8799]
import { arr, num, obj, opt, raw, str } from "@rustybuns/util/guard";

const B = process.argv[2] ?? "http://127.0.0.1:8799";
const Reply = obj({ error: opt(str(2000)), bytes: opt(num(0, 1e10)), memoryBytes: opt(num(0, 1e10)), rows: opt(arr(raw, 1000)) });

async function get(path: string) {
  const t = performance.now();
  const r = await fetch(B + path);
  const body = Reply(await r.json());
  if (!r.ok || body.error) throw new Error(`${path}: ${body.error ?? r.status}`);
  return { ...body, ms: performance.now() - t };
}
const q = (name: string, sql: string, write = false) => get(`/q?name=${name}&sql=${encodeURIComponent(sql)}${write ? "&write" : ""}`);

const rows10k = `create table notes (id serial primary key, body text, tags text[], meta jsonb);
insert into notes (body, tags, meta) select 'note ' || g, array['a','b'], jsonb_build_object('n', g) from generate_series(1, 10000) g;`;
const runs = new Map<string, number[]>();
const add = (k: string, v: number) => runs.set(k, [...(runs.get(k) ?? []), v]);
const tag = Date.now().toString(36);

// New databases copy the __template DO; give it setup.ts's empty cluster first.
const seeded = await fetch(`${B}/seed`, { method: "POST", body: Bun.file(new URL("./src/template.data", import.meta.url)) });
if (!seeded.ok) throw new Error(`seed: ${seeded.status}`);

for (let i = 0; i < 5; i++) {
  const n = `pr-${tag}-${i}`;
  add("new database, first query (ms)", (await q(n, "select 1")).ms);
  add("warm query (ms)", (await q(n, "select count(*) from pg_class")).ms);
  const w = await q(n, rows10k, true);
  add("10k rows written + saved (ms)", w.ms);
  add("saved size (KB)", (w.bytes ?? 0) / 1024);
  add("wasm memory, 10k rows (MB)", (w.memoryBytes ?? 0) / 1048576);
  await get(`/restart?name=${n}`);
  add("restart, first query (ms)", (await q(n, "select count(*) from notes")).ms);
  add("branch of it (ms)", (await get(`/branch?name=${n}-b&from=${n}`)).ms);
  const b = await q(`${n}-b`, "select count(*)::int as n from notes");
  if (JSON.stringify(b.rows) !== '[{"n":10000}]') throw new Error(`branch has ${JSON.stringify(b.rows)}`);
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const [k, v] of runs) console.log(`${k.padEnd(32)} median ${Math.round(med(v))}  max ${Math.round(Math.max(...v))}`);
