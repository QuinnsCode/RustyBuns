import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { text, type Doc } from "../src/lines.ts";
import { local as boot, type Call } from "../src/local.ts";
import { harnessCommand, taskPrompt, HARNESSES } from "../src/harness.ts";
import { runAgent, toDisk, fromDisk, type Exec } from "../src/agent-run.ts";

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const local = async () => { const c = await boot(); opened.push(c); return c; };

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
    expect(p).not.toContain("someone else");
  });
  test("a re-run prompt lists the lines that moved and says to keep them", () => {
    const p = taskPrompt("a.ts", "x", [
      { op: { kind: "set", line: "L1", base: 1, text: "mine" }, now: { id: "L1", text: "theirs", by: "ryan", rev: 5 } },
      { op: { kind: "delete", line: "L2", base: 2 }, now: null },
    ]);
    expect(p).toContain(`"theirs" (changed by ryan; you had "mine")`);
    expect(p).toContain("a line you changed was deleted by someone else");
    expect(p).toContain("Keep their changes");
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

  const humanSets = (call: Call, text: string) => async () => {
    const doc = await (await call("ryan", "/api/repos/ryan/r1/do/file?path=a.js")).json() as Doc;
    const res = await call("ryan", "/api/repos/ryan/r1/do/ops?path=a.js", { method: "POST", body: JSON.stringify({ ops: [{ kind: "set", line: "L1", base: doc.lines[0]!.rev, text }] }) });
    expect(res.ok).toBe(true);
  };

  test("a line a human changed while the agent worked: the agent re-runs on the new text and keeps the human's change", async () => {
    const call = await local();
    await setup(call, "a\nb\nc");
    const prompts: string[] = [];
    const r = await runAgent(call, {
      user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "codex", task: "uppercase the first two lines",
      exec: async (cmd, cwd) => {
        prompts.push(cmd.args.join(" "));
        if (prompts.length === 1) {
          await humanSets(call, "human")(); // a human edits line 1 while the agent is still working
          writeFileSync(join(cwd, "a.js"), "A\nB\nc\n");
        } else {
          // The re-run sees the human's line and B already landed; it finishes on top.
          expect(readFileSync(join(cwd, "a.js"), "utf8")).toBe("human\nB\nc\n");
          writeFileSync(join(cwd, "a.js"), "HUMAN\nB\nc\n");
        }
        return { code: 0, out: "" };
      },
    });
    expect(r.runs).toBe(2);
    expect(r.conflicts).toEqual([]);
    expect(prompts[0]).not.toContain("someone else changed");
    expect(prompts[1]).toContain(`"human" (changed by ryan; you had "A")`);
    const doc = await (await call("ryan", "/api/repos/ryan/r1/do/file?path=a.js")).json() as Doc;
    expect(text(doc)).toBe("HUMAN\nB\nc");
  });

  test("with no retries, the human's version is kept and the conflict is reported line by line", async () => {
    const call = await local();
    await setup(call, "a\nb\nc");
    const r = await runAgent(call, {
      user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "codex", task: "rewrite", retries: 0,
      exec: async (_cmd, cwd) => {
        await humanSets(call, "human")();
        writeFileSync(join(cwd, "a.js"), "A\nB\nc\n");
        return { code: 0, out: "" };
      },
    });
    expect(r.runs).toBe(1);
    expect(r.conflicts).toEqual([{ op: { kind: "set", line: "L1", base: 1, text: "A" }, now: { id: "L1", text: "human", by: "ryan", rev: 4 } }]);
    const doc = await (await call("ryan", "/api/repos/ryan/r1/do/file?path=a.js")).json() as Doc;
    expect(text(doc)).toBe("human\nB\nc");
  });

  test("a human who keeps changing the line wins after the last re-run", async () => {
    const call = await local();
    await setup(call, "a\nb");
    let n = 0;
    const r = await runAgent(call, {
      user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "claude", task: "rewrite", retries: 1,
      exec: async (_cmd, cwd) => {
        await humanSets(call, `human ${++n}`)();
        writeFileSync(join(cwd, "a.js"), "AGENT\nb\n");
        return { code: 0, out: "" };
      },
    });
    expect(r.runs).toBe(2);
    expect(r.conflicts.map((c) => c.now?.text)).toEqual(["human 2"]);
    const doc = await (await call("ryan", "/api/repos/ryan/r1/do/file?path=a.js")).json() as Doc;
    expect(text(doc)).toBe("human 2\nb");
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
