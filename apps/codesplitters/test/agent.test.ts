import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { apply, empty, fromText, text, type Doc } from "../src/lines.ts";
import { local as boot, type Call } from "../src/local.ts";
import { diffToOps, rebase } from "../src/sync.ts";
import { harnessCommand, taskPrompt, HARNESSES } from "../src/harness.ts";
import { runAgent, toDisk, fromDisk, type Exec } from "../src/agent-run.ts";

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const local = async () => { const c = await boot(); opened.push(c); return c; };

/** A doc built from `start` through the real op path, so ids and revs are the app's own. */
function docFrom(start: string): Doc {
  const doc = empty();
  apply(doc, fromText(start), "owner");
  return doc;
}

describe("diffToOps", () => {
  const cases: [string, string][] = [
    ["a\nb\nc", "a\nb\nc"],
    ["a\nb\nc", "a\nX\nc"],
    ["a\nb\nc", "top\na\nb\nc"],
    ["a\nb\nc", "a\nb\nc\nend"],
    ["a\nb\nc", "a\nc"],
    ["a\nb\nc\nd", "a\nB\nc"],
    ["a\nb", "x\ny\nz\nb"],
    ["a\nb\nc\nd\ne", "a\nq\nr\nd\nf\ng"],
    ["a\nb\nc", "z\nw"],
    ["a", ""],
    ["", "new\nfile"],
    ["", ""],
  ];
  for (const [start, next] of cases) {
    test(`applying the ops turns ${JSON.stringify(start)} into ${JSON.stringify(next)}`, () => {
      const doc = docFrom(start);
      const ops = diffToOps(doc.lines, next === "" ? [] : next.split("\n"));
      const r = apply(doc, ops, "agent");
      expect(r.ok).toBe(true);
      expect(text(doc)).toBe(next);
    });
  }

  test("a changed line keeps its id, so blame still names the original author", () => {
    const doc = docFrom("a\nb\nc");
    const ops = diffToOps(doc.lines, ["a", "B", "c"]);
    expect(ops).toEqual([{ kind: "set", line: "L2", base: 2, text: "B" }]);
  });
});

describe("rebase", () => {
  test("drops ops on lines another writer has moved past, keeps the rest", () => {
    const doc = docFrom("a\nb\nc");
    const ops = diffToOps(doc.lines, ["A", "B", "c"]);
    // Someone else changes line 1 while the agent works.
    apply(doc, [{ kind: "set", line: "L1", base: 1, text: "mine" }], "human");
    const r = rebase(ops, doc);
    expect(r.skipped).toEqual([{ kind: "set", line: "L1", base: 1, text: "A" }]);
    expect(apply(doc, r.ops, "agent").ok).toBe(true);
    expect(text(doc)).toBe("mine\nB\nc");
  });

  test("drops an insert whose anchor line was deleted meanwhile", () => {
    const doc = docFrom("a\nb");
    const ops = diffToOps(doc.lines, ["a", "x", "b"]);
    apply(doc, [{ kind: "delete", line: "L1", base: 1 }], "human");
    expect(rebase(ops, doc).skipped.length).toBe(1);
  });
});

describe("disk text", () => {
  test("round-trips lines, including an empty file", () => {
    for (const s of ["a\nb", "", "one"]) expect(toDisk(fromDisk(s).map((text) => ({ text })))).toBe(s === "" ? "" : s + "\n");
    expect(fromDisk("a\nb\n")).toEqual(["a", "b"]);
  });
});

describe("harnessCommand", () => {
  test("every harness gets a binary and the prompt", () => {
    for (const h of HARNESSES) {
      const c = harnessCommand(h, "do it");
      expect(c.bin).toBeTruthy();
      expect(c.args.join(" ")).toContain("do it");
    }
  });
  test("the task prompt names the file and forbids git", () => {
    const p = taskPrompt("src/a.ts", "rename foo");
    expect(p).toContain("src/a.ts");
    expect(p).toContain("rename foo");
    expect(p).toContain("Do not run git");
  });
});

// Build a repo with one file and an agent collaborator, through the app's own API.
async function setup(call: Call, start: string) {
  const post = (user: string, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  await post("ryan", "/api/login", { name: "ryan" });
  await post("ryan", "/api/repos", { name: "r1", visibility: "public" });
  await post("ryan", "/api/repos/ryan/r1/collaborators", { name: "agent-x" });
  await post("ryan", "/api/repos/ryan/r1/files", { path: "a.js", content: start });
}

/** A stand-in CLI: it edits the file in its working directory, the way a real agent would. */
const editor = (path: string, next: string): Exec => async (_cmd, cwd) => {
  writeFileSync(join(cwd, path), next);
  return { code: 0, out: "done" };
};

describe("runAgent", () => {
  test("an agent's edit lands as line ops, attributed to the agent", async () => {
    const call = await local();
    await setup(call, "var x = 1\nfunction f() {\n  return x\n}");
    const r = await runAgent(call, {
      user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "claude", task: "use let",
      exec: editor("a.js", "let x = 1\nfunction f() {\n  return x\n}\n// added\n"),
    });
    expect(r.changed).toBe(true);
    expect(r.applied).toBeGreaterThan(0);
    const doc = await (await call("ryan", "/api/repos/ryan/r1/do/file?path=a.js")).json() as Doc;
    expect(text(doc)).toBe("let x = 1\nfunction f() {\n  return x\n}\n// added");
    expect(doc.lines[0]!.by).toBe("agent-x");
    expect(doc.lines[1]!.by).toBe("ryan"); // untouched lines keep their author
  });

  test("a file the agent did not change posts nothing", async () => {
    const call = await local();
    await setup(call, "keep\nme");
    const r = await runAgent(call, {
      user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "pi", task: "nothing",
      exec: editor("a.js", "keep\nme\n"),
    });
    expect(r.changed).toBe(false);
    expect(r.applied).toBe(0);
  });

  test("a line a human changed while the agent worked is skipped, and the rest lands", async () => {
    const call = await local();
    await setup(call, "a\nb\nc");
    const r = await runAgent(call, {
      user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "codex", task: "rewrite",
      exec: async (_cmd, cwd) => {
        // A human edits line 1 while the agent is still working.
        await call("ryan", "/api/repos/ryan/r1/do/ops?path=a.js", { method: "POST", body: JSON.stringify({ ops: [{ kind: "set", line: "L1", base: 1, text: "human" }] }) });
        writeFileSync(join(cwd, "a.js"), "A\nB\nc\n");
        return { code: 0, out: "" };
      },
    });
    expect(r.skipped.map((o) => o.kind)).toEqual(["set"]);
    const doc = await (await call("ryan", "/api/repos/ryan/r1/do/file?path=a.js")).json() as Doc;
    expect(text(doc)).toBe("human\nB\nc");
  });

  test("a CLI that exits non-zero posts nothing and reports its output", async () => {
    const call = await local();
    await setup(call, "a");
    await expect(runAgent(call, {
      user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "opencode", task: "x",
      exec: async () => ({ code: 1, out: "no model configured" }),
    })).rejects.toThrow("opencode exited 1");
    const doc = await (await call("ryan", "/api/repos/ryan/r1/do/file?path=a.js")).json() as Doc;
    expect(text(doc)).toBe("a");
  });
});
