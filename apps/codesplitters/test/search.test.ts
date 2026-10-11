import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

// Search, one index per repo (search.ts): end to end, in-process.
setDefaultTimeout(30_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

async function app() {
  const call = await boot({ GH_CLI: "off", ADMINS: "boss" });
  opened.push(call);
  const post = (user: string, url: string, body: unknown = {}) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  const commit = async (user: string, owner: string, repo: string, path: string, content: string) => {
    await post(user, `/api/repos/${owner}/${repo}/files`, { path, content });
    expect((await post(user, `/api/repos/${owner}/${repo}/do/commit?path=${path}`, { message: path })).status).toBe(200);
  };
  const search = async (user: string | null, q: string) => (await call(user, `/api/search?${q}`)).json() as Promise<any>;
  for (const u of ["ana", "bo", "boss"]) await post(u, "/api/login", { name: u });
  return { call, post, commit, search };
}

test("each repo has its own index: across repos, in one, and none of it in D1", async () => {
  const { call, post, commit, search } = await app();
  await post("ana", "/api/repos", { name: "one" });
  await post("bo", "/api/repos", { name: "two" });
  await post("bo", "/api/repos", { name: "hush", visibility: "private" });
  await commit("ana", "ana", "one", "a.ts", "const brass_tuba = 1\n");
  await commit("bo", "bo", "two", "b.ts", "// brass_tuba again\nexport {}\n");
  await commit("bo", "bo", "hush", "c.ts", "brass_tuba in secret");

  // Across repos: what you can see, marked like before.
  const all = await search("ana", "q=brass_tuba");
  expect(all.map((h: any) => `${h.owner}/${h.repo}/${h.path}`).sort()).toEqual(["ana/one/a.ts", "bo/two/b.ts"]);
  expect(all[0].snippet).toContain("«brass_tuba»");
  expect((await search("bo", "q=brass_tuba")).length).toBe(3);
  // In one repo; one you can't read is not found.
  expect(await search("ana", "q=brass_tuba&repo=bo/two")).toEqual([{ owner: "bo", repo: "two", path: "b.ts", snippet: expect.stringContaining("brass_tuba") }]);
  expect((await call("ana", "/api/search?q=brass_tuba&repo=bo/hush")).status).toBe(404);
  expect(await search("ana", "q=")).toEqual([]);

  // D1 keeps one row per repo, its sizes; no text.
  const row: any = await call.env.DB.prepare("SELECT * FROM repo_search WHERE owner = 'bo' AND repo = 'two'").first();
  expect(row).toMatchObject({ files: 1, text_bytes: 30, big_path: "b.ts", big_lines: 3 });
  expect(row.size_bytes).toBeGreaterThan(0);
  expect(await call.env.DB.prepare("SELECT COUNT(*) AS n FROM file_search").first()).toEqual({ n: 0 });

  // A new commit replaces the file's text.
  await post("ana", "/api/repos/ana/one/do/ops?path=a.ts", { ops: [{ kind: "set", line: "L1", base: 1, text: "const quiet_flute = 1" }] });
  await post("ana", "/api/repos/ana/one/do/commit?path=a.ts", { message: "flute" });
  expect(await search("ana", "q=brass_tuba&repo=ana/one")).toEqual([]);
  expect((await search("ana", "q=quiet_flute")).length).toBe(1);

  // A deleted repo takes its index and its row along.
  expect((await call("bo", "/api/repos/bo/two?confirm=two", { method: "DELETE" })).status).toBe(200);
  expect((await search("bo", "q=brass_tuba")).map((h: any) => h.repo)).toEqual(["hush"]);
  expect(await call.env.DB.prepare("SELECT COUNT(*) AS n FROM repo_search WHERE owner = 'bo' AND repo = 'two'").first()).toEqual({ n: 0 });
  await post("bo", "/api/repos", { name: "two" });
  expect(await search("bo", "q=brass_tuba&repo=bo/two")).toEqual([]);
});

test("search-move takes D1's old index into the repos' own, never over a newer commit", async () => {
  const { call, post, commit, search } = await app();
  await post("ana", "/api/repos", { name: "old" });
  await commit("ana", "ana", "old", "new.ts", "fresh_kazoo");
  const db = call.env.DB;
  const put = (path: string, content: string) => db.prepare("INSERT INTO file_search (owner, repo, path, content) VALUES ('ana', 'old', ?, ?)").bind(path, content).run();
  for (let i = 0; i < 60; i++) await put(`f${i}.ts`, `old_oboe ${i}`);
  // A commit after the deploy cleared its own old row, so the move can't bring back stale text.
  await put("new.ts", "stale_kazoo");
  await post("ana", "/api/repos/ana/old/do/ops?path=new.ts", { ops: [{ kind: "set", line: "L1", base: 1, text: "fresher_kazoo" }] });
  await post("ana", "/api/repos/ana/old/do/commit?path=new.ts", {});

  expect((await post("ana", "/api/admin/scale/search-move")).status).toBe(403);
  const first = await (await post("boss", "/api/admin/scale/search-move")).json();
  expect(first).toEqual({ moved: 50, repos: 1, left: 10 });
  expect(await (await post("boss", "/api/admin/scale/search-move")).json()).toEqual({ moved: 10, repos: 1, left: 0 });
  expect((await search("ana", "q=old_oboe&repo=ana/old")).length).toBe(20);
  expect(await search("ana", "q=stale_kazoo")).toEqual([]);
  expect((await search("ana", "q=fresher_kazoo")).length).toBe(1);
  expect(await db.prepare("SELECT files FROM repo_search WHERE owner = 'ana' AND repo = 'old'").first()).toEqual({ files: 61 });
});
