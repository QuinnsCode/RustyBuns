import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { apply, empty, fromText, type Doc } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { clashIn, waves } from "../src/merge-plan.ts";
import { local as boot } from "../src/local.ts";
import type { Exec } from "../src/agent-run.ts";

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

describe("a branch that clashed takes main in once its blocker merges (#1162)", () => {
  /** b1 and b2 change one line of a.ts; b2 changes y(1) too. */
  async function app(env: Record<string, string> = {}) {
    const call = await boot({ GH_CLI: "off", ...env });
    opened.push(call);
    const post = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
    await post("ana", "/api/login", { name: "ana" });
    await post("ana", "/api/repos", { name: "r" });
    await post("ana", "/api/repos/ana/r/files", { path: "a.ts", content: "const a = 1;\nx(1);\ny(1);" });
    for (const b of ["b1", "b2"]) await post("ana", "/api/repos/ana/r/branches", { name: b });
    const edit = (branch: string, line: string, text: string) => post("ana", `/api/repos/ana/r/do/ops?path=a.ts&branch=${branch}`, { ops: [{ kind: "set", line, base: Number(line.slice(1)), text }] });
    await edit("b1", "L2", "x(2);");
    await edit("b2", "L2", "x(3);");
    const read = async (branch?: string) => (await (await call("ana", `/api/repos/ana/r/do/file?path=a.ts${branch ? `&branch=${branch}` : ""}`)).json() as Doc).lines.map((l) => l.text).join("\n");
    const waits = async (b: string) => (await call.env.DB.prepare("SELECT waits_on FROM branches WHERE name = ?").bind(b).first() as { waits_on: string | null }).waits_on;
    return { call, post, edit, read, waits };
  }

  test("cards left: the branch is left as it was, for a person, and no longer waits", async () => {
    const { call, post, read, waits } = await app();
    await call("ana", "/api/repos/ana/r/merge-plan");
    expect(await waits("b2")).toBe('["b1"]');
    const r = await post("ana", "/api/repos/ana/r/branches/b1/merge", {});
    expect(r.status).toBe(200);
    expect((await r.json() as any).took).toEqual([{ branch: "b2", status: "cards", files: ["a.ts"], error: "conflicts" }]);
    expect(await read("b2")).toBe("const a = 1;\nx(3);\ny(1);");
    expect(await waits("b2")).toBeNull();
  });

  test("a checked agent settles the card: the branch takes main in, and then merges clean", async () => {
    const { call, post, edit, read } = await app({ HEAL: "1" });
    call.env.AGENT_EXEC = (async (_cmd, cwd) => { writeFileSync(join(cwd, "RESOLVE.ts"), "x(2);\nx(3);\n"); return { code: 0, out: "" }; }) as Exec;
    await post("ana", "/api/repos/ana/r/files", { path: ".gitattributes", content: "*.ts codesplitter-leftover=ai" });
    await edit("b2", "L3", "y(2);");
    const r = await (await post("ana", "/api/repos/ana/r/branches/b1/merge", {})).json() as any;
    expect(r.took).toEqual([{ branch: "b2", status: "updated", files: ["a.ts"] }]);
    expect(await read("b2")).toBe("const a = 1;\nx(2);\nx(3);\ny(2);");
    // Main's lines are under it now: the review shows only b2's own change, and it lands with no card.
    const review = await (await call("ana", "/api/repos/ana/r/branches/b2")).json() as any;
    expect(review.files.find((f: any) => f.path === "a.ts").conflicts).toEqual([]);
    expect((await post("ana", "/api/repos/ana/r/branches/b2/merge", {})).status).toBe(200);
    expect(await read()).toBe("const a = 1;\nx(2);\nx(3);\ny(2);");
  });

  test("checks run here: a branch waiting in the plan queues none on an edit, then one once its blocker merged", async () => {
    const { call, post, edit } = await app();
    await post("ana", "/api/repos/ana/r/checks/settings", { where: "here" }, "PUT");
    const runs = async (ref: string) => (await call.env.DB.prepare("SELECT COUNT(*) AS n FROM check_runs WHERE ref = ?").bind(ref).first() as { n: number }).n;
    await call("ana", "/api/repos/ana/r/merge-plan");
    await call.env.DB.prepare("DELETE FROM check_runs").run();
    await edit("b2", "L3", "y(2);");
    await Bun.sleep(200);
    expect(await runs("b2")).toBe(0);
    await post("ana", "/api/repos/ana/r/branches/b1/merge", {});
    expect(await runs("b2")).toBeGreaterThan(0);
  });
});
