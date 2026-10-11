import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text, type Doc } from "../src/lines.ts";
import { local as boot, type Call } from "../src/local.ts";
import { harnessCommand, taskPrompt, HARNESSES } from "../src/harness.ts";
import { execCommand, runAgent, toDisk, fromDisk, type Exec } from "../src/agent-run.ts";

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const local = async () => { const c = await boot(); opened.push(c); return c; };

describe("disk text", () => {
  test("round-trips lines, including an empty file", () => {
    for (const s of ["a\nb", "", "one"]) expect(toDisk(fromDisk(s).map((text) => ({ text })))).toBe(s === "" ? "" : s + "\n");
    expect(fromDisk("a\nb\n")).toEqual(["a", "b"]);
  });
});

describe("execCommand", () => {
  test("the CLI sees the scratch dir as both cwd and $PWD (opencode reads $PWD)", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "cs-exec-")));
    const { code, out } = await execCommand({ bin: process.execPath, args: ["-e", "console.log(process.cwd() + ' ' + process.env.PWD)"] }, dir);
    expect(code).toBe(0);
    expect(out.trim()).toBe(`${dir} ${dir}`);
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
  test("pi gets only the file tools, no bash", () => {
    const { args } = harnessCommand("pi", "do it");
    expect(args[args.indexOf("--tools") + 1]).toBe("read,edit,write");
    expect(args).toContain("--no-extensions");
    expect(args).toContain("--no-mcp");
  });
  test("opencode denies everything but file tools in the working directory", () => {
    const { args, env } = harnessCommand("opencode", "do it");
    expect(args).toContain("--pure");
    const { permission } = JSON.parse(env!.OPENCODE_CONFIG_CONTENT!);
    expect(permission["*"]).toBe("deny");
    expect(permission.external_directory).toBe("deny");
    expect(permission.bash).toBeUndefined();
    expect(permission.edit).toBe("allow");
  });
  test("execCommand passes the harness env to the CLI", async () => {
    const r = await execCommand({ bin: "sh", args: ["-c", "echo $OPENCODE_CONFIG_CONTENT"], env: { OPENCODE_CONFIG_CONTENT: "{}" } }, tmpdir());
    expect(r.out.trim()).toBe("{}");
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

describe("claims", () => {
  const file = "/api/repos/ryan/r1/do", q = "?path=a.js";
  const post = (call: Call, user: string, route: string, body: unknown) => call(user, `${file}/${route}${q}`, { method: "POST", body: JSON.stringify(body) });
  const doc = async (call: Call) => await (await call("ryan", `${file}/file${q}`)).json() as Doc;
  const claims = async (call: Call) => await (await call("ryan", `${file}/claims${q}`)).json() as { id: string; who: string; bot: boolean; lines: string[] }[];

  test("an agent given lines holds them while it works, and lets go when it's done", async () => {
    const call = await local();
    await setup(call, "a\nb\nc");
    let during: Response | undefined;
    const r = await runAgent(call, {
      user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "claude", task: "uppercase a", lines: ["L1"], claim: "run-1",
      exec: async (_cmd, cwd) => {
        during = await post(call, "ryan", "ops", { ops: [{ kind: "set", line: "L1", base: 1, text: "mine" }] });
        writeFileSync(join(cwd, "a.js"), "A\nb\nc\n");
        return { code: 0, out: "" };
      },
    });
    expect(during!.status).toBe(409);
    expect(((await during!.json()) as any).conflicts[0]).toMatchObject({ reason: "held by @agent-x: uppercase a", claim: "run-1" });
    expect(r.applied).toBe(1);
    expect(text(await doc(call))).toBe("A\nb\nc");
    expect(await claims(call)).toEqual([]);
  });

  test("a person's hold keeps an agent off those lines; its other edits land, and it doesn't re-run for them", async () => {
    const call = await local();
    await setup(call, "a\nb");
    expect((await post(call, "ryan", "claims", { lines: ["L1"] })).status).toBe(201);
    const r = await runAgent(call, {
      user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "codex", task: "uppercase",
      exec: editor("a.js", "A\nB\n"),
    });
    expect(r.runs).toBe(1);
    expect(r.conflicts).toMatchObject([{ held: "held by @ryan", now: { text: "a" } }]);
    expect(text(await doc(call))).toBe("a\nB");
  });

  test("an agent can't start on lines someone holds", async () => {
    const call = await local();
    await setup(call, "a\nb");
    await post(call, "ryan", "claims", { lines: ["L2"] });
    await expect(runAgent(call, {
      user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "pi", task: "x", lines: ["L1", "L2"],
      exec: editor("a.js", "x\n"),
    })).rejects.toThrow("held by @ryan");
  });

  test("a claim follows its lines, any of the crew can lift it, and two agents of one harness can't write in each other's", async () => {
    const call = await local();
    await setup(call, "a\nb\nc");
    const one = await (await post(call, "agent-x", "claims", { id: "run-1", lines: ["L1", "L2"] })).json() as any;
    expect(one).toMatchObject({ who: "agent-x", bot: true, until: expect.any(Number) });
    expect((await post(call, "agent-x", "claims", { id: "run-2", lines: ["L2", "L3"] })).status).toBe(409);
    // Same name, no claim id: someone else's run.
    expect((await post(call, "agent-x", "ops", { ops: [{ kind: "set", line: "L1", base: 1, text: "x" }] })).status).toBe(409);
    expect((await post(call, "agent-x", "ops", { claim: "run-1", ops: [{ kind: "insert", after: "L1", text: "new" }, { kind: "delete", line: "L2", base: 2 }] })).status).toBe(200);
    expect((await claims(call))[0]!.lines.sort()).toEqual(["L1", "L4"]);
    expect(await (await post(call, "ryan", "claims", { id: "run-1", release: true })).json()).toEqual({ released: true });
    expect(await claims(call)).toEqual([]);
  });

  test("a thousand agents each on a line of their own", async () => {
    const call = await local();
    await setup(call, Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n"));
    const ids = (await doc(call)).lines.map((l) => l.id);
    const res = await Promise.all(ids.map((id, i) => post(call, "agent-x", "claims", { id: `run-${i}`, lines: [id] })));
    expect(res.every((r) => r.status === 201)).toBe(true);
    const edits = await Promise.all(ids.map((id, i) => post(call, "agent-x", "ops", { claim: `run-${i}`, ops: [{ kind: "set", line: id, base: i + 1, text: `agent ${i}` }] })));
    expect(edits.every((r) => r.ok)).toBe(true);
    expect((await claims(call)).length).toBe(1000);
  });
});
