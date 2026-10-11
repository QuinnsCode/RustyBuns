import { expect, setDefaultTimeout, test } from "bun:test";
import { storage } from "@rustybuns/shell-bun";
import { FileDurableObject, KEEP_SNAPS, SNAP_EVERY } from "../src/file-do.ts";
import { replay, type Applied } from "../src/lines.ts";

setDefaultTimeout(60_000);

/** The file DO over the sqlite twin, its log reads recorded. */
async function file() {
  const s = storage(":memory:"), lists: { prefix?: string; start?: string; end?: string; limit?: number }[] = [];
  const list = s.list.bind(s);
  s.list = (o) => { lists.push(o ?? {}); return list(o); };
  let ready: Promise<void> = Promise.resolve();
  const ctx = { storage: s, blockConcurrencyWhile: (f: () => Promise<void>) => { ready = f(); }, getWebSockets: () => [] };
  const o = new FileDurableObject(ctx, {} as any);
  await ready;
  const call = (route: string, body?: unknown) =>
    o.fetch(new Request(`http://do/${route}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }));
  return { o, s, lists, call };
}

test("a long log is read by range, snapshotted, and trimmed past KEEP_SNAPS snapshots (#625)", async () => {
  const { o, s, lists, call } = await file();
  const all: Applied[] = [];
  // Pairs of batches: a thousand lines in, then all but ten out, so the doc stays small and the log grows.
  for (let i = 0, past = 0; past < 3; i++) {
    if (o.trimmed) past++;
    const add = (await (await call("ops", { ops: Array.from({ length: 1000 }, (_, j) => ({ kind: "insert", after: null, text: `${i}.${j}` })) })).json()) as { applied: Applied[] };
    all.push(...add.applied);
    const del = (await (await call("ops", { ops: add.applied.slice(0, 990).map((a) => ({ kind: "delete", line: a.line, base: a.rev })) })).json()) as { applied: Applied[] };
    all.push(...del.applied);
  }
  await o.sweeping;
  const rev = all.at(-1)!.rev;

  expect(o.snaps.length).toBe(KEEP_SNAPS);
  expect(o.trimmed).toBe(o.snaps[0]);
  // A snapshot comes at the first batch that reaches SNAP_EVERY ops, so up to a batch (1000 ops) late.
  expect(rev - o.trimmed).toBeLessThan((KEEP_SNAPS + 1) * (SNAP_EVERY + 1000));
  // The ops history no longer reaches are gone, and so is the snapshot that let them go.
  const ops = await s.list<Applied>({ prefix: "op:", limit: 1e9 });
  expect(Math.min(...[...ops.values()].map((a) => a.rev))).toBe(o.trimmed + 1);
  expect([...(await s.list({ prefix: "snap:", limit: 1e9 })).keys()].filter((k) => !/:\d+:/.test(k)).length).toBe(KEEP_SNAPS);

  // The log from where history starts, and a 410 before it.
  lists.length = 0;
  const log = (await (await call(`log?since=${o.trimmed}`)).json()) as Applied[];
  expect(log).toEqual(all.filter((a) => a.rev > o.trimmed));
  expect(lists.every((l) => l.start && l.limit)).toBe(true);
  const gone = await call(`log?since=${o.trimmed - 1}`);
  expect(gone.status).toBe(410);
  expect(((await gone.json()) as { from: number }).from).toBe(o.trimmed);
  expect((await call(`at?rev=${o.trimmed - 1}`)).status).toBe(410);

  // Time travel from a snapshot matches replaying the whole log, blame and all.
  for (const at of [o.trimmed, o.snaps[3]! + 777, rev - 5, rev]) {
    lists.length = 0;
    expect(await (await call(`at?rev=${at}`)).json()).toEqual(replay(all, at));
    const read = lists.filter((l) => l.prefix === "op:").reduce((n, l) => n + (l.limit ?? 0), 0);
    expect(read).toBeLessThanOrEqual(SNAP_EVERY + 1000);
  }

  // A commit's writers come from the log it still has.
  expect(((await (await call("commit", {})).json()) as { commit: { writers: string[] } }).commit.writers).toEqual(["anon"]);
});

test("a short log keeps everything: since=0 and time travel to rev 1", async () => {
  const { call } = await file();
  const r = (await (await call("ops", { ops: [{ kind: "insert", after: null, text: "a" }, { kind: "insert", after: null, text: "b" }] })).json()) as { applied: Applied[] };
  expect(await (await call("log?since=0")).json()).toEqual(r.applied);
  expect(await (await call("log?since=1")).json()).toEqual(r.applied.slice(1));
  expect(((await (await call("at?rev=1")).json()) as { lines: { text: string }[] }).lines.map((l) => l.text)).toEqual(["a"]);
});
