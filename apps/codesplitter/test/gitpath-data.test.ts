import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot, type Call } from "../src/local.ts";
import { countLines } from "../src/gitpath-data.ts";
import { joinHistory } from "../src/gitpath-upstream.ts";
import { buildNotes, layoutGraph, readInput } from "../src/gitpath/gitpath.ts";

setDefaultTimeout(30_000);
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const post = (call: Call, path: string, body: unknown = {}, who = "ana") => call(who, path, { method: "POST", body: JSON.stringify(body) });
const get = async (call: Call, path: string, who = "ana") => (await call(who, path)).json() as Promise<any>;

describe("counting a change's lines", () => {
  test("lines added and removed, by what the two texts share", () => {
    expect(countLines("a\nb\nc", "a\nb\nc")).toEqual({ added: 0, removed: 0 });
    expect(countLines("", "a\nb")).toEqual({ added: 2, removed: 0 });
    expect(countLines("a\nb", "")).toEqual({ added: 0, removed: 2 });
    expect(countLines("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual({ added: 2, removed: 1 });
    // a moved block is a removal and an addition, and a trailing newline is not a line
    expect(countLines("x\ny\nz\n", "y\nz\nx\n")).toEqual({ added: 1, removed: 1 });
  });
});

describe("gitpath's data for a hosted repo", () => {
  test("a file's commits, with line counts, parents that fork and join, and the busiest files", async () => {
    const call = await boot();
    opened.push(call);
    await post(call, "/api/login", { name: "ana" });
    await post(call, "/api/repos", { name: "p" });
    await post(call, "/api/repos/ana/p/files", { path: "a.ts", content: "one\ntwo\nthree" });
    await post(call, "/api/repos/ana/p/files", { path: "src/b.ts", content: "b1" });
    expect((await post(call, "/api/repos/ana/p/do/commit?path=a.ts", { message: "first a" })).status).toBe(200);
    expect((await post(call, "/api/repos/ana/p/do/commit?path=src/b.ts", { message: "first b" })).status).toBe(200);
    // Git history from outside, into the test repo's own bare git: a branch forks off, main moves on, and they merge.
    const work = mkdtempSync(join(tmpdir(), "gitpath-"));
    const sh = async (cmd: string) => {
      const p = Bun.spawn(["sh", "-c", cmd], { cwd: work, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "bo", GIT_AUTHOR_EMAIL: "b@x", GIT_COMMITTER_NAME: "bo", GIT_COMMITTER_EMAIL: "b@x" } });
      expect(await p.exited).toBe(0);
    };
    await sh(`git clone -q ${call.artifacts.path("ana--p")} . && git checkout -q -b feat && printf 'one\\ntwo\\nthree\\nfour\\nfive\\n' > a.ts && git commit -qam "grow a on a branch"` +
      ` && git checkout -q main && printf 'ONE\\ntwo\\nthree\\n' > a.ts && git commit -qam "shout one" && printf 'b1\\nb2\\n' > src/b.ts && git commit -qam "grow b"` +
      ` && git merge -q --no-ff feat -m "merge feat" && git push -q origin HEAD:main`);

    const a = await get(call, "/api/repos/ana/p/gitpath?path=a.ts");
    expect(a).toMatchObject({ repo: "ana/p", branch: "main", path: "a.ts", more: false });
    // The merge isn't a commit of the file, but the two lines it joined are.
    const byMsg = Object.fromEntries(a.commits.map((c: any) => [c.subject, c]));
    expect(Object.keys(byMsg).sort()).toEqual(["first a", "grow a on a branch", "shout one"]);
    expect(byMsg["first a"]).toMatchObject({ added: 3, removed: 0, parents: [], author: "ana" });
    expect(byMsg["shout one"]).toMatchObject({ added: 1, removed: 1, parents: [byMsg["first a"].hash] });
    expect(byMsg["grow a on a branch"]).toMatchObject({ added: 2, removed: 0, author: "bo", parents: [byMsg["first a"].hash] });
    // The tip of main didn't touch the file as itself (the merge did): the nearest commit that did carries the branch's name.
    expect(a.commits.flatMap((c: any) => c.refs ?? [])).toEqual(["main"]);
    expect(Date.parse(a.commits[0].date)).toBeGreaterThan(0);

    // It is gitpath's own shape: it reads, lays out as two lines, and the hot path is a real route through them.
    const notes = buildNotes(readInput(a).histories["a.ts"]!);
    const lay = layoutGraph(notes);
    expect(notes).toHaveLength(3);
    expect(lay.lanes).toBe(2);
    expect(lay.hot.length).toBeGreaterThan(1);

    // A file in a folder, and one that isn't there.
    const b = await get(call, "/api/repos/ana/p/gitpath?path=src/b.ts");
    expect(b.commits.map((c: any) => [c.subject, c.added, c.removed])).toEqual([["grow b", 1, 0], ["first b", 1, 0]]);
    expect((await get(call, "/api/repos/ana/p/gitpath?path=nope.ts")).commits).toEqual([]);
    expect((await get(call, "/api/repos/ana/p/gitpath?path=src")).commits).toEqual([]);

    // The busiest files, by edits: the first commit is the repo's start, not an edit.
    const top = await get(call, "/api/repos/ana/p/gitpath");
    expect(top).toMatchObject({ repo: "ana/p", branch: "main", more: false });
    expect(top.files).toEqual([{ path: "a.ts", commits: 2 }, { path: "src/b.ts", commits: 2 }]);

    // The limit cuts it, and says so.
    expect((await get(call, "/api/repos/ana/p/gitpath?path=a.ts&limit=1")).more).toBe(true);
  });

  test("an empty repo has no files and no commits, and a private repo is for its crew", async () => {
    const call = await boot();
    opened.push(call);
    await post(call, "/api/login", { name: "ana" });
    await post(call, "/api/repos", { name: "empty" });
    expect(await get(call, "/api/repos/ana/empty/gitpath")).toMatchObject({ repo: "ana/empty", files: [] });
    expect(await get(call, "/api/repos/ana/empty/gitpath?path=a.ts")).toMatchObject({ repo: "ana/empty", path: "a.ts", commits: [] });
    await post(call, "/api/repos", { name: "secret", visibility: "private" });
    await post(call, "/api/repos/ana/secret/files", { path: "a.ts", content: "x" });
    expect((await post(call, "/api/repos/ana/secret/do/commit?path=a.ts", { message: "mine" })).status).toBe(200);
    expect((await call("ana", "/api/repos/ana/secret/gitpath?path=a.ts")).status).toBe(200);
    const other = await call("bob", "/api/repos/ana/secret/gitpath?path=a.ts");
    expect(other.status).toBeGreaterThanOrEqual(401);
    expect(other.status).toBeLessThanOrEqual(404);
    expect(JSON.stringify(await other.json())).not.toContain("mine");
  });
});

describe("history from before the repo was on codeSplitter", () => {
  const c = (hash: string, parents: string[], added = 1) => ({ hash, author: "a", date: "2020-01-01T00:00:00.000Z", subject: hash, added, removed: 0, parents });
  test("the import's root takes GitHub's older commits as its parents, and GitHub's counts", () => {
    const hosted = [c("new", ["root"]), c("root", [], 50)];
    const before = [c("root", ["mid"], 3), c("mid", ["old"]), c("old", [])];
    const all = joinHistory(hosted, before);
    expect(all.map((x) => x.hash)).toEqual(["new", "root", "mid", "old"]);
    expect(all[1]).toMatchObject({ parents: ["mid"], added: 3 });
  });
  test("a tarball import (a root of its own) hangs off GitHub's newest", () => {
    const all = joinHistory([c("tar", [], 9)], [c("a", ["b"]), c("b", [])]);
    expect(all.map((x) => [x.hash, x.parents])).toEqual([["tar", ["a"]], ["a", ["b"]], ["b", []]]);
  });
  test("with nothing from GitHub the hosted history is as it was", () => {
    const hosted = [c("x", [])];
    expect(joinHistory(hosted, [])).toBe(hosted);
  });
});

describe("a shared link for a repo dug from GitHub", () => {
  test("only a GitHub repo that answers without a token counts as public", async () => {
    const { upstreamIsPublic } = await import("../src/gitpath-upstream.ts");
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => new Response("{}", { status: String(u).includes("/open/") ? 200 : 404 })) as unknown as typeof fetch;
    try {
      const dug = (upstream: string) => ({ upstream, upstream_commit: "abc", branch: "main" });
      expect(await upstreamIsPublic(dug("github:open/lib"))).toBe(true);
      expect(await upstreamIsPublic(dug("github:secret/lib"))).toBe(false);
      expect(await upstreamIsPublic(null)).toBe(false);
    } finally { globalThis.fetch = real; }
  });
});
