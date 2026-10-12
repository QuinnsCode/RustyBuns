import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { apply, empty, fromText, type Doc } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { clashIn, waves } from "../src/merge-plan.ts";
import { local as boot } from "../src/local.ts";

// End to end (in-process D1 and file DOs): fine alone, slow on a busy machine.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** Main as `content`, and a branch's side: forked there, its copy edited to `to`. */
const doc = (content: string) => { const d = empty(); apply(d, fromText(content), "me"); return d; };
const side = (main: Doc, to: string) => {
  const copy = structuredClone(main);
  apply(copy, diffToOps(copy.lines, to.split("\n")), "bot");
  return { base: structuredClone(main), copy };
};

describe("waves", () => {
  test("branches that clash with nothing all go first; one waits a wave past the latest it clashes with", () => {
    const plan = waves(["a", "b", "c", "d"], [{ first: "a", then: "c", files: ["x.ts"] }, { first: "c", then: "d", files: ["y.ts"] }]);
    expect(plan).toEqual([
      [{ branch: "a", after: [] }, { branch: "b", after: [] }],
      [{ branch: "c", after: [{ branch: "a", files: ["x.ts"] }] }],
      [{ branch: "d", after: [{ branch: "c", files: ["y.ts"] }] }],
    ]);
  });

  test("a clash with one later in the order doesn't hold the earlier one back", () => {
    expect(waves(["a", "b"], [{ first: "b", then: "a", files: ["x.ts"] }])).toEqual([[{ branch: "a", after: [] }, { branch: "b", after: [] }]]);
  });
});

describe("clashIn", () => {
  const main = doc("const a = 1;\nx(1);\ny(1);");

  test("the same line both changed: the second clashes once the first lands", () => {
    const c = clashIn("a.ts", main, side(main, "const a = 1;\nx(2);\ny(1);"), side(main, "const a = 1;\nx(3);\ny(1);"));
    expect(c.map((x) => x.line)).toEqual(["L2"]);
  });

  test("lines git would call adjacent settle by line id: no clash", () => {
    expect(clashIn("a.ts", main, side(main, "const a = 1;\nx(2);\ny(1);"), side(main, "const a = 1;\nx(1);\ny(2);"))).toEqual([]);
  });

  test("a clash that isn't the pair's: the second already conflicts with main", () => {
    const moved = structuredClone(main);
    const second = side(main, "const a = 1;\nx(3);\ny(1);");
    apply(moved, diffToOps(moved.lines, "const a = 1;\nx(4);\ny(1);".split("\n")), "ana");
    expect(clashIn("a.ts", moved, side(moved, "const a = 1;\nx(4);\ny(2);"), second)).toEqual([]);
  });
});

describe("GET /api/repos/:o/:r/merge-plan", () => {
  test("two branches on one line go in two waves, as does one stacked on another; the rest merge with the first", async () => {
    const call = await boot({ GH_CLI: "off" });
    opened.push(call);
    const post = (user: string, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
    await post("ana", "/api/login", { name: "ana" });
    await post("ana", "/api/repos", { name: "r" });
    await post("ana", "/api/repos/ana/r/files", { path: "a.ts", content: "const a = 1;\nx(1);\ny(1);" });
    for (const b of ["b1", "b2", "b3", "b4"]) await post("ana", "/api/repos/ana/r/branches", { name: b });
    await post("ana", "/api/repos/ana/r/branches", { name: "b5", parent: "b3" });
    const edit = (branch: string, line: string, text: string) => post("ana", `/api/repos/ana/r/do/ops?path=a.ts&branch=${branch}`, { ops: [{ kind: "set", line, base: Number(line.slice(1)), text }] });
    await edit("b1", "L2", "x(2);");
    await edit("b2", "L2", "x(3);");
    await edit("b3", "L3", "y(2);");
    await post("ana", "/api/repos/ana/r/files", { path: "b.ts", content: "b", branch: "b4" });

    const r = await call("ana", "/api/repos/ana/r/merge-plan");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      order: ["b1", "b2", "b3", "b4", "b5"], held: [],
      waves: [
        [{ branch: "b1", after: [] }, { branch: "b3", after: [] }, { branch: "b4", after: [] }],
        [{ branch: "b2", after: [{ branch: "b1", files: ["a.ts"] }] }, { branch: "b5", after: [{ branch: "b3", files: [], stacked: true }] }],
      ],
    });
  });
});
