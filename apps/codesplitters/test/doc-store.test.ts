import { expect, setDefaultTimeout, test } from "bun:test";
import { CHUNK_CHARS, CHUNK_LINES, DocStore } from "../src/doc-store.ts";
import { FileDurableObject } from "../src/file-do.ts";
import { apply, empty, type Doc, type Op } from "../src/lines.ts";

setDefaultTimeout(30_000);

/** DO storage's key/value shape over a Map, counting puts; values are cloned like the real thing. */
function memory() {
  const m = new Map<string, unknown>();
  const s = {
    m, puts: [] as string[],
    async get(k: string) { return structuredClone(m.get(k)); },
    async put(k: string, v: unknown) { s.puts.push(k); m.set(k, structuredClone(v)); },
    async delete(k: string) { return m.delete(k); },
    async list(o: { prefix?: string } = {}) {
      return new Map([...m].filter(([k]) => k.startsWith(o.prefix ?? "")).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => [k, structuredClone(v)]));
    },
  };
  return s;
}

function edit(doc: Doc, ops: Op[]) {
  const r = apply(doc, ops, "ryan");
  if (!r.ok) throw new Error(JSON.stringify(r.conflicts));
  return r.applied.map((a) => a.line);
}

const big = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "insert" as const, after: i ? `L${i}` : null, text: `line ${i + 1}` }));

test("a doc saved edit by edit loads back the same, whatever the edits", async () => {
  const s = memory(), store = new DocStore(s, "doc"), doc = empty();
  let seed = 7;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  await Promise.all(store.save(doc, edit(doc, big(1200))));
  for (let i = 0; i < 400; i++) {
    const ops: Op[] = [];
    for (let j = 0; j < 1 + rnd(4); j++) {
      const l = doc.lines[rnd(doc.lines.length)];
      const k = rnd(10);
      if (!l || k < 4) ops.push({ kind: "insert", after: k === 0 || !l ? null : l.id, text: `new ${i}.${j}` });
      else if (k < 7) ops.push({ kind: "set", line: l.id, text: `set ${i}.${j}`, base: l.rev });
      else if (!ops.some((o) => o.kind !== "insert" && o.line === l.id)) ops.push({ kind: "delete", line: l.id, base: l.rev });
    }
    const r = apply(doc, ops, "ryan");
    if (r.ok) await Promise.all(store.save(doc, r.applied.map((a) => a.line)));
  }
  // Delete nearly everything, so whole chunks empty out.
  await Promise.all(store.save(doc, edit(doc, doc.lines.slice(5).map((l) => ({ kind: "delete", line: l.id, base: l.rev })))));
  const back = await new DocStore(s, "doc").load();
  expect(back).toEqual(doc);
  // No chunk is left behind, and none is too big.
  const chunks = [...s.m.keys()].filter((k) => k.startsWith("doc:"));
  expect(chunks.length).toBe((s.m.get("doc") as any).chunks.length);
  for (const k of chunks) expect((s.m.get(k) as unknown[]).length).toBeLessThanOrEqual(2 * CHUNK_LINES);
});

test("an edit writes the manifest and the one chunk it touched, not the whole file", async () => {
  const s = memory(), store = new DocStore(s, "doc"), doc = empty();
  await Promise.all(store.save(doc, edit(doc, big(20_000))));
  expect(store.chunks.length).toBe(20_000 / CHUNK_LINES);
  s.puts.length = 0;
  const l = doc.lines[12_345]!;
  await Promise.all(store.save(doc, edit(doc, [{ kind: "set", line: l.id, text: "changed", base: l.rev }, { kind: "insert", after: l.id, text: "and a new one" }])));
  expect(s.puts.sort()).toEqual(["doc", store.chunkKey(store.chunkOf.get(l.id)!)]);
  expect(await new DocStore(s, "doc").load()).toEqual(doc);
});

test("a chunk splits as it grows, and long lines make smaller chunks", async () => {
  const s = memory(), store = new DocStore(s, "doc"), doc = empty();
  await Promise.all(store.save(doc, edit(doc, [{ kind: "insert", after: null, text: "first" }])));
  // Typing at the end of the file, a line at a time.
  for (let i = 0; i < 3 * CHUNK_LINES; i++) await Promise.all(store.save(doc, edit(doc, [{ kind: "insert", after: doc.lines.at(-1)!.id, text: `x${i}` }])));
  expect(store.chunks.length).toBeGreaterThan(1);
  for (const n of store.chunks) expect((s.m.get(store.chunkKey(n)) as unknown[]).length).toBeLessThanOrEqual(2 * CHUNK_LINES);
  const wide = "y".repeat(4000);
  await Promise.all(store.save(doc, edit(doc, Array.from({ length: 200 }, () => ({ kind: "insert" as const, after: null, text: wide })))));
  for (const n of store.chunks) expect(JSON.stringify(s.m.get(store.chunkKey(n))).length).toBeLessThanOrEqual(2 * CHUNK_CHARS + 2);
  expect(await new DocStore(s, "doc").load()).toEqual(doc);
});

test("a doc stored the old way, in one key, loads and is rewritten in chunks", async () => {
  const s = memory(), doc = empty();
  edit(doc, big(1500));
  await s.put("doc", doc);
  const store = new DocStore(s, "doc");
  expect(await store.load()).toEqual(doc);
  expect((s.m.get("doc") as any).lines).toBeUndefined();
  expect(await new DocStore(s, "doc").load()).toEqual(doc);
  expect(await new DocStore(s, "nothing").load()).toBeNull();
});

test("a file past the old 2 MB key saves, reloads, and forks into a branch", async () => {
  const s = memory();
  const ctx = { storage: s, blockConcurrencyWhile: (f: () => Promise<void>) => { ready = f(); }, getWebSockets: () => [] };
  let ready: Promise<void> = Promise.resolve();
  const call = (o: FileDurableObject, route: string, body?: unknown) =>
    o.fetch(new Request(`http://do/${route}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) })).then((r) => r.json() as Promise<any>);
  const a = new FileDurableObject(ctx, {} as any);
  await ready;
  // 40k lines of 60 characters: about 4 MB of doc.
  // Each at the top, so apply doesn't search 40k lines for the one before.
  const ops = big(40_000).map((o) => ({ ...o, after: null, text: o.text.padEnd(60, ".") }));
  expect((await call(a, "ops", { ops })).rev).toBe(40_000);
  for (const [k, v] of s.m) expect(JSON.stringify(v).length).toBeLessThan(2 * CHUNK_CHARS + 2);
  const b = new FileDurableObject(ctx, {} as any);
  await ready;
  expect((await call(b, "file")).lines.length).toBe(40_000);

  const branch = memory();
  const c = new FileDurableObject({ ...ctx, storage: branch }, {} as any);
  await ready;
  await call(c, "fork", { doc: await call(b, "file") });
  const d = new FileDurableObject({ ...ctx, storage: branch }, {} as any);
  await ready;
  expect((await call(d, "base")).lines.length).toBe(40_000);
  expect((await call(d, "file")).rev).toBe(40_000);
});
