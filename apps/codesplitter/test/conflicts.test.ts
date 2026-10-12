import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apply, empty, explain, fromText, merge, mergeWords, text, type Doc, type Resolve } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { markers, settled } from "../src/conflict-agent.ts";
import { parseResolve } from "../src/branches.ts";
import { local as boot } from "../src/local.ts";
import type { Exec } from "../src/agent-run.ts";

// End to end (in-process D1 and file DOs): fine alone, slow on a busy machine.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** Main and the branch each edit `content` as an agent would, as plain text diffed to line ops. */
function sides(content: string, onMain: string, onBranch: string) {
  const main = empty();
  apply(main, fromText(content), "me");
  const base = structuredClone(main), branch = structuredClone(main);
  apply(main, diffToOps(main.lines, onMain.split("\n")), "ana");
  apply(branch, diffToOps(branch.lines, onBranch.split("\n")), "bot");
  return { base, main, branch };
}
const settle = (s: ReturnType<typeof sides>, resolve: Resolve, path = "") => {
  const main = structuredClone(s.main), m = merge(s.base, s.branch, main, resolve, "bot", path, "ryan");
  expect(m.conflicts).toEqual([]);
  expect(apply(main, m.ops, m.by, 0, main.rev).ok).toBe(true);
  return main;
};
const conflicts = (s: ReturnType<typeof sides>, path = "") => merge(s.base, s.branch, s.main, {}, "bot", path).conflicts;

describe("settling a conflict", () => {
  test("one line both changed: main's, the branch's, both either way round, or a text of the merger's", () => {
    const s = sides("a\nfoo(1)\nb", "a\nfoo(2)\nb", "a\nfoo(3)\nb");
    expect(conflicts(s)).toEqual([{ line: "L2", base: "foo(1)", main: "foo(2)", branch: "foo(3)" }]);
    expect(text(settle(s, { L2: "main" }))).toBe("a\nfoo(2)\nb");
    expect(text(settle(s, { L2: "branch" }))).toBe("a\nfoo(3)\nb");
    expect(text(settle(s, { L2: "both" }))).toBe("a\nfoo(2)\nfoo(3)\nb");
    expect(text(settle(s, { L2: "both:branch-first" }))).toBe("a\nfoo(3)\nfoo(2)\nb");
    const own = settle(s, { L2: { text: "foo(2, 3)\n// both" } });
    expect(text(own)).toBe("a\nfoo(2, 3)\n// both\nb");
    // Each line keeps who wrote it: both sides' own lines, the text the merger's.
    expect(settle(s, { L2: "both" }).lines.map((l) => l.by)).toEqual(["me", "ana", "bot", "me"]);
    expect(settle(s, { L2: "both:branch-first" }).lines.map((l) => l.by)).toEqual(["me", "bot", "ana", "me"]);
    expect(own.lines.map((l) => l.by)).toEqual(["me", "ryan", "ryan", "me"]);
  });

  test("keeping both, the branch's new lines stay with its version of the line", () => {
    // A line added next to one both changed makes it one stretch: the branch's side is `X` and `new`.
    const s = sides("a\nb", "A\nb", "X\nnew\nb");
    expect(text(settle(s, { L1: "both" }))).toBe("A\nX\nnew\nb");
    expect(text(settle(s, { L1: "both:branch-first" }))).toBe("X\nnew\nA\nb");
  });

  test("a stretch both reshaped: both keeps each side's lines whole, a text replaces it", () => {
    const main = empty();
    apply(main, fromText("a\nb\nc"), "me");
    const base = structuredClone(main), branch = structuredClone(main);
    apply(main, [{ kind: "set", line: "L1", base: 1, text: "main" }, { kind: "delete", line: "L2", base: 2 }], "ana");
    apply(branch, [{ kind: "set", line: "L1", base: 1, text: "branch" }, { kind: "set", line: "L2", base: 2, text: "B" }], "bot");
    const s = { base, main, branch };
    expect(conflicts(s)).toEqual([{ line: "L1", base: "a\nb", main: "main", branch: "branch\nB" }]);
    expect(text(settle(s, { L1: "both" }))).toBe("main\nbranch\nB\nc");
    expect(text(settle(s, { L1: "both:branch-first" }))).toBe("branch\nB\nmain\nc");
    expect(text(settle(s, { L1: { text: "one\ntwo" } }))).toBe("one\ntwo\nc");
  });

  test("a line the branch deleted and main changed: a text goes in its place, both keeps main's", () => {
    const s = sides("a\nb\nc", "a\nB\nc", "a\nc");
    // As prose: in code, deleting next to a changed line is a stretch both reshaped.
    expect(conflicts(s, "n.md")).toEqual([{ line: "L2", base: "b", main: "B", branch: null }]);
    expect(text(settle(s, { L2: "both" }, "n.md"))).toBe("a\nB\nc");
    expect(text(settle(s, { L2: { text: "b, mended" } }, "n.md"))).toBe("a\nb, mended\nc");
  });

  test("a line added on both sides apart: as the branch it lands twice, as a text it lands as that", () => {
    const line = "export const answer = 42;";
    const s = sides("a\nb\nc", `${line}\na\nb\nc`, `a\nb\nc\n${line}`);
    expect(conflicts(s)).toEqual([{ line: "L4", base: "", main: line, branch: line, doubled: true }]);
    expect(text(settle(s, { L4: "main" }))).toBe(`${line}\na\nb\nc`);
    expect(text(settle(s, { L4: "both" }))).toBe(`${line}\na\nb\nc\n${line}`);
    expect(text(settle(s, { L4: { text: "export const answer2 = 42;" } }))).toBe(`${line}\na\nb\nc\nexport const answer2 = 42;`);
  });

  test("a lockfile, or code that won't build, only takes a side: both or a text leaves it a conflict", () => {
    const s = sides("lock 1", "lock 2", "lock 3");
    expect(conflicts(s, "bun.lock")).toMatchObject([{ line: "file", whole: true }]);
    expect(merge(s.base, s.branch, s.main, { file: "both" }, "bot", "bun.lock").conflicts).toMatchObject([{ whole: true }]);
    expect(merge(s.base, s.branch, s.main, { file: { text: "x" } }, "bot", "bun.lock").conflicts).toMatchObject([{ whole: true }]);
    expect(text(settle(s, { file: "branch" }, "bun.lock"))).toBe("lock 3");
  });
});

describe("what the review says about each conflict", () => {
  // The one from #620: both added a word after `triage`, git conflicted, and so did the word merge.
  const pre = "  writeFileSync(stamp, `${tag} ${skin} lucide live clock mem pulls checks ";
  const base = pre + "triage\\n`);", vale = pre + "triage vale\\n`);", cs = pre + "triage codesplitter\\n`);";

  test("words both added at one spot still conflict, but come back as a suggestion keeping both, main's first", () => {
    expect(mergeWords(base, vale, cs)).toBeNull();
    expect(mergeWords(base, vale, cs, true)).toBe(pre + "triage vale codesplitter\\n`);");
    // Two rewrites of the same word aren't two inserts: no suggestion.
    expect(mergeWords("foo(1)", "foo(2)", "foo(3)", true)).toBeNull();
    const c = conflicts(sides(`x\n${base}\ny`, `x\n${vale}\ny`, `x\n${cs}\ny`))[0]!;
    expect(explain(c)).toEqual({ ...c, choices: ["main", "branch", "both", "both:branch-first", "text"], suggestion: pre + "triage vale codesplitter\\n`);" });
  });

  test("each kind lists the picks it takes", () => {
    expect(explain({ line: "file", base: "", main: null, branch: null, whole: true }).choices).toEqual(["main", "branch"]);
    expect(explain({ line: "lint:x", base: "", main: null, branch: null, lint: "nope" }).choices).toEqual(["main", "branch"]);
    expect(explain({ line: "key:a.b", base: "", main: "a", branch: "b" }).choices).toEqual(["main", "branch"]);
    expect(explain({ line: "L9", base: "", main: "x", branch: "x", doubled: true })).toEqual({ line: "L9", base: "", main: "x", branch: "x", doubled: true, choices: ["main", "branch", "text"] });
    // Several lines: no suggestion.
    expect(explain({ line: "L1", base: "a\nb", main: "main", branch: "branch\nB" }).suggestion).toBeUndefined();
  });

  test("resolve is checked: a pick, or a text", () => {
    expect(parseResolve(undefined)).toEqual({});
    expect(parseResolve({ "a.ts": { L1: "both", L2: { text: "x\r\ny" } } })).toEqual({ "a.ts": { L1: "both", L2: { text: "x\ny" } } });
    expect(parseResolve({ "a.ts": { L1: "mine" } })).toStartWith("resolve.a.ts.L1:");
    expect(parseResolve({ "a.ts": { L1: { text: 5 } } })).toStartWith("resolve.a.ts.L1:");
    expect(parseResolve({ "a.ts": { L1: { text: "x".repeat(20_001) } } })).toStartWith("resolve.a.ts.L1:");
    expect(parseResolve([])).toBe("resolve: {path: {line: pick}}");
  });

  test("an agent's answer: the conflict as git's markers in, the settled lines out", () => {
    expect(markers({ line: "L2", base: "foo(1)", main: "foo(2)", branch: null }))
      .toBe("<<<<<<< main\nfoo(2)\n||||||| base\nfoo(1)\n=======\n(the branch deleted it)\n>>>>>>> branch\n");
    const given = markers({ line: "L2", base: "a", main: "b", branch: "c" });
    expect(settled({ code: 0, out: "", text: "  both(b, c)\n" }, "claude", given)).toEqual({ text: "  both(b, c)" });
    expect(settled({ code: 0, out: "", text: given }, "claude", given)).toEqual({ error: "claude left the conflict as it was" });
    expect(settled({ code: 0, out: "", text: "b\n=======\nc" }, "claude", given)).toEqual({ error: "claude left git's markers in" });
    expect(settled({ code: 2, out: "rate limited", text: null }, "claude", given)).toEqual({ error: "claude exited 2: rate limited" });
  });
});

describe("over the API", () => {
  /** ana's repo r: a.ts with `x(1)` on main changed to `x(2)` and on branch b1 to `x(3)`. */
  async function app() {
    const call = await boot({ GH_CLI: "off" });
    opened.push(call);
    const post = (user: string, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
    await post("ana", "/api/login", { name: "ana" });
    await post("bob", "/api/login", { name: "bob" });
    await post("ana", "/api/repos", { name: "r" });
    await post("ana", "/api/repos/ana/r/files", { path: "a.ts", content: "const a = 1;\nx(1);" });
    await post("ana", "/api/repos/ana/r/branches", { name: "b1" });
    await post("ana", "/api/repos/ana/r/do/ops?path=a.ts&branch=b1", { ops: [{ kind: "set", line: "L2", base: 2, text: "x(3);" }] });
    await post("ana", "/api/repos/ana/r/do/ops?path=a.ts", { ops: [{ kind: "set", line: "L2", base: 2, text: "x(2);" }] });
    const file = async () => text(await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json() as Doc);
    return { call, post, file };
  }

  test("the review lists each conflict's picks; a bad pick is a 400, a text lands as the merger's", async () => {
    const { call, post, file } = await app();
    const review = await (await call("ana", "/api/repos/ana/r/branches/b1")).json() as any;
    expect(review.files[0].conflicts).toEqual([{ line: "L2", base: "x(1);", main: "x(2);", branch: "x(3);", choices: ["main", "branch", "both", "both:branch-first", "text"] }]);
    const bad = await post("ana", "/api/repos/ana/r/branches/b1/merge", { resolve: { "a.ts": { L2: "mine" } } });
    expect(bad.status).toBe(400);
    expect((await bad.json() as any).error).toContain('"both:branch-first"');
    expect((await post("ana", "/api/repos/ana/r/branches/b1/merge", { resolve: { "a.ts": { L2: { text: "x(2);\nx(3);" } } } })).status).toBe(200);
    expect(await file()).toBe("const a = 1;\nx(2);\nx(3);");
    const doc = await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json() as Doc;
    expect(doc.lines.map((l) => l.by)).toEqual(["ana", "ana", "ana"]);
  });

  test("both lands both lines, main's first", async () => {
    const { post, file } = await app();
    expect((await post("ana", "/api/repos/ana/r/branches/b1/merge", { resolve: { "a.ts": { L2: "both" } } })).status).toBe(200);
    expect(await file()).toBe("const a = 1;\nx(2);\nx(3);");
  });

  test("suggest_resolution: a coding agent writes the settled lines, and nothing lands until a merge takes them", async () => {
    const { call, post, file } = await app();
    let seen = "", prompt = "";
    call.env.AGENT_EXEC = (async (cmd, cwd) => {
      seen = readFileSync(join(cwd, "RESOLVE.ts"), "utf8");
      prompt = cmd.args.join(" ");
      writeFileSync(join(cwd, "RESOLVE.ts"), "x(2);\nx(3);\n");
      return { code: 0, out: "" };
    }) as Exec;
    const ask = (user: string, body: unknown) => post(user, "/api/repos/ana/r/branches/b1/conflicts/agent", body);
    expect((await ask("ana", { path: "a.ts", line: "L2", harness: "nope" })).status).toBe(400);
    expect((await ask("ana", { path: "a.ts", line: "L9", harness: "claude" })).status).toBe(404);
    expect((await ask("bob", { path: "a.ts", line: "L2", harness: "claude" })).status).toBe(403);
    const r = await ask("ana", { path: "a.ts", line: "L2", harness: "claude" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ path: "a.ts", line: "L2", harness: "claude", text: "x(2);\nx(3);" });
    expect(seen).toBe("<<<<<<< main\nx(2);\n||||||| base\nx(1);\n=======\nx(3);\n>>>>>>> branch\n");
    // It sees main's lines around the conflict.
    expect(prompt).toContain("const a = 1;");
    expect(await file()).toBe("const a = 1;\nx(2);");

    call.env.AGENT_EXEC = (async () => ({ code: 0, out: "" })) as Exec;
    const same = await ask("ana", { path: "a.ts", line: "L2", harness: "claude" });
    expect(same.status).toBe(502);
    expect((await same.json() as any).error).toBe("claude left the conflict as it was");
  });
});
