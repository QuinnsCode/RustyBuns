import { describe, expect, test } from "bun:test";
import { apply, empty, fromText, merge, mergeWords, replay, text, type Applied, type Doc, type Pick } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { run } from "../agents.ts";
import { accounts, local, post } from "./app-kit.ts";

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

describe("merge", () => {
  const fork = (content: string) => { const main = empty(); apply(main, fromText(content), "me"); return { base: structuredClone(main), main, branch: structuredClone(main) }; };
  const land = (main: Doc, m: ReturnType<typeof merge>) => { const r = apply(main, m.ops, m.by, 0, main.rev); expect(r.ok).toBe(true); return text(main); };

  test("lines only one side touched merge cleanly, each keeping its author", () => {
    const { base, main, branch } = fork("a\nb\nc");
    apply(main, [{ kind: "set", line: "L1", base: 1, text: "A" }, { kind: "insert", after: "L3", text: "main's" }], "ana");
    apply(branch, [{ kind: "set", line: "L2", base: 2, text: "B" }, { kind: "insert", after: "L2", text: "x" }, { kind: "insert", after: "L4", text: "y" }, { kind: "delete", line: "L3", base: 3 }], "bot");
    // As prose: in code, main's line right after the one the branch deleted would be a conflict (see below).
    const m = merge(base, branch, main, {}, "bot", "notes.md");
    expect(m.conflicts).toEqual([]);
    expect(land(main, m)).toBe("A\nB\nx\ny\nmain's");
    expect(main.lines.map((l) => l.by)).toEqual(["ana", "bot", "bot", "bot", "ana"]);
  });

  test("a line both sides changed is a conflict until it's settled", () => {
    const { base, main, branch } = fork("a\nb");
    apply(main, [{ kind: "set", line: "L1", base: 1, text: "main" }, { kind: "delete", line: "L2", base: 2 }], "ana");
    apply(branch, [{ kind: "set", line: "L1", base: 1, text: "branch" }, { kind: "set", line: "L2", base: 2, text: "B" }], "bot");
    // Main deleted L2 where the branch changed it: the two lines are one stretch both reshaped.
    expect(merge(base, branch, main).conflicts).toEqual([{ line: "L1", base: "a\nb", main: "main", branch: "branch\nB" }]);
    expect(land(structuredClone(main), merge(base, branch, main, { L1: "branch" }))).toBe("branch\nB");
    expect(land(structuredClone(main), merge(base, branch, main, { L1: "main" }))).toBe("main");
  });

  test("the same change on both sides, or a line deleted on both, is no change", () => {
    const { base, main, branch } = fork("a\nb");
    for (const d of [main, branch]) apply(d, [{ kind: "set", line: "L1", base: 1, text: "A" }, { kind: "delete", line: "L2", base: 2 }], "x");
    expect(merge(base, branch, main)).toEqual({ ops: [], by: [], conflicts: [] });
  });

  // Each side edits as an agent would: plain text, diffed back to line ops.
  const sides = (content: string, onMain: string, onBranch: string) => {
    const f = fork(content);
    apply(f.main, diffToOps(f.main.lines, onMain.split("\n")), "ana");
    apply(f.branch, diffToOps(f.branch.lines, onBranch.split("\n")), "bot");
    return f;
  };
  const clean = (content: string, onMain: string, onBranch: string) => {
    const { base, main, branch } = sides(content, onMain, onBranch), m = merge(base, branch, main, {}, "bot");
    expect(m.conflicts).toEqual([]);
    return land(main, m);
  };

  test("a line moved on one side keeps the other side's edit", () => {
    expect(clean("# T\na\nb\nc", "# T\nb\na\nc", "# T\nA\nb\nc")).toBe("# T\nb\nA\nc");
    expect(clean("# T\na\nb\nc", "# T\nA\nb\nc", "# T\nb\na\nc")).toBe("# T\nb\nA\nc");
    // Moved on main, deleted on the branch: it's gone.
    expect(clean("# T\na\nb\nc", "# T\nb\na\nc", "# T\nb\nc")).toBe("# T\nb\nc");
    // Moved on both: it lands once, where main put it.
    expect(clean("# T\na\nb\nc", "# T\nb\nc\na", "# T\nb\na\nc")).toBe("# T\nb\nc\na");
  });

  test("a line both sides changed merges word by word when the edits don't touch", () => {
    expect(clean("x\n  foo(1, 2)\ny", "x\n    foo(1, 2)\ny", "x\n  foo(1, 3)\ny")).toBe("x\n    foo(1, 3)\ny");
    expect(mergeWords("let a = 1;", "const a = 1;", "let a = 2;")).toBe("const a = 2;");
    // The same words rewritten two ways is still a conflict.
    expect(mergeWords("foo(1)", "foo(2)", "foo(3)")).toBeNull();
    const { base, main, branch } = sides("x\nfoo(1)", "x\nfoo(2)", "x\nfoo(3)");
    expect(merge(base, branch, main).conflicts).toEqual([{ line: "L2", base: "foo(1)", main: "foo(2)", branch: "foo(3)" }]);
    // A rename on one side and a new use of the old name on the other: merged, it would use a name that's gone.
    expect(mergeWords("const r = f(); g(r.ok)", "const r = f(); if (r) g(r.ok)", "const t = f(); g(t.ok)")).toBeNull();
  });

  // The same edits merged as a file at `path` (from PR #244 against main).
  const at = (path: string, content: string, onMain: string, onBranch: string, resolve = {}) => {
    const { base, main, branch } = sides(content, onMain, onBranch);
    return { m: merge(base, branch, main, resolve, "bot", path), main };
  };

  test("a lockfile both changed is one whole-file conflict: keep a side, then regenerate", () => {
    const was = `{\n  "packages": {\n    "varlock": ["varlock@1.20.0"],\n  }\n}`;
    const onMain = was.replace("1.20.0", "1.21.1"), onBranch = was.replace("1.20.0", "1.22.0");
    expect(at("bun.lock", was, onMain, onBranch).m.conflicts).toEqual([{ line: "file", base: "", main: null, branch: null, whole: true }]);
    const { m, main } = at("bun.lock", was, onMain, onBranch, { file: "branch" });
    expect(land(main, m)).toBe(onBranch);
    // Only one side changed it: nothing to settle.
    expect(at("bun.lock", was, onMain, was).m.conflicts).toEqual([]);
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
    // Nobody signed up as bo yet: adding them would take the handle.
    expect((await post(call, "ana", "/api/repos/ana/r/collaborators", { name: "bo" })).status).toBe(404);
    await post(call, "bo", "/api/login", { name: "bo" });
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
    // Two lines land above it: the track follows its lines, not the numbers.
    await post(call, "ana", "/api/repos/ana/r/do/ops?path=a.js", { ops: [{ kind: "insert", after: null, text: "new" }, { kind: "insert", after: null, text: "newer" }] });
    const moved = await (await call(null, `/api/playlists/${pl.id}`)).json() as any;
    expect(moved.tracks[0].lines.map((l: any) => l.text)).toEqual(["2", "3"]);
    expect([moved.tracks[0].from_line, moved.tracks[0].to_line]).toEqual([4, 5]);
  });

  test("three agents editing one file at once converge, and the commit indexes it", async () => {
    const { doc, stats, commit } = await run(await local(), { log: () => {} });
    const t = doc.lines.map((l: any) => l.text).join("\n");
    expect(t).not.toMatch(/\bfoo\b|^var /m);
    // The linter's const-or-let needs the whole file to hold still (ifRev), so it's right.
    expect(t).toContain("let total = 0");
    expect(t).toContain('const label = "sum is"');
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
    const dir = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "cs-clone-"));
    const p = Bun.spawn(["sh", "-c", clone], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    expect(await p.exited).toBe(0);
    expect(await Bun.file(`${dir}/dig/README`).text()).toBe("found it\n");
    (await import("node:fs")).rmSync(dir, { recursive: true, force: true });
  });

  test("a share link is a clone command with a read token that lasts as long as asked, a week at most", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "dig" });
    await post(call, "ana", "/api/repos/ana/dig/files", { path: "README", content: "found it" });
    await post(call, "ana", "/api/repos/ana/dig/do/commit?path=README", { message: "first" });
    const day = await (await call(null, "/api/repos/ana/dig/share")).json() as any;
    expect(day.ttl).toBe(86400);
    expect(day.command).toMatch(/^git clone http\S+ dig$/);
    const week = await (await call(null, "/api/repos/ana/dig/share?ttl=99999999&branch=main")).json() as any;
    expect(week.ttl).toBe(7 * 86400);
    expect(week.command).toMatch(/^git clone -b main /);
    expect((await call(null, "/api/repos/ana/dig/share?branch=--upload-pack=x")).status).toBe(400);
  });

  test("on a private repo a crew member's share link lasts an hour at most, the owner's a week", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "bo", "/api/login", { name: "bo" });
    await post(call, "ana", "/api/repos", { name: "dig" });
    await post(call, "ana", "/api/repos/ana/dig/files", { path: "README", content: "found it" });
    await post(call, "ana", "/api/repos/ana/dig/do/commit?path=README", { message: "first" });
    await call("ana", "/api/repos/ana/dig", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: "private" }) });
    await post(call, "ana", "/api/repos/ana/dig/collaborators", { name: "bo" });
    const crew = await (await call("bo", "/api/repos/ana/dig/share?ttl=99999999")).json() as any;
    expect(crew.ttl).toBe(3600);
    expect((await (await call("bo", "/api/repos/ana/dig/share")).json() as any).ttl).toBe(3600);
    expect((await (await call("ana", "/api/repos/ana/dig/share?ttl=99999999")).json() as any).ttl).toBe(7 * 86400);
  });
});

describe("levels", () => {
  test("an import Artifacts refuses is kept as failed, with its reason, not left looking buried", async () => {
    const call = await local();
    call.artifacts.import = async () => { throw new Error("The repository exceeds the size limit."); };
    await post(call, "ana", "/api/login", { name: "ana" });
    // It's dug off the queue: the answer comes at once, the reason once the dig gives up.
    expect((await post(call, "ana", "/api/levels/bun/import", {})).status).toBe(202);
    let bun: any;
    for (let i = 0; i < 200 && bun?.status !== "failed"; i++, await Bun.sleep(25)) bun = (await (await call(null, "/api/levels")).json() as any[]).find((l) => l.slug === "bun");
    expect([bun.status, bun.error]).toEqual(["failed", "The repository exceeds the size limit."]);
  });

  test("browse a level, fork it, open a deep file, catalogue it: the push keeps every other file", async () => {
    const call = await local();
    // Stand in for an import (which needs the network): a repo with a few files, marked ready.
    const ns = call.artifacts, { push } = await import("../src/git.ts");
    const made = await ns.create("level-hono");
    await push(made.remote, made.token, { changes: { "README.md": "hono\n", "src/a.ts": "export const a = 1\n", "src/deep/b.ts": "b\n" }, message: "upstream", author: "upstream" });
    await call.env.DB.prepare("INSERT INTO levels (slug, status) VALUES ('hono', 'ready')").run();

    const levels = await (await call(null, "/api/levels")).json() as any[];
    expect(levels.map((l) => l.slug).slice(0, 7)).toEqual(["mitt", "clsx", "ky", "zustand", "hono", "express", "preact"]);
    expect(levels.map((l) => l.slug)).toContain("workerd");
    expect(levels.at(-1).slug).toBe("bun");
    expect(levels[4].status).toBe("ready");
    expect(levels[6].status).toBe("buried");
    const root = await (await call(null, "/api/levels/hono/tree")).json() as any;
    expect(root.entries.map((e: any) => [e.name, e.type])).toEqual([["src", "dir"], ["README.md", "file"]]);
    expect((await (await call(null, "/api/levels/hono/tree?path=src")).json() as any).entries.map((e: any) => e.path)).toEqual(["src/deep", "src/a.ts"]);
    expect((await (await call(null, "/api/levels/hono/file?path=src/a.ts")).json() as any).text).toBe("export const a = 1\n");
    expect((await call(null, "/api/levels/preact/tree")).status).toBe(409);             // not excavated yet
    expect((await post(call, null, "/api/levels/preact/import", {})).status).toBe(403);   // and not by strangers

    await post(call, "ana", "/api/login", { name: "ana" });
    expect((await post(call, "ana", "/api/levels/hono/fork", { name: "my-hono" })).status).toBe(201);
    // The fork says where it came from and that its git is local.
    const meta = await (await call("ana", "/api/repos/ana/my-hono")).json() as any;
    expect([meta.upstream, meta.upstream_commit?.length, meta.home]).toEqual(["github:honojs/hono", 40, "local"]);
    const tree = await (await call("ana", "/api/repos/ana/my-hono/tree?path=src/deep")).json() as any;
    expect(tree.entries.map((e: any) => e.path)).toEqual(["src/deep/b.ts"]);

    // Opening a file from history makes it a live DO, attributed to upstream.
    const f = "/api/repos/ana/my-hono/do", q = "?path=" + encodeURIComponent("src/deep/b.ts");
    const doc = await (await call("ana", `${f}/file${q}`)).json() as any;
    expect(doc.lines.map((l: any) => [l.text, l.by])).toEqual([["b", "upstream"]]);
    await post(call, "ana", `${f}/ops${q}`, { ops: [{ kind: "set", line: doc.lines[0].id, base: doc.lines[0].rev, text: "B, dug up" }] });
    const c = await (await post(call, "ana", `${f}/commit${q}`, { message: "dig" })).json() as any;
    expect(c.git.commit).toMatch(/^[0-9a-f]{40}$/);

    const repo = await ns.get("ana--my-hono");
    expect((await repo.log()).map((x) => x.message)).toEqual(["dig", "upstream"]);
    expect(await (await repo.readFile({ ref: "main", path: "src/deep/b.ts" }))!.text()).toBe("B, dug up\n");
    expect(await (await repo.readFile({ ref: "main", path: "src/a.ts" }))!.text()).toBe("export const a = 1\n");
    expect(await (await repo.readFile({ ref: "main", path: "README.md" }))!.text()).toBe("hono\n");
    // The level itself is untouched.
    expect((await (await ns.get("level-hono")).log()).length).toBe(1);
  });
});

describe("accounts", () => {

  test("with a secret set, Better Auth signs people up, then they pick the handle the app sees", async () => {
    const { call, signup, session, claim } = await accounts();
    expect(await session()).toEqual({ mode: "accounts", user: null, providers: ["email"] });
    expect((await post(call, null, "/api/login", { name: "ana" })).status).toBe(404);   // no aliases now

    const cookie = await signup("ana@example.com", "Ana Lyst");
    // Signed in, no handle yet: the page is offered a free one to start from.
    expect(await session(cookie)).toMatchObject({ user: null, pick: { suggest: "ana-lyst", email: "ana@example.com" } });
    expect((await call(null, "/api/repos", { method: "POST", headers: { cookie }, body: JSON.stringify({ name: "dig" }) })).status).toBe(401);
    expect((await claim(cookie, "analyst")).status).toBe(201);
    expect((await session(cookie)).user).toBe("analyst");
    expect((await session(cookie)).pick).toBeUndefined();
    expect((await claim(cookie, "another-one")).status).toBe(409);                        // once, for good
    const me = await (await call(null, "/api/me", { headers: { cookie } })).json() as any;
    expect(me.name).toBe("analyst");
    expect((await call(null, "/api/repos", { method: "POST", headers: { cookie }, body: JSON.stringify({ name: "dig" }) })).status).toBe(201);
  });
});

describe("ADMIN_EMAIL", () => {
  /** The app with ADMIN_EMAIL set, and a signup whose email can be marked verified (as GitHub, Google or a mailed link would). */
  async function site() {
    const a = await accounts({ ADMINS: "quinn,boss-person", ADMIN_EMAIL: " Quinn@Example.com " });
    const db = a.call.env.DB;
    const authId = async (email: string) => (await db.prepare(`SELECT id FROM "user" WHERE email = ?`).bind(email).first())!.id as string;
    const signup = async (email: string, verified: boolean) => {
      const cookie = await a.signup(email, "Quinn");
      if (verified) await db.prepare(`UPDATE "user" SET "emailVerified" = 1 WHERE email = ?`).bind(email).run();
      return cookie;
    };
    const quinnRow = () => db.prepare("SELECT auth_id FROM users WHERE name = 'quinn'").first();
    return { ...a, db, authId, signup, quinnRow };
  }

  test("a verified ADMIN_EMAIL gets the first ADMINS handle, short as it is, on first sight", async () => {
    const { session, signup, authId, quinnRow } = await site();
    const cookie = await signup("quinn@example.com", true);
    expect(await session(cookie)).toMatchObject({ user: "quinn", admin: true });
    expect(await quinnRow()).toEqual({ auth_id: await authId("quinn@example.com") });
    expect((await session(cookie)).user).toBe("quinn");                                   // and keeps it
  });

  test("an unverified email that matches ADMIN_EMAIL gets nothing", async () => {
    const { session, signup, quinnRow } = await site();
    const cookie = await signup("quinn@example.com", false);
    const s = await session(cookie);
    expect(s.user).toBeNull();
    expect(s).not.toHaveProperty("admin");
    expect(await quinnRow()).toBeNull();
  });

  test("a quinn row another account owns is left alone, and ADMIN_EMAIL gets no handle", async () => {
    const { db, session, signup, quinnRow } = await site();
    await db.prepare("INSERT INTO users (name, auth_id) VALUES ('quinn', 'someone-else')").run();
    const cookie = await signup("quinn@example.com", true);
    const s = await session(cookie);
    expect(s.user).toBeNull();
    expect(s).not.toHaveProperty("admin");
    expect(await quinnRow()).toEqual({ auth_id: "someone-else" });
  });
});

describe("account email", () => {
  /** A stand-in for the send_email binding: what was sent, and the link in the last one to `to`. */
  const outbox = () => {
    const sent: { from: unknown; to: string; subject: string; text: string; html?: string }[] = [];
    return { sent, EMAIL: { send: async (m: (typeof sent)[number]) => { sent.push(m); return { messageId: String(sent.length) }; } },
      link: (to: string) => { const m = sent.findLast((s) => s.to === to)!; const u = new URL(/https?:\/\/\S+/.exec(m.text)![0]); return u.pathname + u.search; } };
  };
  const cookies = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

  test("signup mails a verification link; opening it verifies the email, so a grant lands", async () => {
    const box = outbox();
    const { call, signup, session, person } = await accounts({ ADMINS: "boss-person", EMAIL: box.EMAIL, EMAIL_FROM: "accounts@example.com" });
    const boss = await person("boss@example.com", "boss-person");
    await call(null, "/api/admin/handles", { method: "POST", headers: { cookie: boss }, body: JSON.stringify({ handle: "zed", email: "zed@example.com" }) });

    const res = await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://codesplitter.local" },
      body: JSON.stringify({ email: "zed@example.com", password: "correct horse battery", name: "Zed", callbackURL: "/?verified=1" }) });
    const zed = cookies(res);
    expect(box.sent.at(-1)).toMatchObject({ to: "zed@example.com", from: { email: "accounts@example.com", name: "codeSplitter" }, subject: "Verify your codeSplitter email" });
    expect(await session(zed)).toMatchObject({ mail: true, unverified: "zed@example.com", user: null });   // typed, so no grant yet

    const opened = await call(null, box.link("zed@example.com"), { headers: { cookie: zed } });
    expect(opened.status).toBe(302);
    expect(new URL(opened.headers.get("location")!, "http://codesplitter.local").search).toBe("?verified=1");
    const after = await session(zed);
    expect(after.user).toBe("zed");
    expect(after).not.toHaveProperty("unverified");

    // A bad link goes back with an error, not a verification.
    const bad = await call(null, "/api/auth/verify-email?token=nope&callbackURL=%2F%3Fverified%3D1");
    expect(bad.headers.get("location")).toContain("error=");
  });

  test("a forgotten password: a link by email, a new password, and the old sessions signed out", async () => {
    const box = outbox();
    const { call, signup, session } = await accounts({ EMAIL: box.EMAIL, EMAIL_FROM: "accounts@example.com" });
    const ana = await signup("ana@example.com", "Ana Lyst");
    const ask = (email: string) => call(null, "/api/auth/request-password-reset", { method: "POST", headers: { "content-type": "application/json", origin: "http://codesplitter.local" },
      body: JSON.stringify({ email, redirectTo: "/?reset=1" }) });
    // The same answer for an address with no account, and nothing sent.
    const before = box.sent.length;
    expect((await ask("nobody@example.com")).status).toBe(200);
    expect(box.sent.length).toBe(before);
    expect((await ask("ana@example.com")).status).toBe(200);
    expect(box.sent.at(-1)!.subject).toBe("Reset your codeSplitter password");

    // The link hands the page a token, which sets the new password.
    const opened = await call(null, box.link("ana@example.com"));
    const back = new URL(opened.headers.get("location")!, "http://codesplitter.local");
    expect(back.searchParams.get("reset")).toBe("1");
    const token = back.searchParams.get("token")!;
    const json = { "content-type": "application/json", origin: "http://codesplitter.local" };
    expect((await call(null, "/api/auth/reset-password", { method: "POST", headers: json, body: JSON.stringify({ newPassword: "a brand new one", token }) })).status).toBe(200);
    expect((await call(null, "/api/auth/reset-password", { method: "POST", headers: json, body: JSON.stringify({ newPassword: "again and again", token }) })).status).toBe(400);   // once
    expect((await session(ana)).pick).toBeUndefined();                                   // signed out
    const signin = (password: string) => call(null, "/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email: "ana@example.com", password }) });
    expect((await signin("correct horse battery")).status).toBe(401);
    expect((await signin("a brand new one")).status).toBe(200);
  });

});

describe("handles", () => {
  test("six or more characters, free, and not an agent's; an admin gives out short ones by email", async () => {
    const { call, signup, session, claim, person } = await accounts({ ADMINS: "boss-person" });
    const free = async (name: string) => (await (await call(null, `/api/handle?name=${name}`)).json()) as any;
    const boss = await person("boss@example.com", "boss-person");
    expect(await session(boss)).toMatchObject({ user: "boss-person", admin: true });

    const ana = await signup("ana@example.com", "Ana");
    expect((await session(ana)).pick.suggest).toBe("ana-digger");                        // too short to offer
    expect((await claim(ana, "ana")).status).toBe(400);
    expect(await free("ana")).toEqual({ name: "ana", ok: false, why: "at least 6 characters" });
    expect(await free("boss-person")).toMatchObject({ ok: false, why: "taken" });
    expect((await claim(ana, "boss-person")).status).toBe(409);
    expect((await claim(ana, "Ana_Bee")).status).toBe(400);
    expect(await free("agent-codex")).toMatchObject({ ok: false, why: "agent- handles are for coding agents" });
    expect(await free("anabee")).toMatchObject({ ok: true });
    expect((await claim(ana, "anabee")).status).toBe(201);

    const grant = (cookie: string, body: unknown) => call(null, "/api/admin/handles", { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
    expect((await grant(ana, { handle: "zed", email: "zed@example.com" })).status).toBe(403);   // admins only
    expect((await grant(boss, { handle: "boss-person", email: "x@example.com" })).status).toBe(409);
    expect((await grant(boss, { handle: "agent-codex", email: "y@example.com" })).status).toBe(400);
    // A grant goes to a verified email only, since anyone can type one at signup.
    const typed = await signup("zed2@example.com", "Zed");
    const verified = await signup("zed3@example.com", "Zed");
    expect((await grant(boss, { handle: "zed", email: "zed3@example.com" })).status).toBe(201);
    expect(await free("zed")).toMatchObject({ ok: false });
    await call.env.DB.prepare(`UPDATE "user" SET emailVerified = 1 WHERE email = 'zed3@example.com'`).run();
    expect((await session(typed)).user).toBeNull();
    expect((await session(verified)).user).toBe("zed");

    const alias = await local();
    expect((await post(alias, null, "/api/login", { name: "agent-codex" })).status).toBe(400);
  });
});

describe("rate limits", () => {
  const ip = { "cf-connecting-ip": "203.0.113.7" };

  test("count requests from the internet, per IP before sign-in and per handle after", async () => {
    const { call, signup, claim, person } = await accounts({ ADMINS: "boss-person" });
    const boss = await person("boss@example.com", "boss-person");
    // Five accounts an hour from one IP; the desktop and the tests (no cf-connecting-ip) are never counted.
    for (let i = 0; i < 5; i++) await signup(`u${i}@example.com`, `User ${i}`, ip);
    const sixth = await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://codesplitter.local", ...ip },
      body: JSON.stringify({ email: "u6@example.com", password: "correct horse battery", name: "u6" }) });
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call(null, "/api/search?q=x", { headers: ip })).status).toBe(200);

    // An admin turns the repo limit down to one a day.
    const put = (cookie: string, rules: unknown) => call(null, "/api/admin/limits", { method: "PUT", headers: { cookie }, body: JSON.stringify({ rules }) });
    const ana = await person("ana@example.com", "ana-lyst");
    expect((await put(ana, [])).status).toBe(403);
    expect((await put(boss, [{ name: "repo", max: 0, window_s: 60, enabled: true }])).status).toBe(400);
    expect((await put(boss, [{ name: "repo", max: 1, window_s: 86400, enabled: true }])).status).toBe(200);
    const repo = (cookie: string, name: string) => call(null, "/api/repos", { method: "POST", headers: { cookie, ...ip }, body: JSON.stringify({ name }) });
    expect((await repo(ana, "one")).status).toBe(201);
    const over = await repo(ana, "two");
    expect(over.status).toBe(429);
    expect(((await over.json()) as any).error).toMatch(/new repos is limited to 1 per day/);
    expect((await repo(boss, "one")).status).toBe(201);                                  // admins aren't limited
    expect((await repo(boss, "two")).status).toBe(201);

    const { rules } = (await (await call(null, "/api/admin/limits", { headers: { cookie: boss } })).json()) as any;
    expect(rules.find((r: any) => r.name === "repo")).toMatchObject({ max: 1, now: { callers: 1, hits: 2, blocked: 1 } });
    expect(rules.find((r: any) => r.name === "signup")).toMatchObject({ max: 5, now: { callers: 1, hits: 6, blocked: 1 } });
    // And what callers actually got: one caller-window, at 2 against a cap of 1.
    expect(rules.find((r: any) => r.name === "repo").spread).toMatchObject({ windows: 1, low: 2, p50: 2, p99: 2, worst: 2, over: 1 });
    expect(rules.find((r: any) => r.name === "agent").spread).toBeNull();

    // Switched off, it counts nothing.
    await put(boss, [{ name: "repo", max: 1, window_s: 86400, enabled: false }]);
    expect((await repo(ana, "three")).status).toBe(201);
    expect((await claim(ana, "nope-nope", ip)).status).toBe(409);
  });

  test("over a limit that queues: a place in line, then the dig runs once there's room", async () => {
    const call = await local({ GH_CLI: "off", ADMINS: "boss" });
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      const m = /^\/repos\/([^/]+\/[^/]+)(\/commits\/main)?$/.exec(new URL(u).pathname);
      if (new URL(u).pathname.endsWith(".git/info/refs")) return new Response(`${"c".repeat(40)} HEAD\0side-band symref=HEAD:refs/heads/main\n`);
      if (m && m[2]) return Response.json({ sha: "c".repeat(40) });
      if (m) return Response.json({ full_name: m[1], private: false, default_branch: "main" });
      return new Response("{}", { status: 404 });
    }) as any;
    call.artifacts.import = (async (params: any) => call.artifacts.create(params.target.name, { setDefaultBranch: "main" })) as any;
    try {
      for (const u of ["ana", "bo", "boss"]) await post(call, u, "/api/login", { name: u });
      const put = (rules: unknown) => call("boss", "/api/admin/limits", { method: "PUT", body: JSON.stringify({ rules }) });
      const dig = (repo: string) => call("ana", "/api/github/dig", { method: "POST", headers: ip, body: JSON.stringify({ repo }) });
      const job = async (id: number, user = "ana") => (await (await call(user, `/api/jobs/${id}`)).json()) as any;
      const reset = () => call("boss", "/api/admin/limits/reset", { method: "POST", body: JSON.stringify({ who: "@ana", rule: "dig" }) });

      // Only slow, costly jobs can queue.
      expect((await put([{ name: "repo", max: 1, window_s: 86400, enabled: true, on_fail: "queue" }])).status).toBe(400);
      const { rules } = (await (await call("boss", "/api/admin/limits")).json()) as any;
      expect(rules.filter((r: any) => r.queueable).map((r: any) => r.name)).toEqual(["dig", "preview", "doctor"]);
      expect((await put([{ name: "dig", max: 1, window_s: 86400, enabled: true, on_fail: "queue" }])).status).toBe(200);

      // Over the cap: a 202 and a place in line, which holds one window's worth.
      expect((await dig("o/one")).status).toBe(201);
      const second = await dig("o/two");
      expect(second.status).toBe(202);
      const { queued } = (await second.json()) as any;
      expect(queued).toMatchObject({ state: "waiting", place: 1, label: "Dig up a repo" });
      expect(queued.eta).toBeGreaterThan(Date.now());
      expect((await dig("o/three")).status).toBe(429);
      expect((await (await call("boss", "/api/admin/limits")).json() as any).events.map((e: any) => e.action)).toEqual(["queue"]);

      // Polling with no room leaves it waiting; it's hers alone to see.
      expect(await job(queued.id)).toMatchObject({ state: "waiting", place: 1 });
      expect((await call("bo", `/api/jobs/${queued.id}`)).status).toBe(404);
      expect((await call("ana", "/api/repos/ana/two")).status).toBe(404);

      // Room again (an admin's reset, or the window ending): the next poll runs it, as her, taking a slot.
      await reset();
      expect(await job(queued.id)).toMatchObject({ state: "done", status: 201, result: { owner: "ana", name: "two" } });
      expect((await call("ana", "/api/repos/ana/two")).status).toBe(200);
      expect((await call.env.DB.prepare("SELECT count FROM limit_hits WHERE rule = 'dig' AND who = '@ana'").first() as any).count).toBe(1);

      // Nobody polling: its message on the JOBS queue runs it when its window ends (held back 12 hours at most).
      const four = ((await (await dig("o/four")).json()) as any).queued;
      await call.env.JOBS.drain();
      expect(await job(four.id, "boss")).toMatchObject({ state: "waiting" });
      await reset();
      await call.env.JOBS.drain(Date.now() + 12 * 3600_000 + 60_000);
      expect(await job(four.id, "boss")).toMatchObject({ state: "done", status: 201 });
      expect(call.env.JOBS.size()).toBe(0);

      // Back on the page later: her own jobs, newest first, with their place or the repo they made.
      const list = async (user: string | null) => ((await (await call(user, "/api/jobs")).json()) as any).jobs;
      expect((await call(null, "/api/jobs")).status).toBe(401);
      await dig("o/five");
      expect(await list("bo")).toEqual([]);
      let jobs = await list("ana");
      expect(jobs.map((j: any) => [j.what, j.state])).toEqual([["o/five", "waiting"], ["o/four", "done"], ["o/two", "done"]]);
      expect(jobs[0]).toMatchObject({ place: 1, label: "Dig up a repo" });
      expect(jobs[1]).toMatchObject({ status: 201, result: { owner: "ana", name: "four" } });
      // Listing runs what's due, like polling one job does; a job that failed shows why.
      await reset();
      expect((await list("ana"))[0]).toMatchObject({ what: "o/five", state: "done", result: { owner: "ana", name: "five" } });
      const fork = await call("ana", "/api/levels/no-such-level/fork", { method: "POST", headers: ip, body: JSON.stringify({ name: "x" }) });
      expect(fork.status).toBe(202);
      await reset();
      jobs = await list("ana");
      expect(jobs[0]).toMatchObject({ what: "fork of no-such-level", state: "done", result: { error: expect.any(String) } });
      expect(jobs[0].status).toBeGreaterThanOrEqual(400);
    } finally { globalThis.fetch = real; }
  });

  test("every edit over the socket gets an answer, even when something breaks on the way (#659)", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a", content: "x" });
    // From the internet, so its edits are counted, and the count reads D1.
    const ws = ((await call("ana", "/api/repos/ana/r/do/ws?path=a", { headers: { upgrade: "websocket", ...ip } })) as any).webSocket, got: any[] = [];
    ws.toBrowser = (d: string) => got.push(JSON.parse(d));
    ws.queue.splice(0);
    const edit = async (id: number, ops: unknown) => {
      ws.onMessage(JSON.stringify({ type: "ops", id, ops }));
      for (const end = performance.now() + 15_000; performance.now() < end;) { const a = got.find((m) => m.id === id); if (a) return a; await Bun.sleep(5); }
    };
    // An op the file can't read is a nack saying why, not silence.
    expect(await edit(1, [null])).toMatchObject({ type: "nack", error: "ops[0]: an object" });
    // D1 down under the edit limit: the edit still lands.
    const prepare = call.env.DB.prepare.bind(call.env.DB);
    call.env.DB.prepare = (sql: string) => { if (/limit_rules/.test(sql)) throw new Error("D1 is down"); return prepare(sql); };
    try {
      expect(await edit(2, [{ kind: "insert", after: null, text: "still lands" }])).toMatchObject({ type: "ack", rev: 2 });
    } finally { call.env.DB.prepare = prepare; }
    expect((await (await call("ana", "/api/repos/ana/r/do/file?path=a")).json() as any).lines.map((l: any) => l.text)).toEqual(["still lands", "x"]);
    // A window of the lines, with the total; no window, the whole file.
    const page = await (await call("ana", "/api/repos/ana/r/do/file?path=a&from=1&limit=1")).json() as any;
    expect(page).toMatchObject({ total: 2, from: 1 });
    expect(page.lines.map((l: any) => l.text)).toEqual(["x"]);
    expect((await (await call("ana", "/api/repos/ana/r/do/file?path=a")).json() as any).total).toBeUndefined();
  });
});
