import { describe, expect, test } from "bun:test";
import { apply, empty, fromText, replay, text, type Applied } from "../src/lines.ts";
import { local, type Call } from "../src/local.ts";
import { run } from "../agents.ts";

const post = (call: Call, user: string | null, path: string, body: unknown) =>
  call(user, path, { method: "POST", body: JSON.stringify(body) });

describe("lines", () => {
  test("ops address lines by id, so edits elsewhere don't shift them", () => {
    const doc = empty();
    apply(doc, fromText("a\nb\nc"), "me");
    expect(apply(doc, [{ kind: "insert", after: null, text: "top" }], "x").ok).toBe(true);
    // L2 is still "b" even though everything moved down one.
    expect(apply(doc, [{ kind: "set", line: "L2", base: 2, text: "B" }], "y").ok).toBe(true);
    expect(text(doc)).toBe("top\na\nB\nc");
  });

  test("a stale base is a conflict and the batch is all-or-nothing", () => {
    const doc = empty();
    apply(doc, fromText("a\nb"), "me");
    apply(doc, [{ kind: "set", line: "L1", base: 1, text: "A" }], "x");
    const r = apply(doc, [{ kind: "set", line: "L2", base: 2, text: "B" }, { kind: "set", line: "L1", base: 1, text: "nope" }], "y");
    expect(r.ok).toBe(false);
    expect(text(doc)).toBe("A\nb");
  });

  test("replaying the log rebuilds any past rev, blame included", () => {
    const doc = empty(), log: Applied[] = [];
    const go = (r: ReturnType<typeof apply>) => { if (r.ok) log.push(...r.applied); };
    go(apply(doc, fromText("one\ntwo"), "me"));
    go(apply(doc, [{ kind: "set", line: "L1", base: 1, text: "ONE" }], "x"));
    go(apply(doc, [{ kind: "delete", line: "L2", base: 2 }], "y"));
    expect(text(replay(log, 2))).toBe("one\ntwo");
    expect(replay(log, 3).lines[0]).toEqual({ id: "L1", text: "ONE", by: "x", rev: 3 });
    expect(replay(log)).toEqual(doc);
  });
});

describe("app", () => {
  test("private repos are invisible to everyone else, in search too", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "secret", visibility: "private" });
    await post(call, "ana", "/api/repos/ana/secret/files", { path: "x.ts", content: "const hidden_tuba = 1" });
    await post(call, "ana", "/api/repos/ana/secret/do/commit?path=x.ts", {});

    expect((await call("bo", "/api/repos/ana/secret")).status).toBe(404);
    expect((await call(null, "/api/repos/ana/secret/do/file?path=x.ts")).status).toBe(404);
    expect(await (await call("bo", "/api/search?q=hidden_tuba")).json()).toEqual([]);
    expect(await (await call("ana", "/api/search?q=hidden_tuba")).json()).toHaveLength(1);
    expect((await call("bo", "/api/users/ana").then((r) => r.json()) as any).repos).toEqual([]);
  });

  test("only owners and collaborators write", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a", content: "x" });
    const op = { ops: [{ kind: "insert", after: null, text: "hi" }] };
    expect((await post(call, "bo", "/api/repos/ana/r/do/ops?path=a", op)).status).toBe(403);
    await post(call, "ana", "/api/repos/ana/r/collaborators", { name: "bo" });
    expect((await post(call, "bo", "/api/repos/ana/r/do/ops?path=a", op)).status).toBe(200);
  });

  test("a playlist track is a line range, read live from the file", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a.js", content: "1\n2\n3\n4" });
    const pl = await (await post(call, "bo", "/api/playlists", { title: "tasty" })).json() as any;
    expect((await post(call, "bo", `/api/playlists/${pl.id}/tracks`, { owner: "ana", repo: "r", path: "a.js", from: 2, to: 3, note: "nice" })).status).toBe(201);
    const got = await (await call(null, `/api/playlists/${pl.id}`)).json() as any;
    expect(got.tracks[0].lines.map((l: any) => l.text)).toEqual(["2", "3"]);
  });

  test("three agents editing one file at once converge, and the commit indexes it", async () => {
    const { doc, stats, commit } = await run(await local(), { log: () => {} });
    const t = doc.lines.map((l: any) => l.text).join("\n");
    expect(t).not.toMatch(/\bfoo\b|^var /m);
    expect(t.match(/^\/\*\*/gm)).toHaveLength(3);
    expect(commit.rev).toBe(doc.rev);
    expect(Object.values(stats).every((s) => s.edits > 0)).toBe(true);
  });
});

describe("artifacts", () => {
  test("cataloguing pushes the repo's catalogued files as a git commit you can clone", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "dig" });
    await post(call, "ana", "/api/repos/ana/dig/files", { path: "src/a.ts", content: "export const a = 1" });
    await post(call, "ana", "/api/repos/ana/dig/files", { path: "README", content: "found it" });
    const c1 = await (await post(call, "ana", "/api/repos/ana/dig/do/commit?path=src%2Fa.ts", { message: "first find" })).json() as any;
    expect(c1.git.commit).toMatch(/^[0-9a-f]{40}$/);
    const c2 = await (await post(call, "ana", "/api/repos/ana/dig/do/commit?path=README", { message: "second" })).json() as any;
    expect(c2.git.parent).toBe(c1.git.commit);

    const repo = await call.artifacts.get("ana--dig");
    expect((await repo.log()).map((c) => c.message)).toEqual(["second", "first find"]);
    expect(await (await repo.readFile({ ref: "main", path: "src/a.ts" }))!.text()).toBe("export const a = 1\n");

    // The clone command on the repo page works with a stock git client.
    const { clone } = await (await call(null, "/api/repos/ana/dig")).json() as any;
    const dir = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "gc-clone-"));
    const p = Bun.spawn(["sh", "-c", clone], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    expect(await p.exited).toBe(0);
    expect(await Bun.file(`${dir}/dig/README`).text()).toBe("found it\n");
  });
});
