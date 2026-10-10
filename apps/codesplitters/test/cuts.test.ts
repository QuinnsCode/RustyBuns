import { afterAll, expect, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { candidates, chunks, follow, imports, pick, readRun } from "../src/cuts.ts";

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const lines = (text: string) => text.split("\n").map((t, i) => ({ id: `L${i + 1}`, text: t, by: "ryan", rev: i + 1 }));

const SUM = [
  'import { round } from "./round.ts";',
  "import {",
  "  clamp,",
  "  type Range as R,",
  '} from "./clamp.ts";',
  'import "./polyfill.ts";',
  "",
  "export function sum(xs: number[]) {",
  "  return xs.reduce((a, b) => a + b, 1);",
  "}",
  "",
  "export function mean(xs: number[]) {",
  "  return round(sum(xs) / xs.length);",
  "}",
].join("\n");

test("an import statement binds its names, across lines and renames", () => {
  expect(imports(lines(SUM))).toEqual([
    { ids: ["L1"], names: ["round"], from: "./round.ts", takes: ["round"] },
    { ids: ["L2", "L3", "L4", "L5"], names: ["clamp", "R"], from: "./clamp.ts", takes: ["clamp", "Range"] },
    { ids: ["L6"], names: [], from: "./polyfill.ts", takes: ["*"] },
  ]);
  expect(imports(lines('import fmt, { a as b } from "../fmt";\nimport * as path from "node:path";')).map((s) => s.takes)).toEqual([["default", "a"], ["*"]]);
});

test("a file's top-level statements, each with the comments above it", () => {
  const src = [
    'import { x } from "./x.ts";',
    "",
    "/** Doubles. */",
    "export function twice(n: number) {",
    "",
    "  return n * 2;",
    "}",
    "",
    "const { a, b: c } = x;",
    "const page = `",
    "<html>",
    "`;",
    "export default class Box {}",
    'export { c as see, page } ;',
    'export * from "./more.ts";',
    'export { thing as other } from "./thing.ts";',
  ].join("\n");
  expect(chunks(lines(src))).toEqual([
    { ids: ["L3", "L4", "L5", "L6", "L7"], names: ["twice"], exports: ["twice"] },
    { ids: ["L9"], names: ["a", "c"], exports: [] },
    { ids: ["L10", "L11", "L12"], names: ["page"], exports: [] },
    { ids: ["L13"], names: ["Box"], exports: ["default", "Box"] },
    { ids: ["L14"], names: [], exports: ["see", "page"] },
    { ids: ["L15"], names: [], exports: [], from: "./more.ts", takes: [] },
    { ids: ["L16"], names: [], exports: ["other"], from: "./thing.ts", takes: ["thing"] },
  ]);
});

test("a relative import could be one of a few files; a package is none", () => {
  expect(candidates("src/a/b.ts", "../c.js").slice(0, 3)).toEqual(["src/c.ts", "src/c.tsx", "src/c.js"]);
  expect(candidates("test/sum.test.ts", "../src/sum")).toContain("src/sum/index.ts");
  expect(candidates("a.ts", "../../x")).toEqual([]);
  expect(candidates("a.ts", "bun:test")).toEqual([]);
});

test("a cut follows imports into other files, taking what's imported and what that uses", async () => {
  const repo: Record<string, string> = {
    "test/mean.test.ts": ['import { expect, test } from "bun:test";', 'import { mean } from "../src";', "", 'test("mean", () => expect(mean([2, 4])).toBe(3));'].join("\n"),
    "src/index.ts": ['export * from "./stats.ts";', 'export * from "./shapes.ts";'].join("\n"),
    "src/stats.ts": ['import { round, unused } from "./util.js";', "", "const N = 1;", "", "// The average.", "export function mean(xs: number[]) {", "  return round(sum(xs) / xs.length / N);", "}", "", "export function sum(xs: number[]) {", "  return xs.reduce((a, b) => a + b, 0);", "}", "", "export const spare = 1;"].join("\n"),
    "src/shapes.ts": "export const square = (n: number) => n * n;",
    "src/util.ts": ['import { mean } from "./stats.ts";', "export const round = (n: number) => Math.round(n);", "export const unused = () => mean([]);"].join("\n"),
  };
  const doc = (text: string) => ({ rev: 1, nextId: 99, lines: lines(text) });
  const loaded: string[] = [];
  const got = await follow([{ path: "test/mean.test.ts", doc: doc(repo["test/mean.test.ts"]!), ranges: [[4, 4]] }], async (p) => {
    loaded.push(p);
    return repo[p] === undefined ? null : doc(repo[p]!);
  });
  expect(got.map((f) => [f.path, f.pulled, f.doc.lines.map((l) => l.text)])).toEqual([
    ["test/mean.test.ts", false, ['import { expect, test } from "bun:test";', 'import { mean } from "../src";', 'test("mean", () => expect(mean([2, 4])).toBe(3));']],
    ["src/index.ts", true, ['export * from "./stats.ts";', 'export * from "./shapes.ts";']],
    ["src/stats.ts", true, ['import { round, unused } from "./util.js";', "const N = 1;", "// The average.", "export function mean(xs: number[]) {", "  return round(sum(xs) / xs.length / N);", "}", "export function sum(xs: number[]) {", "  return xs.reduce((a, b) => a + b, 0);", "}"]],
    // round and what it uses; unused is imported too, so it's there with mean, which stats.ts already has.
    ["src/util.ts", true, ['import { mean } from "./stats.ts";', "export const round = (n: number) => Math.round(n);", "export const unused = () => mean([]);"]],
  ]);
  expect(loaded).not.toContain("bun:test");
});

test("a cut keeps the picked lines and only the imports they use", () => {
  expect(pick(lines(SUM), [[8, 10]]).map((l) => l.id)).toEqual(["L6", "L8", "L9", "L10"]);
  expect(pick(lines(SUM), [[12, 14]]).map((l) => l.id)).toEqual(["L1", "L6", "L12", "L13", "L14"]);
});

test("a run's JUnit report marks each test's line, and stack frames mark fails", () => {
  const files = [{ path: "test/sum.test.ts", lines: lines("import x\ntest a\ntest b") }, { path: "src/sum.ts", lines: lines("a\nb\nc") }];
  const report = `<testsuites><testsuite name="test/sum.test.ts">
    <testcase name="a" file="test/sum.test.ts" line="2"><failure message="no">no</failure></testcase>
    <testcase name="b" file="test/sum.test.ts" line="3" /></testsuite></testsuites>`;
  const r = readRun("error\n    at sum (/tmp/codesplitters-cut-x/src/sum.ts:2:10)\n", report, files);
  expect(r).toEqual({ passed: 1, failed: 1, marks: { "test/sum.test.ts": { L2: "fail", L3: "pass" }, "src/sum.ts": { L2: "fail" } } });
});

test("cut lines out, run them, fix the cut, and merge the fix back", async () => {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "public" });
  const src = ["export function twice(x: number) {", "  return x * 2;", "}", "", ...SUM.split("\n").slice(7, 10)].join("\n");
  const spec = ['import { expect, test } from "bun:test";', 'import { sum } from "../src/sum.ts";', 'import { twice } from "../src/sum.ts";', "", 'test("sums", () => expect(sum([1, 2])).toBe(3));', 'test("twice", () => expect(twice(2)).toBe(4));'].join("\n");
  await send("ryan", "/api/repos/ryan/lab/files", { path: "src/sum.ts", content: src });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "test/sum.test.ts", content: spec });

  // Only the crew cuts: a cut is a branch.
  expect((await send("ana", "/api/repos/ryan/lab/cuts", { path: "src/sum.ts", from: 5, to: 7 })).status).toBe(403);
  const made = await send("ryan", "/api/repos/ryan/lab/cuts", { pieces: [{ path: "src/sum.ts", from: 5, to: 7 }, { path: "test/sum.test.ts", from: 5, to: 5 }], note: "off by one" });
  expect(made.status).toBe(201);
  const { id, branch } = (await made.json()) as { id: string; branch: string };
  expect(branch).toBe(`cut-${id}`);

  // The cut has the picked lines and the imports they use, each with where it came from.
  const cut = (await (await call("ana", `/api/cuts/${id}`)).json()) as any;
  expect(cut.files.map((f: any) => [f.path, f.lines.map((l: any) => [l.n, l.text])])).toEqual([
    ["src/sum.ts", [[5, "export function sum(xs: number[]) {"], [6, "  return xs.reduce((a, b) => a + b, 1);"], [7, "}"]]],
    ["test/sum.test.ts", [[1, 'import { expect, test } from "bun:test";'], [2, 'import { sum } from "../src/sum.ts";'], [5, 'test("sums", () => expect(sum([1, 2])).toBe(3));']]],
  ]);
  expect(cut.can_run).toBe(false);   // ana isn't the owner

  // Run: bun test on just the cut. It fails, on the test's line.
  expect((await send("ana", `/api/cuts/${id}/run`, {})).status).toBe(403);
  const run1 = (await (await send("ryan", `/api/cuts/${id}/run`, {})).json()) as any;
  expect([run1.passed, run1.failed]).toEqual([0, 1]);
  const testLine = cut.files[1].lines[2].id;
  expect(run1.marks["test/sum.test.ts"][testLine]).toBe("fail");

  // Fix it in the cut, as anyone with write access would on a branch.
  const bad = cut.files[0].lines[1];
  const fix = await send("ryan", `/api/repos/ryan/lab/do/ops?path=src/sum.ts&branch=${branch}`, { ops: [{ kind: "set", line: bad.id, base: bad.rev, text: "  return xs.reduce((a, b) => a + b, 0);" }] });
  expect(fix.status).toBe(200);
  const run2 = (await (await send("ryan", `/api/cuts/${id}/run`, {})).json()) as any;
  expect([run2.code, run2.passed, run2.failed]).toEqual([0, 1, 0]);
  expect(run2.marks["test/sum.test.ts"][testLine]).toBe("pass");

  // Share: a social card and a page for link previews.
  const card = await call(null, `/api/cuts/${id}/card.png`);
  expect(card.headers.get("content-type")).toBe("image/png");
  expect([...new Uint8Array(await card.arrayBuffer()).slice(1, 4)]).toEqual([80, 78, 71]);
  const page = await (await call(null, `/api/cuts/${id}/share`)).text();
  expect(page).toContain(`og:image" content="http://codesplitters.local/api/cuts/${id}/card.png`);
  expect(page).toContain("1 passed, 0 failed");
  expect(page).toContain('name="twitter:card" content="summary_large_image"');

  // Merge back: the fix lands on main; lines that were never in the cut stay put.
  const review = (await (await call("ryan", `/api/repos/ryan/lab/branches/${branch}`)).json()) as any;
  expect(review.files.map((f: any) => [f.path, f.ops.length])).toEqual([["src/sum.ts", 1], ["test/sum.test.ts", 0]]);
  expect((await send("ryan", `/api/repos/ryan/lab/branches/${branch}/merge`, {})).status).toBe(200);
  const main = (await (await call("ryan", "/api/repos/ryan/lab/do/file?path=src/sum.ts")).json()) as any;
  expect(main.lines.map((l: any) => l.text).join("\n")).toBe(src.replace("a + b, 1", "a + b, 0"));
  const spec2 = (await (await call("ryan", "/api/repos/ryan/lab/do/file?path=test/sum.test.ts")).json()) as any;
  expect(spec2.lines.map((l: any) => l.text).join("\n")).toBe(spec);
  expect(((await (await call(null, `/api/cuts/${id}`)).json()) as any).status).toBe("merged");
});

test("cut just a test line, and the code it imports comes along to run", async () => {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (user: string, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab2", visibility: "public" });
  await send("ryan", "/api/repos/ryan/lab2/files", { path: "src/math.ts", content: ["export const half = (n: number) => n / 2;", "", "export function mean(xs: number[]) {", "  return xs.reduce((a, b) => a + b, 0) / xs.length;", "}"].join("\n") });
  await send("ryan", "/api/repos/ryan/lab2/files", { path: "test/math.test.ts", content: ['import { expect, test } from "bun:test";', 'import { half, mean } from "../src/math";', "", 'test("half", () => expect(half(4)).toBe(2));', 'test("mean", () => expect(mean([2, 4])).toBe(3));'].join("\n") });

  const made = await send("ryan", "/api/repos/ryan/lab2/cuts", { path: "test/math.test.ts", from: 5 });
  expect(made.status).toBe(201);
  const { id, files } = (await made.json()) as any;
  expect(files).toEqual([{ path: "test/math.test.ts", lines: 3 }, { path: "src/math.ts", lines: 4, pulled: true }]);
  // half's test isn't in the cut, but the import that comes with it names half, so half comes too.
  const cut = (await (await call("ryan", `/api/cuts/${id}`)).json()) as any;
  expect(cut.files[1].lines.map((l: any) => l.n)).toEqual([1, 3, 4, 5]);
  const run = (await (await send("ryan", `/api/cuts/${id}/run`, {})).json()) as any;
  expect([run.code, run.passed, run.failed]).toEqual([0, 1, 0]);
});
