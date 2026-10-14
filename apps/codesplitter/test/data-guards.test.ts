import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { FileDurableObject, SNAP_EVERY } from "../src/file-do.ts";

// Guards on stored data, for agents landing commits fast: a PR that would strand or destroy what's
// already live fails here, in seconds, with the line to change if the change is on purpose.
//   1. Durable Object class migrations only ever append (the rest is packages/cli's doMigrations).
//   2. A D1 migration that drops or deletes says so in a comment.
//   3. A file's Durable Object keeps the same key layout, and still loads every storage dump on file.
setDefaultTimeout(30_000);
const here = import.meta.dir;

// 1. DO class migrations ------------------------------------------------------------------------
// Cloudflare refuses a deployed tag that changes, and deleted_classes erases that class's data.
// This is what is live; add the new tags at the end when you add a class, never edit above.
const LEDGER = [
  { tag: "v1", new_sqlite_classes: ["FileDurableObject", "GameRoom"] },
  { tag: "v2", new_sqlite_classes: ["DeployRunner"] },
  { tag: "v3", new_sqlite_classes: ["AgentSandbox"] },
  { tag: "v4", new_sqlite_classes: ["RepoSearch"] },
];
/** Tags allowed to delete a class's data. Name one here only when erasing that data is the point. */
const MAY_ERASE = new Set<string>();

const wrangler = JSON.parse(readFileSync(`${here}/../wrangler.jsonc`, "utf8").replace(/^\s*\/\/.*$/gm, ""));
const migrations: { tag: string; deleted_classes?: string[]; renamed_classes?: unknown[] }[] = wrangler.migrations ?? [];

test("DO migrations keep every live tag as it was and only append", () => {
  expect(migrations.slice(0, LEDGER.length)).toEqual(LEDGER);
  expect(new Set(migrations.map((m) => m.tag)).size).toBe(migrations.length);
});

test("a DO migration that deletes a class is named in MAY_ERASE", () => {
  const erasing = migrations.filter((m) => m.deleted_classes?.length).map((m) => m.tag);
  expect(erasing.filter((t) => !MAY_ERASE.has(t))).toEqual([]);
});

test("every bound DO class is created by a migration", () => {
  const made = new Set(migrations.flatMap((m: any) => [...(m.new_classes ?? []), ...(m.new_sqlite_classes ?? []), ...(m.renamed_classes ?? []).map((r: any) => r.to)]));
  expect(wrangler.durable_objects.bindings.map((b: any) => b.class_name).filter((c: string) => !made.has(c))).toEqual([]);
});

// 2. D1 migrations that destroy ------------------------------------------------------------------
// Dropping a table or column, or a DELETE, loses rows the moment it deploys. A new one carries
// `-- destructive-ok: <why the rows are safe to lose>`; these older ones ran before the rule.
const DESTROYS_BEFORE_RULE = new Set([
  "0021_preview_log.sql", "0025_deploy_key_providers.sql", "0038_agent_stop.sql", "0043_ci_tokens.sql",
  "0050_security_audit.sql", "0055_drop_file_search.sql",
]);
const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE)\b|\bALTER\s+TABLE\s+\S+\s+DROP\b/i;

test("a D1 migration that drops or deletes says why the data is safe to lose", () => {
  const unmarked = readdirSync(`${here}/../migrations`).filter((f) => f.endsWith(".sql")).filter((f) => {
    if (DESTROYS_BEFORE_RULE.has(f)) return false;
    const sql = readFileSync(`${here}/../migrations/${f}`, "utf8");
    const code = sql.replace(/--.*$/gm, "");
    return DESTRUCTIVE.test(code) && !/^--\s*destructive-ok:\s*\S+/m.test(sql);
  });
  expect(unmarked).toEqual([]);
});

// 3. A file's Durable Object -------------------------------------------------------------------
// Its storage is a key/value layout written on every edit and read back on every wake (file-do.ts,
// top comment), with no schema version. So the layout is pinned two ways: the shapes of the keys it
// writes, and dumps of real storage that every later version must still load.
function memory(seed?: [string, unknown][]) {
  const m = new Map<string, unknown>(seed);
  return {
    m,
    async get(k: string) { return structuredClone(m.get(k)); },
    async put(k: string, v: unknown) { m.set(k, structuredClone(v)); },
    async delete(k: string) { return m.delete(k); },
    async getAlarm() { return null; },
    async setAlarm() {},
    async deleteAlarm() {},
    async list(o: { prefix?: string; start?: string; end?: string; limit?: number } = {}) {
      const rows = [...m].filter(([k]) => k.startsWith(o.prefix ?? "") && (o.start === undefined || k >= o.start) && (o.end === undefined || k < o.end)).sort(([a], [b]) => (a < b ? -1 : 1));
      return new Map(rows.slice(0, o.limit).map(([k, v]) => [k, structuredClone(v)]));
    },
  };
}

function open(storage: ReturnType<typeof memory>) {
  let ready: Promise<void> = Promise.resolve();
  const ctx = { storage, blockConcurrencyWhile: (f: () => Promise<void>) => { ready = f(); }, getWebSockets: () => [] };
  const obj = new FileDurableObject(ctx, {} as any);
  const call = async (route: string, body?: unknown, headers: Record<string, string> = {}) => {
    await ready;
    const r = await obj.fetch(new Request(`http://do/${route}`, { headers: { "x-codesplitter-user": "ryan", ...headers }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) }));
    return r.json() as Promise<any>;
  };
  return call;
}

/** Everything the DO reads back, as a plain summary a later version must reproduce. */
async function summary(call: ReturnType<typeof open>) {
  const file = await call("file"), base = await call("base"), commits = await call("commits");
  return {
    rev: file.rev, text: file.lines.map((l: any) => l.text), base: base && base.lines.map((l: any) => l.text),
    log: (await call("log?since=0")).ops.length, commits: Array.isArray(commits) ? commits.length : (commits.commits ?? []).length,
  };
}

/** A session that touches every kind of key: a branch's fork, edits, a private line, a claim, a commit, a snapshot. */
async function session() {
  const s = memory(), call = open(s);
  await call("fork", { doc: { rev: 0, lines: [] } });
  const first = await call("ops", { ops: [{ kind: "insert", after: null, text: "alpha" }, { kind: "insert", after: null, text: "beta" }] });
  await call("private", { lines: [first.applied[0].line], private: true });
  await call("claims", { lines: [first.applied[1].line], task: "guard", ttl: 3_600_000 }, { "x-codesplitter-crew": "1" });
  await call("commit", { message: "first" });
  await call("ops", { ops: Array.from({ length: SNAP_EVERY }, (_, i) => ({ kind: "insert", after: null, text: `line ${i}` })) });
  await call("commit", { message: "second" });
  return { s, call };
}

const KEY_SHAPES = ["authors", "base", "base:*", "branch", "claim:*", "commit:*", "commits", "doc", "doc:*", "op:*", "private", "rest:*", "snap:*", "snaps", "trimmed", "wait:*", "where"];
const shape = (k: string) => (k.includes(":") ? k.split(":")[0] + ":*" : k);

test("a file's DO writes only the key shapes on file; a new one is added to KEY_SHAPES on purpose", async () => {
  const { s } = await session();
  const seen = new Set([...s.m.keys()].map(shape));
  expect([...seen].filter((k) => !KEY_SHAPES.includes(k))).toEqual([]);
  // and the ones that matter are still written, so a rename shows up as a gap, not as silence
  for (const k of ["doc", "commits", "private", "claim:*", "op:*", "commit:*", "snaps"]) expect(seen.has(k)).toBe(true);
});

// Frozen dumps: test/fixtures/file-do/<name>.json holds {storage, summary}. Every one must load in
// today's code and read back the same. If you change the layout, write a migration that reads the
// old keys (the way DocStore reads the old single `doc` key) until these pass; never edit a dump.
// Keep a layout change's dump with:  FREEZE_FILE_DO=<name> bun test test/data-guards.test.ts
const dir = `${here}/fixtures/file-do`;

test("a dump of a file's storage from an earlier version still loads", async () => {
  const name = process.env.FREEZE_FILE_DO;
  if (name) {
    if (!/^[a-z0-9-]+$/.test(name) || existsSync(`${dir}/${name}.json`)) throw new Error(`FREEZE_FILE_DO=${name}: use a new lowercase name`);
    const { s, call } = await session();
    writeFileSync(`${dir}/${name}.json`, JSON.stringify({ storage: [...s.m], summary: await summary(call) }) + "\n");
  }
  const dumps = readdirSync(dir).filter((f) => f.endsWith(".json"));
  expect(dumps.length).toBeGreaterThan(0);
  for (const f of dumps) {
    const { storage, summary: want } = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    expect({ f, ...(await summary(open(memory(storage)))) }).toEqual({ f, ...want });
  }
});
