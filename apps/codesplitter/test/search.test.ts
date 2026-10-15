import { expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "./app-kit.ts";

// Search, one index per repo (search.ts): end to end, in-process.
setDefaultTimeout(30_000);

async function app() {
  const call = await boot({ GH_CLI: "off", ADMINS: "boss" });
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
