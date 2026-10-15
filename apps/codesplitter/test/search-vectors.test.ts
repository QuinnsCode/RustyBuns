import { expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "./app-kit.ts";
import { chunksOf, CHUNK, MAX_CHUNKS } from "../src/search.ts";

// Search across repos through one vector index (search.ts, #636), against in-memory stand-ins
// for Vectorize and Workers AI: a word's hash picks its dimension, so shared words are near.
setDefaultTimeout(30_000);

const DIMS = 384;
function fakeAi() {
  const calls: string[][] = [];
  const vec = (t: string) => {
    const v = new Array(DIMS).fill(0);
    for (const w of t.toLowerCase().match(/[a-z0-9_]+/g) ?? []) v[[...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % DIMS]++;
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  };
  return { calls, run: async (_model: string, { text }: { text: string[] }) => { calls.push(text); return { data: text.map(vec) }; } };
}

function fakeVectorize() {
  const rows = new Map<string, { values: number[]; metadata: Record<string, any> }>();
  const INDEXED = ["repo", "pub"];
  const pass = (md: Record<string, any>, f?: Record<string, any>) => !f || Object.entries(f).every(([k, c]) =>
    c && typeof c === "object" && "$in" in c ? c.$in.includes(md[k]) : md[k] === c);
  return {
    rows,
    upsert: async (vs: any[]) => { for (const v of vs) rows.set(v.id, { values: v.values, metadata: v.metadata }); },
    deleteByIds: async (ids: string[]) => { for (const id of ids) rows.delete(id); },
    getByIds: async (ids: string[]) => ids.filter((id) => rows.has(id)).map((id) => ({ id, metadata: rows.get(id)!.metadata })),
    query: async (q: number[], o: { topK: number; filter?: any }) => ({
      matches: [...rows].filter(([, r]) => pass(r.metadata, o.filter))
        .map(([id, r]) => ({ id, score: r.values.reduce((s, x, i) => s + x * q[i]!, 0), metadata: Object.fromEntries(INDEXED.map((k) => [k, r.metadata[k]])) }))
        .sort((a, b) => b.score - a.score).slice(0, o.topK),
    }),
  };
}

async function app() {
  const VECTORS = fakeVectorize(), AI = fakeAi();
  const call = await boot({ GH_CLI: "off", ADMINS: "boss", VECTORS, AI });
  const post = (user: string, url: string, body: unknown = {}) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  const commit = async (user: string, owner: string, repo: string, path: string, content: string) => {
    await post(user, `/api/repos/${owner}/${repo}/files`, { path, content });
    expect((await post(user, `/api/repos/${owner}/${repo}/do/commit?path=${path}`, { message: path })).status).toBe(200);
  };
  const search = async (user: string | null, q: string) => (await call(user, `/api/search?${q}`)).json() as Promise<any>;
  const where = (hits: any[]) => hits.map((h: any) => `${h.owner}/${h.repo}/${h.path}`).sort();
  const stale = async (owner: string, repo: string) => ((await call.env.DB.prepare("SELECT stale FROM repo_search WHERE owner = ? AND repo = ?").bind(owner, repo).first()) as any)?.stale;
  for (const u of ["ana", "bo", "boss"]) await post(u, "/api/login", { name: u });
  return { call, post, commit, search, where, stale, VECTORS, AI };
}

test("a file's chunks: 40 lines each, blank ones skipped but numbered, at most 16", () => {
  const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join("\n");
  expect(chunksOf("one\ntwo")).toEqual([{ i: 0, line: 1, text: "one\ntwo" }]);
  const gap = chunksOf(lines(CHUNK * 3, (i) => (i >= CHUNK && i < 2 * CHUNK ? "" : `l${i}`)));
  expect(gap.map((c) => [c.i, c.line])).toEqual([[0, 1], [2, 2 * CHUNK + 1]]);
  expect(chunksOf(lines(CHUNK * (MAX_CHUNKS + 5), (i) => `l${i}`)).length).toBe(MAX_CHUNKS);
});

test("commits feed the index; a search routes through it to what the caller can see", async () => {
  const { call, post, commit, search, where, VECTORS } = await app();
  await post("ana", "/api/repos", { name: "one" });
  await post("bo", "/api/repos", { name: "two" });
  await post("bo", "/api/repos", { name: "hush", visibility: "private" });
  await commit("ana", "ana", "one", "a.ts", "const brass_tuba = 1\n");
  await commit("bo", "bo", "two", "b.ts", "// brass_tuba again\nexport {}\n");
  await commit("bo", "bo", "hush", "c.ts", "brass_tuba in secret");

  // One chunk a file, tagged with its repo and whether that's public.
  expect([...VECTORS.rows.values()].map((r) => [r.metadata.repo, r.metadata.pub, r.metadata.path]).sort())
    .toEqual([["ana/one", true, "a.ts"], ["bo/hush", false, "c.ts"], ["bo/two", true, "b.ts"]]);
  expect(await call.env.DB.prepare("SELECT SUM(stale) AS n FROM repo_search").first()).toEqual({ n: 0 });

  // FTS5 hits from the repos it routes to, marked like before; a private one only for its crew.
  const all = await search("ana", "q=brass_tuba");
  expect(where(all)).toEqual(["ana/one/a.ts", "bo/two/b.ts"]);
  expect(all[0].snippet).toContain("«brass_tuba»");
  expect(where(await search("bo", "q=brass_tuba"))).toEqual(["ana/one/a.ts", "bo/hush/c.ts", "bo/two/b.ts"]);
  expect(where(await search(null, "q=brass_tuba"))).toEqual(["ana/one/a.ts", "bo/two/b.ts"]);

  // Words no file has all of: the nearest chunks, as they were committed.
  const near = await search("ana", "q=brass_tuba%20sousaphone");
  expect(where(near)).toEqual(["ana/one/a.ts", "bo/two/b.ts"]);
  expect(near.find((h: any) => h.repo === "one").snippet).toBe("const brass_tuba = 1");

  // Made public: hidden from no one, but its tags say private until the next embed.
  expect((await call("bo", "/api/repos/bo/hush", { method: "PUT", body: JSON.stringify({ visibility: "public" }) })).status).toBe(200);
  expect(where(await search("ana", "q=brass_tuba"))).toEqual(["ana/one/a.ts", "bo/two/b.ts"]);
  expect((await post("ana", "/api/admin/scale/search-embed")).status).toBe(403);
  expect(await (await post("boss", "/api/admin/scale/search-embed")).json()).toEqual({ embedded: 1, left: 0 });
  expect(where(await search("ana", "q=brass_tuba"))).toEqual(["ana/one/a.ts", "bo/hush/c.ts", "bo/two/b.ts"]);
  // Made private: D1 hides it at once, whatever the tag.
  await call("bo", "/api/repos/bo/hush", { method: "PUT", body: JSON.stringify({ visibility: "private" }) });
  expect(where(await search("ana", "q=brass_tuba"))).toEqual(["ana/one/a.ts", "bo/two/b.ts"]);

  // A deleted repo takes its vectors along.
  expect((await call("bo", "/api/repos/bo/two?confirm=two", { method: "DELETE" })).status).toBe(200);
  expect([...VECTORS.rows.values()].map((r) => r.metadata.repo).sort()).toEqual(["ana/one", "bo/hush"]);
});

test("a bigger commit adds chunks and a smaller one clears them", async () => {
  const { call, post, commit, VECTORS } = await app();
  await post("ana", "/api/repos", { name: "grow" });
  const body = (n: number) => Array.from({ length: n }, (_, i) => `line_${i}`).join("\n");
  await commit("ana", "ana", "grow", "g.ts", body(CHUNK * 3));
  expect(VECTORS.rows.size).toBe(3);
  // Down to one chunk: the other two go.
  const { lines } = (await (await call("ana", "/api/repos/ana/grow/do/file?path=g.ts")).json()) as { lines: { id: string; rev: number }[] };
  const ops = lines.slice(CHUNK).map((l) => ({ kind: "delete", line: l.id, base: l.rev }));
  expect((await post("ana", "/api/repos/ana/grow/do/ops?path=g.ts", { ops })).status).toBe(200);
  expect((await post("ana", "/api/repos/ana/grow/do/commit?path=g.ts", { message: "trim" })).status).toBe(200);
  expect([...VECTORS.rows.values()].map((r) => r.metadata.line)).toEqual([1]);
});

test("files from before the index are embedded by the cron's round, and search fans out till then", async () => {
  const { call, post, commit, search, where, stale, VECTORS, AI } = await app();
  const env = call.env as any;
  env.VECTORS = undefined;
  await post("ana", "/api/repos", { name: "old" });
  await commit("ana", "ana", "old", "o.ts", "dusty_banjo here");
  expect((await post("boss", "/api/admin/scale/search-embed")).status).toBe(409);
  env.VECTORS = VECTORS;
  expect(await stale("ana", "old")).toBe(1);
  // Nothing in the index yet: the fan-out still finds it.
  expect(where(await search("ana", "q=dusty_banjo"))).toEqual(["ana/old/o.ts"]);
  expect(await (await post("boss", "/api/admin/scale/search-embed")).json()).toEqual({ embedded: 1, left: 0 });
  expect(await stale("ana", "old")).toBe(0);
  expect(VECTORS.rows.size).toBe(1);
  expect(AI.calls.some((t) => t[0]!.includes("dusty_banjo"))).toBe(true);
  expect(where(await search("ana", "q=dusty_banjo"))).toEqual(["ana/old/o.ts"]);
});
