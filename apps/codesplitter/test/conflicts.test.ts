import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apply, empty, explain, fromText, merge, mergeWords, parseError, text, type Doc, type Resolve } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { markers, settled } from "../src/conflict-agent.ts";
import { materializeOn, parseResolve } from "../src/branches.ts";
import { lintMerge } from "../src/lint.ts";
import { local as boot } from "../src/local.ts";
import { toFile } from "../src/archive.ts";
import type { Exec } from "../src/agent-run.ts";
import type { Tester } from "../src/deps.ts";

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

  test("words both added at one spot merge, main's first; a conflict over them comes back with that as a suggestion", () => {
    expect(mergeWords(base, vale, cs)).toBeNull();
    expect(mergeWords(base, vale, cs, true)).toBe(pre + "triage vale codesplitter\\n`);");
    // Two rewrites of the same word aren't two inserts: no suggestion.
    expect(mergeWords("foo(1)", "foo(2)", "foo(3)", true)).toBeNull();
    // The merge settles it (#933), so it's only a conflict when it comes from elsewhere.
    expect(text(settle(sides(`x\n${base}\ny`, `x\n${vale}\ny`, `x\n${cs}\ny`), {}))).toBe(`x\n${pre}triage vale codesplitter\\n\`);\ny`);
    const c = { line: "L2", base, main: vale, branch: cs };
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

// The hunks git conflicted on between main and #893 / #886 (docs/merge-solutions.md), cut down.
describe("settled without asking (#933)", () => {
  const merged = (was: string, onMain: string, onBranch: string, path = "x.ts") => text(settle(sides(was, onMain, onBranch), {}, path));

  test("an import main changed under a new one it added still word-merges with the branch's (worker.ts)", () => {
    const was = "// routes\nimport { kick, land, seeGit } from \"./mirror.ts\";";
    expect(merged(was, "// routes\nimport { beamRoutes } from \"./beam.ts\";\nimport { kick, land, seeGit, turnRoute } from \"./mirror.ts\";", "// routes\nimport { kick, land, mirrorTag, seeGit } from \"./mirror.ts\";"))
      .toBe("// routes\nimport { beamRoutes } from \"./beam.ts\";\nimport { kick, land, mirrorTag, seeGit, turnRoute } from \"./mirror.ts\";");
  });

  test("in prose and comments the rename guard skips short and common words; code keeps it whole (the README bullet)", () => {
    const was = "- **The map.** A panel opens a map of where it came from. Click a dot to revert it.";
    const onMain = "- **The vein.** The panel opens the vein, its history: where it came from. Click a dot to revert it.";
    const onBranch = "- **The map.** A panel opens a map of where it came from. A tagged commit wears a tag. Click a dot to revert it.";
    expect(mergeWords(was, onMain, onBranch)).toBeNull();
    expect(merged(was, onMain, onBranch, "README.md")).toBe("- **The vein.** The panel opens the vein, its history: where it came from. A tagged commit wears a tag. Click a dot to revert it.");
    expect(merged(`// ${was}`, `// ${onMain}`, `// ${onBranch}`)).toBe(`// ${onMain.replace("Click", "A tagged commit wears a tag. Click")}`);
    // A word that says something still trips it: main renamed `map`, the branch wrote it again.
    expect(mergeWords(was, onMain, was.replace("revert it.", "revert it on the map."), false, true)).toBeNull();
  });

  test("the same line in two new blocks isn't doubled; at the same level it still is (deps.test.ts)", () => {
    const setup = "    const pkg = JSON.parse(files[\"package.json\"]!);";
    const t = (name: string) => `test("${name}", async () => {\n  const tester = async (files) => {\n${setup}\n  };\n});`;
    expect(merged("a\nz", `a\n${t("digs")}\nz`, `a\n${t("rank")}\nz`)).toBe(`a\n${t("digs")}\n${t("rank")}\nz`);
    expect(conflicts(sides("a\nb", "import { z } from './z'\na\nb", "a\nimport { z } from './z'\nb"))).toMatchObject([{ doubled: true }]);
  });

  test("two new tests after the last one, each ending as it does, land whole: main's, then the branch's (deps.test.ts)", () => {
    // Read top-down, each side's new test could start inside the old one's tail: both slide down to the blank line under it.
    const t = (name: string) => `test("${name}", async () => {\n  ${name}();\n  await run();\n  expect(told.length).toBe(1);\n});\n`;
    const was = `import { a } from "x";\nimport { b } from "y";\n${t("chain")}\ntest("search", () => {});\n// a\n// b`;
    const onMain = `import { a, dig } from "x";\nimport { b } from "y";\n${t("chain")}\n${t("dig")}\ntest("search", () => {});\n// a, main's\n// b`;
    const onBranch = `import { a } from "x";\nimport { b, rank } from "y";\n${t("chain")}\n${t("rank")}\ntest("search", () => {});\n// a\n// b, the branch's`;
    expect(merged(was, onMain, onBranch)).toBe(`import { a, dig } from "x";\nimport { b, rank } from "y";\n${t("chain")}\n${t("dig")}\n${t("rank")}\ntest("search", () => {});\n// a, main's\n// b, the branch's`);
  });

  test("new lines both added at one spot: main's first", () => {
    expect(merged("a\nz", "a\nm1\nm2\nz", "a\nb1\nz")).toBe("a\nm1\nm2\nb1\nz");
    // A line both added lands once, where main has it.
    expect(merged("a\nz", "a\nm1\nsame\nz", "a\nsame\nb1\nz")).toBe("a\nm1\nsame\nb1\nz");
  });

  test("new lines both added to a sorted block land in order", () => {
    const imp = (...ns: string[]) => ns.map((n) => `import { ${n} } from "./${n}";`).join("\n");
    expect(merged(imp("a", "c", "e"), imp("a", "c", "d", "e"), imp("a", "b", "c", "e"))).toBe(imp("a", "b", "c", "d", "e"));
    // Main's new lines on either side of the branch's, and the branch's own run among them.
    const keys = (...ks: string[]) => `const o = {\n${ks.map((k) => `  ${k}: 1,`).join("\n")}\n};`;
    expect(merged(keys("a", "f", "k"), keys("a", "b", "d", "f", "k"), keys("a", "c", "e", "f", "k"))).toBe(keys("a", "b", "c", "d", "e", "f", "k"));
    expect(merged(keys("a", "f", "k"), keys("a", "f", "g", "k"), keys("a", "f", "h", "k"))).toBe(keys("a", "f", "g", "h", "k"));
    // Not sorted, or too short to tell: main's first.
    expect(merged(keys("f", "a", "k"), keys("f", "d", "a", "k"), keys("f", "b", "a", "k"))).toBe(keys("f", "d", "b", "a", "k"));
    expect(merged("a\nz", "a\nm\nz", "a\nb\nz")).toBe("a\nm\nb\nz");
  });

  test("items both added to one list: main's first, or in order if the list was sorted; one key added two ways is a conflict", () => {
    // The deps save body in client.html, both appended.
    const save = (x: string) => `await api(base, { on: f.on.checked, held: f.held.value${x} }, "PUT");`;
    expect(merged(save(""), save(", digs"), save(", rank"))).toBe(save(", digs, rank"));
    expect(mergeWords("import { a, c, e } from \"x\";", "import { a, c, d, e } from \"x\";", "import { a, c, b, e } from \"x\";".replace("c, b", "b, c"), true)).toBe("import { a, b, c, d, e } from \"x\";");
    expect(mergeWords("import { a, b, c } from \"x\";", "import { a, b, c, z } from \"x\";", "import { a, b, c, d } from \"x\";", true)).toBe("import { a, b, c, d, z } from \"x\";");
    // Two items is too few to call it sorted: main's first.
    expect(mergeWords("f(a, c)", "f(a, c, z)", "f(a, c, d)", true)).toBe("f(a, c, z, d)");
    // The commit graph's <g class>: a class each, at one spot, and the branch's rename further on.
    const g = (cls: string, attrs: string) => `return \`<g class="\${c.up ? "u" : "m"}${cls}" ${attrs}>\`;`;
    expect(merged(g("", "tabindex=\"0\" data-hash=\"${esc(c.hash)}\""), g("${c === tip ? \" tip\" : \"\"}", "tabindex=\"0\" data-hash=\"${esc(c.hash)}\""), g("${o.sel === c.hash ? \" sel\" : \"\"}", "data-h=\"${c.hash}\" tabindex=\"0\"")))
      .toBe(g("${c === tip ? \" tip\" : \"\"}${o.sel === c.hash ? \" sel\" : \"\"}", "data-h=\"${c.hash}\" tabindex=\"0\""));
    const s = sides("const D = { on: false, held: [] };", "const D = { on: false, held: [], rank: [] };", "const D = { on: false, held: [], rank: null };");
    expect(conflicts(s)).toHaveLength(1);
  });

  test("a stretch both reshaped: lines paired, list items merged in each pair, lines only one side added kept whole (deps.ts)", () => {
    // DEFAULTS, a one-liner both added to, with declarations both added under it.
    const d = (x: string) => `export const DEFAULTS = { on: false, held: [], ${x}preview: false };`;
    expect(merged(`${d("")}\n\nz`, `${d("").replace(" };", ", digs: [] };")}\nexport const MAX_DIGS = 10;\n\nz`, `${d("rank: [], ")}\nexport const MAX_RANKED = 20;\n\nz`))
      .toBe(`${d("rank: [], ").replace(" };", ", digs: [] };")}\nexport const MAX_DIGS = 10;\nexport const MAX_RANKED = 20;\n\nz`);
    // Report: a one-liner main added to and the branch reflowed onto lines of its own.
    const report = "export interface Report { at: number; updates: Update[]; previews?: Run[]; branch?: string; note?: string }";
    expect(merged(`${report}\n\nz`, `${report.replace("Run[];", "Run[]; digs?: Dug[];")}\n\nz`, "export interface Report {\n  at: number; updates: Update[]; previews?: Run[]; branch?: string; note?: string;\n  rank?: string[];\n}\n\nz"))
      .toBe("export interface Report {\n  at: number; updates: Update[]; previews?: Run[]; digs?: Dug[]; branch?: string; note?: string;\n  rank?: string[];\n}\n\nz");
    // The registry fetch: both appended to the cast and the return, and the branch added a line between.
    const was = "  const doc = (await res.json()) as { versions?: Record<string, unknown>; time?: Record<string, string> };\n  return { versions: Object.keys(doc.versions ?? {}), time: doc.time ?? {} };\n};";
    const onMain = "  const doc = (await res.json()) as { versions?: Record<string, unknown>; time?: Record<string, string>; \"dist-tags\"?: Record<string, string> };\n  return { versions: Object.keys(doc.versions ?? {}), time: doc.time ?? {}, tags: doc[\"dist-tags\"] ?? {} };\n};";
    const onBranch = "  const doc = (await res.json()) as { versions?: Record<string, { peers?: Peers } | null>; time?: Record<string, string> };\n  const peers = peersOf(doc.versions);\n  return { versions: Object.keys(doc.versions ?? {}), time: doc.time ?? {}, peers };\n};";
    expect(merged(was, onMain, onBranch)).toBe("  const doc = (await res.json()) as { versions?: Record<string, { peers?: Peers } | null>; time?: Record<string, string>; \"dist-tags\"?: Record<string, string> };\n  const peers = peersOf(doc.versions);\n  return { versions: Object.keys(doc.versions ?? {}), time: doc.time ?? {}, tags: doc[\"dist-tags\"] ?? {}, peers };\n};");
  });

  test("a CSS rule line both added rules to, with rules added under it (client.html)", () => {
    const was = "  .cg g:hover > *, .cg g.on > * { stroke: red; }\n  .cg g[data-hash] { cursor: pointer; }\n  .cg-pick { display: grid; }";
    const onMain = "  .cg g:hover > *, .cg g.on > * { stroke: red; }\n  .cg g[data-hash] { cursor: pointer; } .cg g.beat > * { stroke: gold; }\n  .cg .bead { fill: gold; }\n  .cg-pick { display: grid; }";
    const onBranch = "  .cg g:hover > *, .cg g.sel > * { stroke: red; }\n  .cg path.t { fill: brown; } .cg g[data-h] { cursor: pointer; }\n  .cg-tag { gap: 3px; }\n  .cg-pick { display: grid; }";
    expect(merged(was, onMain, onBranch, "client.html")).toBe("  .cg g:hover > *, .cg g.sel > * { stroke: red; }\n  .cg path.t { fill: brown; } .cg g[data-h] { cursor: pointer; } .cg g.beat > * { stroke: gold; }\n  .cg .bead { fill: gold; }\n  .cg-tag { gap: 3px; }\n  .cg-pick { display: grid; }");
  });

  test("real rewrites stay conflicts: code hung under a line the other side removed, or one item rewritten two ways", () => {
    // drawGraph in client.html: the branch dropped the call, main hung the pulse code under it.
    expect(conflicts(sides("  };\n  drawGraph(graph);\n  el.on();", "  };\n  drawGraph(graph);\n  let beatAt = 0;\n  el.on();", "  };\n  el.on();"), "client.html")).toHaveLength(1);
    // Registry: main pulled the type out into Meta, the branch added a field inside it.
    const was = "/** Its versions. */\nexport type Registry = (n: string) => Promise<{ versions: string[] } | null>;";
    const onMain = "/** Its versions. */\nexport interface Meta { versions: string[]; tags?: Tags }\nexport type Registry = (n: string) => Promise<Meta | null>;";
    expect(conflicts(sides(was, onMain, was.replace("string[] }", "string[]; peers?: Peers }")))).toHaveLength(1);
  });
});

describe("refused, not merged clean (#934)", () => {
  const MARKED = ["a", "<<<<<<< HEAD", "b", "=======", "c", ">>>>>>> origin/main", "d"].join("\n");

  test("the branch's conflict markers are a conflict; settled as the branch they land, and main's own don't hold it", () => {
    const s = sides("a\nd", "a\nd", MARKED);
    expect(conflicts(s, "notes.md")).toEqual([{ line: "lint:markers", base: "", main: null, branch: null, lint: "the branch has git's conflict markers in it (line 2, 6)" }]);
    expect(explain(conflicts(s, "notes.md")[0]!).choices).toEqual(["main", "branch"]);
    expect(text(settle(s, { "lint:markers": "branch" }, "notes.md"))).toBe(MARKED);
    // `=======` alone is a heading's underline.
    expect(conflicts(sides("a", "a", "Title\n=======\na"), "notes.md")).toEqual([]);
    // Markers main already has are CI's to catch, not this merge's.
    expect(conflicts(sides(MARKED, MARKED, MARKED + "\ne"), "notes.md")).toEqual([]);
  });

  test("a JSON file both sides parse that the merge doesn't", () => {
    const s = sides("[\n  1\n]", "[\n  1,\n  2\n]", "[\n  1,\n  3\n]");
    expect(conflicts(s, "list.json")).toMatchObject([{ line: "lint:json", lint: expect.stringContaining("merged, it isn't valid JSON") }]);
    expect(conflicts(s, "list.txt")).toEqual([]);
    expect(text(settle(s, { "lint:json": "branch" }, "list.json"))).toBe("[\n  1,\n  2\n  3\n]");
    // A file that didn't parse to begin with (comments in a tsconfig) isn't held for it.
    expect(conflicts(sides("// c\n[\n  1\n]", "// c\n[\n  1,\n  2\n]", "// c\n[\n  1,\n  3\n]"), "tsconfig.json")).toEqual([]);
  });

  test("YAML and TOML too, with parsers that run in the Worker (#986)", () => {
    // As with the JSON above: each side adds an item after the same line it gave a comma.
    const yaml = sides('tags: [\n  "a"\n]', 'tags: [\n  "a",\n  "b"\n]', 'tags: [\n  "a",\n  "c"\n]');
    expect(conflicts(yaml, "ci.yml")).toMatchObject([{ line: "lint:yaml", lint: expect.stringContaining("merged, it isn't valid YAML") }]);
    expect(text(settle(yaml, { "lint:yaml": "branch" }, "ci.yml"))).toBe('tags: [\n  "a",\n  "b"\n  "c"\n]');
    const toml = sides("a = [\n  1\n]", "a = [\n  1,\n  2\n]", "a = [\n  1,\n  3\n]");
    expect(conflicts(toml, "Cargo.toml")).toMatchObject([{ line: "lint:toml", lint: expect.stringContaining("merged, it isn't valid TOML") }]);
    // Merges that parse, and several YAML documents in one file, pass.
    expect(conflicts(sides("a: 1\n---\nb: 1", "a: 2\n---\nb: 1", "a: 1\n---\nb: 2"), "k8s.yaml")).toEqual([]);
    expect(conflicts(sides("[a]\nx = 1\n[b]\ny = 1", "[a]\nx = 2\n[b]\ny = 1", "[a]\nx = 1\n[b]\ny = 2"), "a.toml")).toEqual([]);
    expect(parseError("yaml", "a: [1")).not.toBeNull();
    expect(parseError("toml", "a = ")).not.toBeNull();
  });
});

// Disagreements with git that scripts/shadow.ts found on this repo's merged PRs (#1014).
describe("found in shadow mode (#1014)", () => {
  test("#244's .gitignore: both added `!.env.schema` a line apart; git merged it in twice, ours asks once", () => {
    const was = ".env\n.env.*\n!.env.example\n.dev.vars";
    const s = sides(was, ".env\n.env.*\n!.env.schema\n!.env.example\n.dev.vars", ".env\n.env.*\n!.env.example\n!.env.schema\n.dev.vars");
    expect(conflicts(s, ".gitignore")).toMatchObject([{ main: "!.env.schema", branch: "!.env.schema", doubled: true }]);
    // What landed was git's, the line twice; main's place keeps it once.
    expect(text(settle(s, { [conflicts(s, ".gitignore")[0]!.line]: "main" }, ".gitignore"))).toBe(".env\n.env.*\n!.env.schema\n!.env.example\n.dev.vars");
  });

  test("#960's index.html: each side added a head picker in its own place; git conflicted, ours kept both, so a duplicate id is a lint conflict", () => {
    const was = "<body>\n<header><h1>git-recon</h1></header>\n<main>\n<canvas id=\"map\"></canvas>\n</main>\n</body>";
    const s = sides(was,
      "<body>\n<header><h1>git-recon</h1></header>\n<main>\n<canvas id=\"map\"></canvas>\n<div class=\"heads-row\"><span>Head</span><div id=\"heads\" class=\"heads\"></div></div>\n</main>\n</body>",
      "<body>\n<header><h1>git-recon</h1><div id=\"heads\" class=\"heads\" role=\"radiogroup\" aria-label=\"Head\"></div></header>\n<main>\n<canvas id=\"map\"></canvas>\n</main>\n</body>");
    const m = merge(s.base, s.branch, s.main, {}, "bot", "index.html");
    expect(m.conflicts).toEqual([]);
    expect(lintMerge("index.html", s.main, s.branch, m)).toEqual([{ line: "lint:duplicate-id:heads", base: "", main: null, branch: null, lint: "`id=\"heads\"` is on two elements (line 5)" }]);
    // Resolved `branch`, it lands as merged; an id both sides already had twice, or one in a comment, isn't new.
    expect(lintMerge("index.html", s.main, s.branch, m, { "lint:duplicate-id:heads": "branch" })).toEqual([]);
    const twice = sides("<p id=a></p>\n<p id=a></p>\n<!-- <i id='b'> -->", "<p id=a></p>\n<p id=a></p>\n<!-- <i id='b'> -->\n<i id='b'></i>", "<p data-id=\"b\" id=a></p>\n<p id=a></p>\n<!-- <i id='b'> -->");
    const t = merge(twice.base, twice.branch, twice.main, {}, "bot", "page.htm");
    expect(lintMerge("page.htm", twice.main, twice.branch, t)).toEqual([]);
  });
});

describe("over the API", () => {
  /** ana's repo r: a.ts with `x(1)` on main changed to `x(2)` and on branch b1 to `x(3)`. */
  async function app(env: Record<string, string> = {}) {
    const call = await boot({ GH_CLI: "off", ...env });
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
    expect(await r.json()).toEqual({ path: "a.ts", line: "L2", harness: "claude", text: "x(2);\nx(3);", ok: true, tests: "skipped: this repo's merge answers aren't tested (its test merges setting)" });
    expect(seen).toBe("<<<<<<< main\nx(2);\n||||||| base\nx(1);\n=======\nx(3);\n>>>>>>> branch\n");
    // It sees main's lines around the conflict.
    expect(prompt).toContain("const a = 1;");
    expect(await file()).toBe("const a = 1;\nx(2);");

    call.env.AGENT_EXEC = (async () => ({ code: 0, out: "" })) as Exec;
    const same = await ask("ana", { path: "a.ts", line: "L2", harness: "claude" });
    expect(same.status).toBe(502);
    expect((await same.json() as any).error).toBe("claude left the conflict as it was");
  });

  test("the agent's answer is checked: it must parse, and the tests run with it in a throwaway clone (#934)", async () => {
    const { call, post } = await app();
    await post("ana", "/api/repos/ana/r/files", { path: "package.json", content: '{\n  "scripts": { "test": "bun test" }\n}' });
    for (const path of ["a.ts", "package.json"]) await post("ana", `/api/repos/ana/r/do/commit?path=${path}`, { message: "main: count from two" });
    let answer = "x(2", prompt = "";
    call.env.AGENT_EXEC = (async (cmd, cwd) => { prompt = cmd.args.join(" "); writeFileSync(join(cwd, "RESOLVE.ts"), answer + "\n"); return { code: 0, out: "" }; }) as Exec;
    const ask = async () => await (await post("ana", "/api/repos/ana/r/branches/b1/conflicts/agent", { path: "a.ts", line: "L2", harness: "claude" })).json() as any;

    // Main's commit messages since the fork, so it knows why main changed the line.
    const broken = await ask();
    expect(prompt).toContain("main's commits to a.ts said:\n- main: count from two");
    expect(broken).toMatchObject({ text: "x(2", ok: false, tests: "not run" });
    expect(broken.failure).toStartWith("merged, it doesn't parse: ");

    const ran: Record<string, string>[] = [], only: (string[] | undefined)[] = [];
    let pass = false;
    call.env.DEPS_TESTER = (async (_remote: string, files: Record<string, string>, o: { only?: string[] }) => { ran.push(files); only.push(o.only); return pass ? { ok: true, out: "1 pass" } : { ok: false, out: "1 fail: x is 2" }; }) as Tester;
    answer = "x(2);\nx(3);";
    const put = async (body: unknown) => expect((await call("ana", "/api/repos/ana/r/deps", { method: "PUT", body: JSON.stringify(body) })).status).toBe(200);
    // The doctor's run tests setting alone doesn't test merge answers: they have their own switch (#998).
    await put({ run_tests: true });
    expect(await ask()).toMatchObject({ ok: true, tests: "skipped: this repo's merge answers aren't tested (its test merges setting)" });
    expect(ran).toEqual([]);

    // Merge tests on, the doctor's off: the clone gets the merged file, and a failing run comes back with the answer.
    await put({ run_tests: false, test_merges: true });
    expect(await ask()).toEqual({ path: "a.ts", line: "L2", harness: "claude", text: answer, ok: false, tests: "failed", failure: "1 fail: x is 2" });
    expect(ran[0]).toEqual({ "a.ts": "const a = 1;\nx(2);\nx(3);" });
    // Only the tests for the settled file, where the runner can tell which (#990).
    expect(only[0]).toEqual(["a.ts"]);
    pass = true;
    expect(await ask()).toMatchObject({ ok: true, tests: "passed" });
  });

  test("a branch an agent run made: the agent hears the run's task as the branch's side (#986)", async () => {
    const { call, post } = await app();
    const row = await call.env.DB.prepare("INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started) VALUES ('ana', 'r', 'a.ts', 'claude', 'count from three', 'ana', 'done', 0) RETURNING id").first() as { id: number };
    const name = `agent-run-${row.id}`;
    await post("ana", "/api/repos/ana/r/branches", { name });
    const rev = (await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json() as Doc).rev;
    await post("ana", `/api/repos/ana/r/do/ops?path=a.ts&branch=${name}`, { ops: [{ kind: "set", line: "L2", base: rev, text: "x(3);" }] });
    await post("ana", "/api/repos/ana/r/do/ops?path=a.ts", { ops: [{ kind: "set", line: "L2", base: rev, text: "x(4);" }] });
    let prompt = "";
    call.env.AGENT_EXEC = (async (cmd, cwd) => { prompt = cmd.args.join(" "); writeFileSync(join(cwd, "RESOLVE.ts"), "x(3);\n"); return { code: 0, out: "" }; }) as Exec;
    expect((await post("ana", `/api/repos/ana/r/branches/${name}/conflicts/agent`, { path: "a.ts", line: "L2", harness: "claude" })).status).toBe(200);
    expect(prompt).toContain(`${name} is a coding agent's work on the task: count from three`);
    // A branch a person made has no task to tell.
    await post("ana", "/api/repos/ana/r/branches/b1/conflicts/agent", { path: "a.ts", line: "L2", harness: "claude" });
    expect(prompt).not.toContain("coding agent's work");
  });

  test("merge_clean_branches: branches on different lines all land, one that conflicts stays open", async () => {
    const { call, post, file } = await app();
    await post("ana", "/api/repos/ana/r/files", { path: "README.md", content: "# r" });
    await post("ana", "/api/repos/ana/r/files", { path: "package.json", content: '{\n  "version": "1.0.0"\n}' });
    // Two branches that change different files, and one that only adds a line to a.ts beside b1's.
    for (const b of ["docs", "bump", "more", "empty"]) await post("ana", "/api/repos/ana/r/branches", { name: b });
    await post("ana", "/api/repos/ana/r/do/ops?path=README.md&branch=docs", { ops: [{ kind: "set", line: "L1", base: 1, text: "# r, documented" }] });
    await post("ana", "/api/repos/ana/r/do/ops?path=package.json&branch=bump", { ops: [{ kind: "set", line: "L2", base: 2, text: '  "version": "1.0.1"' }] });
    await post("ana", "/api/repos/ana/r/do/ops?path=a.ts&branch=more", { ops: [{ kind: "set", line: "L1", base: 1, text: "const a = 2;" }] });
    expect((await post("bob", "/api/repos/ana/r/merges", {})).status).toBe(403);
    expect((await post("ana", "/api/repos/ana/r/merges", { branches: "docs" })).status).toBe(400);

    const r = await post("ana", "/api/repos/ana/r/merges", {});
    expect(r.status).toBe(200);
    const out = await r.json() as any;
    expect(out.merged.sort()).toEqual(["bump", "docs", "more"]);
    expect(out.skipped).toEqual([{ branch: "b1", error: "conflicts", files: ["a.ts"] }, { branch: "empty", error: "nothing to merge" }]);
    const read = async (path: string) => text(await (await call("ana", `/api/repos/ana/r/do/file?path=${path}`)).json() as Doc);
    expect(await read("README.md")).toBe("# r, documented");
    expect(await read("package.json")).toBe('{\n  "version": "1.0.1"\n}');
    expect(await file()).toBe("const a = 2;\nx(2);");
    const open = (await (await call("ana", "/api/repos/ana/r/branches")).json() as any[]).filter((b) => b.status === "open").map((b) => b.name).sort();
    expect(open).toEqual(["b1", "empty"]);

    const named = await (await post("ana", "/api/repos/ana/r/merges", { branches: ["b1", "gone"] })).json() as any;
    expect(named).toEqual({ merged: [], skipped: [{ branch: "gone", error: "no open branch" }, { branch: "b1", error: "conflicts", files: ["a.ts"] }] });
  });

  test("leftovers to AI: a merge asks a checked agent on its own, once per conflict, on the cheapest model (#1012)", async () => {
    const { call, post, file } = await app({ HEAL: "1" });
    let asked = 0, prompt: string[] = [];
    call.env.AGENT_EXEC = (async (cmd, cwd) => { asked++; prompt = cmd.args; writeFileSync(join(cwd, "RESOLVE.ts"), "x(2);\nx(3);\n"); return { code: 0, out: "" }; }) as Exec;
    // Code goes to a person by default: nobody is asked.
    const person = await (await post("ana", "/api/repos/ana/r/branches/b1/merge", {})).json() as any;
    expect(person.conflicts[0]).toMatchObject({ path: "a.ts", leftover: "person" });
    expect(person.conflicts[0].conflicts[0].answer).toBeUndefined();
    expect(asked).toBe(0);

    await post("ana", "/api/repos/ana/r/files", { path: ".gitattributes", content: "*.ts codesplitter-leftover=ai" });
    const r = await post("ana", "/api/repos/ana/r/branches/b1/merge", {});
    expect(r.status).toBe(409);
    const out = await r.json() as any;
    const answer = { harness: "claude", model: "haiku", text: "x(2);\nx(3);", ok: true, tests: "skipped: this repo's merge answers aren't tested (its test merges setting)" };
    expect(out.conflicts[0]).toMatchObject({ path: "a.ts", leftover: "ai" });
    expect(out.conflicts[0].conflicts[0].answer).toEqual(answer);
    expect(prompt.slice(-2)).toEqual(["--model", "haiku"]);
    // Nothing lands on its own, and merging again asks nothing until the conflict changes.
    expect(await file()).toBe("const a = 1;\nx(2);");
    await post("ana", "/api/repos/ana/r/branches/b1/merge", {});
    expect(asked).toBe(1);
    const review = await (await call("ana", "/api/repos/ana/r/branches/b1")).json() as any;
    expect(review.files.find((f: any) => f.path === "a.ts").conflicts[0].answer).toEqual(answer);
    const rev = (await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json() as Doc).rev;
    await post("ana", "/api/repos/ana/r/do/ops?path=a.ts", { ops: [{ kind: "set", line: "L2", base: rev, text: "x(4);" }] });
    await post("ana", "/api/repos/ana/r/branches/b1/merge", {});
    expect(asked).toBe(2);

    // Taking it merges, and the kept answers go with the branch.
    expect((await post("ana", "/api/repos/ana/r/branches/b1/merge", { resolve: { "a.ts": { L2: { text: "x(2);\nx(3);" } } } })).status).toBe(200);
    expect((await call.env.DB.prepare("SELECT COUNT(*) AS n FROM leftover_answers").first() as { n: number }).n).toBe(0);
  });

  test("a branch's third conflict round goes to fresh eyes with a note, then to a person (#1089)", async () => {
    const { call, post } = await app({ HEAL: "1" });
    const prompts: string[][] = [];
    call.env.AGENT_EXEC = (async (cmd, cwd) => { prompts.push(cmd.args); writeFileSync(join(cwd, "RESOLVE.ts"), `x(${prompts.length}0);\n`); return { code: 0, out: "" }; }) as Exec;
    await post("ana", "/api/repos/ana/r/files", { path: ".gitattributes", content: "*.ts codesplitter-leftover=ai" });
    const merge = async () => await (await post("ana", "/api/repos/ana/r/branches/b1/merge", {})).json() as any;
    // Main moves under the branch: the conflict changes, and the next merge asks again.
    const move = async (n: number) => {
      const rev = (await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json() as Doc).rev;
      await post("ana", "/api/repos/ana/r/do/ops?path=a.ts", { ops: [{ kind: "set", line: "L2", base: rev, text: `x(${n});` }] });
    };
    const rounds = async () => (await call.env.DB.prepare("SELECT conflict_rounds AS n FROM branches WHERE name = 'b1'").first() as { n: number }).n;

    // Rounds one and two: the cheapest model, no note. Merging again over the same conflict is no new round.
    expect((await merge()).conflicts[0].conflicts[0].answer).toMatchObject({ model: "haiku", text: "x(10);" });
    await merge();
    expect(await rounds()).toBe(1);
    await move(4);
    expect((await merge()).conflicts[0].conflicts[0].answer.note).toBeUndefined();
    expect(await rounds()).toBe(2);
    expect(prompts.map((p) => p.join(" ")).some((p) => p.includes("Fresh eyes"))).toBe(false);

    // Round three: code's policy says handoff, so fresh eyes on the CLI's own model, from the note.
    await move(5);
    const third = (await merge()).conflicts[0].conflicts[0].answer;
    expect(third).toMatchObject({ harness: "claude", text: "x(30);", round: 3 });
    expect(third.model).toBeUndefined();
    expect(third.note).toBe('DONE: 2 conflict rounds on b1, an agent\'s answer each\nNEXT: settle a.ts:L2 as main stands now\nBROKE: last answer held, then main moved again\nDONT: last answer again: "x(20);"');
    expect(prompts.at(-1)).not.toContain("--model");
    expect(prompts.at(-1)!.join(" ")).toContain(`Fresh eyes: b1's conflicts came back again, and the agents before you left this note.`);
    expect(prompts.at(-1)!.join(" ")).toContain(third.note);

    // After HANDOFFS of them a person's turn: no agent asked, the note says why.
    await move(6);
    await merge();
    await move(7);
    const asked = prompts.length, out = await merge();
    expect(prompts.length).toBe(asked);
    expect(out.conflicts[0].note).toStartWith("conflict round 5 on b1: a person's turn\nDONE: 4 conflict rounds on b1");
    expect(out.conflicts[0].conflicts[0].answer).toBeUndefined();
    // Merging again asks nobody, and counts no further round.
    expect((await merge()).conflicts[0].note).toStartWith("conflict round 5 on b1");
    expect(await rounds()).toBe(4);
  });

  test("a third conflict round in a file whose policy escalates: a person's, with the note (#1089)", async () => {
    const { call, post } = await app({ HEAL: "1" });
    let asked = 0;
    call.env.AGENT_EXEC = (async (_cmd, cwd) => { asked++; writeFileSync(join(cwd, "RESOLVE.ts"), "x(9);\n"); return { code: 0, out: "" }; }) as Exec;
    await post("ana", "/api/repos/ana/r/files", { path: ".gitattributes", content: "*.ts codesplitter-leftover=ai codesplitter-over=escalate" });
    for (const n of [4, 5]) {
      await post("ana", "/api/repos/ana/r/branches/b1/merge", {});
      const rev = (await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json() as Doc).rev;
      await post("ana", "/api/repos/ana/r/do/ops?path=a.ts", { ops: [{ kind: "set", line: "L2", base: rev, text: `x(${n});` }] });
    }
    const out = await (await post("ana", "/api/repos/ana/r/branches/b1/merge", {})).json() as any;
    expect(asked).toBe(2);
    expect(out.conflicts[0].note).toStartWith("conflict round 3 on b1: a person's turn\nDONE: 2 conflict rounds on b1");
  });

  test("leftovers to AI where agents don't run on their own: the conflict goes to a person, saying why", async () => {
    const { call, post } = await app();
    let asked = 0;
    call.env.AGENT_EXEC = (async () => { asked++; return { code: 0, out: "" }; }) as Exec;
    await post("ana", "/api/repos/ana/r/files", { path: ".gitattributes", content: "a.ts codesplitter-leftover=ai" });
    const out = await (await post("ana", "/api/repos/ana/r/branches/b1/merge", {})).json() as any;
    expect(out.conflicts[0].note).toStartWith("no agent asked: self-healing runs with hosted agents");
    expect(asked).toBe(0);
  });

  test("leftovers to CI: a lockfile both changed is made again in a throwaway clone and merged whole (#1012)", async () => {
    const { call, post } = await app();
    await post("ana", "/api/repos/ana/r/files", { path: "package.json", content: '{\n  "dependencies": { "a": "1" }\n}' });
    await post("ana", "/api/repos/ana/r/files", { path: "bun.lock", content: "a@1" });
    for (const path of ["package.json", "bun.lock"]) await post("ana", `/api/repos/ana/r/do/commit?path=${path}`, { message: "deps" });
    await post("ana", "/api/repos/ana/r/branches", { name: "dep" });
    const pkg = (await (await call("ana", "/api/repos/ana/r/do/file?path=package.json")).json() as Doc).lines[1]!;
    await post("ana", "/api/repos/ana/r/do/ops?path=package.json&branch=dep", { ops: [{ kind: "set", line: pkg.id, base: pkg.rev, text: '  "dependencies": { "a": "1", "b": "1" }' }] });
    // The lockfile is locked to live edits (#1011): both sides change it as a push or a regeneration does, at the file.
    const relock = (text: string, branch?: string) => toFile(call.env, "ana", "r", "bun.lock", "ana", "ops", { method: "POST", body: JSON.stringify({ ops: [{ kind: "set", line: "L1", base: 1, text }] }) }, "", branch);
    expect(await materializeOn(call.env, "ana", "r", "dep", "bun.lock")).toEqual({ ok: true });
    expect((await relock("a@1 b@1", "dep")).ok).toBe(true);
    expect((await relock("a@1.0.1")).ok).toBe(true);

    const ran: { files: Record<string, string>; test: boolean; lock: string | null }[] = [];
    let lock: string | null = null;
    call.env.DEPS_TESTER = (async (_remote: string, files: Record<string, string>, o: { test: boolean; lock: string | null }) => {
      ran.push({ files, test: o.test, lock: o.lock });
      return lock === null ? { ok: false, out: "error: no such package b" } : { ok: true, out: "", lock };
    }) as Tester;
    const failed = await post("ana", "/api/repos/ana/r/branches/dep/merge", {});
    expect(failed.status).toBe(409);
    expect((await failed.json() as any).conflicts).toEqual([{ path: "bun.lock", leftover: "ci", note: "couldn't be regenerated: error: no such package b", conflicts: [expect.objectContaining({ line: "file", whole: true })] }]);
    // Main's lockfile and the manifest as merged, a lockfile-only install.
    expect(ran[0]).toEqual({ files: { "package.json": '{\n  "dependencies": { "a": "1", "b": "1" }\n}', "bun.lock": "a@1.0.1\n" }, test: false, lock: "bun.lock" });

    lock = "a@1.0.1 b@1\n";
    expect((await post("ana", "/api/repos/ana/r/branches/dep/merge", {})).status).toBe(200);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=bun.lock")).json() as Doc)).toBe("a@1.0.1 b@1");
  });

  test("a merge both sides changed, settled with no card, runs the tests in a throwaway clone before it lands (#1096)", async () => {
    const { call, post } = await app();
    await post("ana", "/api/repos/ana/r/files", { path: "package.json", content: '{\n  "scripts": { "test": "bun test" }\n}' });
    for (const path of ["a.ts", "package.json"]) await post("ana", `/api/repos/ana/r/do/commit?path=${path}`, { message: "main" });
    // b2 renames a key, and adds a file; main uses the old key on another line meanwhile: no conflict, so no
    // card, and it builds, so the lint passes it (#1081's rules.test.ts).
    await post("ana", "/api/repos/ana/r/branches", { name: "b2" });
    const line = async (id: string) => (await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json() as Doc).lines.find((l) => l.id === id)!;
    const l1 = await line("L1"), l2 = await line("L2");
    await post("ana", "/api/repos/ana/r/do/ops?path=a.ts&branch=b2", { ops: [{ kind: "set", line: "L1", base: l1.rev, text: "const a = { marines: 1 };" }] });
    await post("ana", "/api/repos/ana/r/files", { path: "b.ts", content: "export {};", branch: "b2" });
    await post("ana", "/api/repos/ana/r/do/ops?path=a.ts", { ops: [{ kind: "set", line: "L2", base: l2.rev, text: "x(a.concord);" }] });

    const ran: { files: Record<string, string>; only?: string[] }[] = [];
    call.env.DEPS_TESTER = (async (_remote: string, files: Record<string, string>, o: { only?: string[] }) => {
      ran.push({ files, only: o.only });
      return { ok: false, out: "error TS2339: Property 'concord' does not exist." };
    }) as Tester;
    await call("ana", "/api/repos/ana/r/deps", { method: "PUT", body: JSON.stringify({ test_merges: true }) });
    const failed = await post("ana", "/api/repos/ana/r/branches/b2/merge", {});
    expect(failed.status).toBe(409);
    const body = await failed.json() as any;
    expect(body).toMatchObject({ error: "merged, its tests fail: a.ts", failure: "error TS2339: Property 'concord' does not exist." });
    expect(body.conflicts).toEqual([{ path: "a.ts", leftover: "person", conflicts: [expect.objectContaining({ line: "lint:tests", choices: ["main", "branch"] })] }]);
    // The merged tree, and only the tests for the file both changed: b.ts is the branch's alone.
    expect(ran).toEqual([{ files: { "a.ts": "const a = { marines: 1 };\nx(a.concord);", "b.ts": "export {};" }, only: ["a.ts"] }]);

    // Settled as the branch, it lands anyway.
    expect((await post("ana", "/api/repos/ana/r/branches/b2/merge", { resolve: { "a.ts": { "lint:tests": "branch" } } })).status).toBe(200);
    expect(ran).toHaveLength(1);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json() as Doc)).toBe("const a = { marines: 1 };\nx(a.concord);");
  });
});
