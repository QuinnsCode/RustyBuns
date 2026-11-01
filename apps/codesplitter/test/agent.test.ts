import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text, type Doc } from "../src/lines.ts";
import { local as boot, type Call } from "../src/local.ts";
import { harnessCommand, blenderMcpFor, taskPrompt, HARNESSES } from "../src/harness.ts";
import { execCommand, runAgent, type Exec } from "../src/agent-run.ts";
import { GRANT_MS, LEASE_MS } from "../src/file-do.ts";

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const local = async () => { const c = await boot(); opened.push(c); return c; };

describe("harnessCommand", () => {
  test("every harness gets a binary and the prompt", () => {
    for (const h of HARNESSES) {
      const c = harnessCommand(h, "do it");
      expect(c.bin).toBeTruthy();
      expect(c.args.join(" ")).toContain("do it");
    }
  });
  test("claude is denied anything outside the working directory by its settings (#1656)", () => {
    const { args } = harnessCommand("claude", "do it");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    const { permissions } = JSON.parse(args[args.indexOf("--settings") + 1]!);
    expect(permissions.defaultMode).toBe("dontAsk");
    expect(permissions.allow.length).toBeGreaterThan(0);
    for (const rule of permissions.allow) expect(rule).toMatch(/^\w+\(\.\/\*\*\)$/);
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
  const claims = async (call: Call) => await (await call("ryan", `${file}/claims${q}`)).json() as { id: string; who: string; bot: boolean; lines: string[]; until: number | null }[];

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

  /** The file's live socket, as a page would open it: every message it gets. */
  const listen = async (call: Call) => {
    const ws = ((await call("ryan", `${file}/ws${q}`, { headers: { upgrade: "websocket" } })) as any).webSocket, got: any[] = [];
    ws.toBrowser = (d: string) => got.push(JSON.parse(d));
    return got;
  };
  const until = async (ok: () => boolean | Promise<boolean>, ms = 2000) => { for (const end = Date.now() + ms; !(await ok()) && Date.now() < end;) await Bun.sleep(10); return ok(); };

  test("an edit on a held line is a 409 naming the claim, who has it, and when to try again", async () => {
    const call = await local();
    await setup(call, "a\nb");
    await post(call, "agent-x", "claims", { id: "run-1", lines: ["L1"], task: "rename a" });
    const res = await post(call, "ryan", "ops", { ops: [{ kind: "set", line: "L1", base: 1, text: "x" }] });
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.claims).toMatchObject([{ id: "run-1", who: "agent-x", task: "rename a", lines: ["L1"] }]);
    expect(body.retryAfter).toBeGreaterThan(100);
    expect(body.retryAfter).toBeLessThanOrEqual(LEASE_MS / 1000);
    // A person's hold stands till lifted: there's no time to come back at.
    await post(call, "ryan", "claims", { lines: ["L2"] });
    expect(await (await post(call, "agent-x", "claims", { id: "run-2", lines: ["L2"] })).json()).toMatchObject({ claims: [{ who: "ryan", until: null }], retryAfter: null });
    // And release_claim lets go.
    expect(await (await post(call, "ryan", "release", { id: "run-1" })).json()).toEqual({ released: true });
    expect((await post(call, "ryan", "ops", { ops: [{ kind: "set", line: "L1", base: 1, text: "x" }] })).status).toBe(200);
  });

  test("an agent that dies holding lines frees them when its lease lapses, and the page hears unclaim from the alarm", async () => {
    const call = await local();
    await setup(call, "a\nb");
    const got = await listen(call);
    // It claims and is never heard from again: no edit, no renewal, no release.
    expect((await post(call, "agent-x", "claims", { id: "run-dead", lines: ["L1"], ttl: 50 })).status).toBe(201);
    expect(await until(() => got.some((m) => m.type === "unclaim" && m.id === "run-dead"))).toBe(true);
    expect((await post(call, "ryan", "ops", { ops: [{ kind: "set", line: "L1", base: 1, text: "free" }] })).status).toBe(200);
  });

  /** Two more agents on the crew, so three can take turns. */
  const crew = async (call: Call) => { for (const name of ["agent-y", "agent-z"]) await post(call, "ryan", "../collaborators", { name }); };
  const wait = (call: Call, user: string, body: unknown) => post(call, user, "claims", { wait: true, timeout: 0, ...body as object });

  test("agents waiting for held lines take turns in order, and one still asking gets them the moment they're free", async () => {
    const call = await local();
    await setup(call, "a\nb\nc");
    await crew(call);
    const got = await listen(call);
    await post(call, "agent-x", "claims", { id: "run-x", lines: ["L1", "L2"] });
    // Not waiting: refused, as ever.
    expect((await post(call, "agent-y", "claims", { id: "run-y", lines: ["L1"] })).status).toBe(409);
    const y = await wait(call, "agent-y", { id: "run-y", lines: ["L1"], task: "rename a" });
    expect(y.status).toBe(202);
    expect(await y.json()).toMatchObject({ queued: true, id: "run-y", place: 1, claims: [{ id: "run-x" }] });
    expect(await (await wait(call, "agent-z", { id: "run-z", lines: ["L1", "L3"] })).json()).toMatchObject({ queued: true, place: 2 });
    // L3 is free, but z is in line for L1 behind y, so it waits for both. And another agent can't take lines others are in line for.
    const cut = await post(call, "agent-x", "claims", { id: "run-x3", lines: ["L3"] });
    expect(cut.status).toBe(409);
    expect(await cut.json()).toMatchObject({ queued: 1 });
    // y asks again and waits; x lets go, and y's ask comes back with the claim.
    const asking = wait(call, "agent-y", { id: "run-y", timeout: 5 });
    await Bun.sleep(20);
    await post(call, "agent-x", "release", { id: "run-x" });
    const granted = await asking;
    expect(granted.status).toBe(201);
    expect(await granted.json()).toMatchObject({ id: "run-y", who: "agent-y", lines: ["L1"], task: "rename a", until: expect.any(Number) });
    expect((await claims(call)).find((c) => c.id === "run-y")!.until! - Date.now()).toBeGreaterThan(LEASE_MS - 5_000);
    // z's next: when y's done, z isn't asking, so it gets the lines for a grant window and hears so.
    await post(call, "agent-y", "release", { id: "run-y" });
    const z = (await claims(call)).find((c) => c.id === "run-z")!;
    expect(z).toMatchObject({ who: "agent-z", lines: ["L1", "L3"] });
    expect(z.until! - Date.now()).toBeLessThanOrEqual(GRANT_MS);
    expect(await until(() => got.some((m) => m.type === "grant" && m.claim.id === "run-z"))).toBe(true);
    // It takes them by claiming again by id: a lease like any other.
    expect(await (await post(call, "agent-z", "claims", { id: "run-z" })).json()).toMatchObject({ until: expect.any(Number) });
    expect((await claims(call))[0]!.until! - Date.now()).toBeGreaterThan(GRANT_MS);
  });

});

describe("word-level rebase (#928)", () => {
  const file = "/api/repos/ryan/r1/do", q = "?path=a.js";
  const post = (call: Call, user: string, body: unknown) => call(user, `${file}/ops${q}`, { method: "POST", body: JSON.stringify(body) });
  const doc = async (call: Call) => await (await call("ryan", `${file}/file${q}`)).json() as Doc;
  const set = (text: string, base = 1) => ({ ops: [{ kind: "set", line: "L1", base, text }] });

  test("two agents changing different words of one line both land, the second blamed on its sender", async () => {
    const call = await local();
    await setup(call, "const total = add(a, b)\nnext");
    expect((await post(call, "ryan", set("const sum = add(a, b)"))).status).toBe(200);
    // agent-x still had rev 1: its edit is stale, but touches other words.
    const res = await post(call, "agent-x", set("const total = add(a, c)"));
    expect(res.status).toBe(200);
    const d = await doc(call);
    expect(text(d)).toBe("const sum = add(a, c)\nnext");
    expect(d.lines[0]).toMatchObject({ by: "agent-x", rev: d.rev });
  });

  test("overlapping words, a pinned rev, or a line set twice in one batch: still a 409", async () => {
    const call = await local();
    await setup(call, "foo(1)\nnext");
    expect((await post(call, "ryan", set("foo(2)"))).status).toBe(200);
    const clash = await post(call, "agent-x", set("foo(3)"));
    expect(clash.status).toBe(409);
    expect((await clash.json() as any).conflicts[0].reason).toContain("not 1");
    expect((await post(call, "agent-x", { ...set("bar(1)"), ifRev: 1 })).status).toBe(409);
    expect((await post(call, "agent-x", { ops: [set("bar(1)").ops[0], { kind: "set", line: "L1", base: 1, text: "baz(1)" }] })).status).toBe(409);
    // The same edit sent again adds nothing: stale, not a no-op write.
    expect((await post(call, "ryan", set("foo(2)"))).status).toBe(409);
    expect(text(await doc(call))).toBe("foo(2)\nnext");
  });

});

describe("agentEnv", () => {
  test("a CLI run on this machine gets the shell's basics and its own login, not the server's secrets", async () => {
    const { agentEnv } = await import("../src/agent-run.ts");
    const env = agentEnv({ PATH: "/bin", HOME: "/h", LANG: "C", ANTHROPIC_API_KEY: "a", CLAUDE_CODE_OAUTH_TOKEN: "o", OPENAI_API_KEY: "k", OPENCODE_CONFIG_CONTENT: "{}",
      BETTER_AUTH_SECRET: "s", DEPLOY_SECRETS_KEY: "d", CLOUDFLARE_API_TOKEN: "c", DATABASE_URL: "postgres://x", OP_SERVICE_ACCOUNT_TOKEN: "op", AWS_ACCESS_KEY_ID: "aws", GH_TOKEN: "g", UNDEFINED: undefined });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", LANG: "C", ANTHROPIC_API_KEY: "a", CLAUDE_CODE_OAUTH_TOKEN: "o", OPENAI_API_KEY: "k", OPENCODE_CONFIG_CONTENT: "{}" });  // a GH_TOKEN comes in cmd.env on the runs the owner gave an agent account (#1428), never from the shell
    const { out } = await execCommand({ bin: "sh", args: ["-c", "echo [$RB_TEST_SECRET][$HOME]"], env: {} }, tmpdir());
    expect(out.trim()).toBe(`[][${process.env.HOME}]`);
  });
});

describe("the user's Blender MCP (#3055)", () => {
  const cfg = JSON.stringify({ mcpServers: { blender: { command: "uvx", args: ["blender-mcp"] }, "bad name!": {} } });
  const env = { CODESPLITTER_BLENDER_MCP: "/home/u/blender.json", CODESPLITTER_BLENDER_MCP_REPOS: "ana/models, ana/other" };
  const read = async () => cfg;
  test("off unless the user turned it on for that repo", async () => {
    expect(await blenderMcpFor({}, "ana", "models", read)).toBeUndefined();
    expect(await blenderMcpFor({ CODESPLITTER_BLENDER_MCP: env.CODESPLITTER_BLENDER_MCP }, "ana", "models", read)).toBeUndefined();
    expect(await blenderMcpFor(env, "ana", "elsewhere", read)).toBeUndefined();
    expect(await blenderMcpFor(env, "ana", "models", async () => null)).toBeUndefined();
    expect(await blenderMcpFor(env, "ana", "models", async () => "not json")).toBeUndefined();
  });
  test("claude gets the config and only that server's tools; the file tools stay", async () => {
    const mcp = await blenderMcpFor(env, "ana", "models", read);
    expect(mcp).toEqual({ config: "/home/u/blender.json", servers: ["blender"] });
    const { args } = harnessCommand("claude", "do it", { mcp });
    expect(args[args.indexOf("--mcp-config") + 1]).toBe("/home/u/blender.json");
    expect(args).toContain("--strict-mcp-config");
    expect(JSON.parse(args[args.indexOf("--settings") + 1]!).permissions.allow).toContain("mcp__blender");
    expect(harnessCommand("claude", "do it").args).not.toContain("--mcp-config");
  });
});
