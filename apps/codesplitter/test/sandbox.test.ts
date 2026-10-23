import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { text, type Doc } from "../src/lines.ts";
import { local as boot, type Call } from "../src/local.ts";
import { AgentSandbox, LOGINS, type ContainerApi } from "../src/sandbox.ts";
import { STAND_IN } from "../src/egress.ts";
import { gated } from "./fake-gate.ts";
// @ts-expect-error plain .mjs, no types: it is the server inside the container image
import { run, test as testCut } from "../sandbox/server.mjs";

// These run the app end to end (real git, password hashes, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

describe("the container's server", () => {
  test("runs the command beside the file, in its own directory, and hands back what it left", async () => {
    const r = await run({ cmd: { bin: "sh", args: ["-c", "pwd > /dev/null && printf 'x\\nY\\n' > src/a.js && echo done"] }, path: "src/a.js", text: "x\ny\n" });
    expect(r).toEqual({ code: 0, out: "done\n", text: "x\nY\n" });
  });
  test("a removed file comes back as null; a missing CLI as exit 127", async () => {
    expect((await run({ cmd: { bin: "rm", args: ["a.js"] }, path: "a.js", text: "x\n" })).text).toBeNull();
    expect((await run({ cmd: { bin: "no-such-agent-cli", args: [] }, path: "a.js", text: "" })).code).toBe(127);
  });
  test("a fix task's other files go in beside it, and come back as it left them (#1037)", async () => {
    const r = await run({ cmd: { bin: "sh", args: ["-c", "cat a.js test/a.test.js && echo z > test/a.test.js && rm b.js"] }, path: "a.js", text: "a\n", also: { "test/a.test.js": "t\n", "b.js": "b\n" } });
    expect(r).toEqual({ code: 0, out: "a\nt\n", text: "a\n", also: { "test/a.test.js": "z\n", "b.js": null } });
  });
  test("a path that climbs out of the directory is refused", async () => {
    expect((await run({ cmd: { bin: "true", args: [] }, path: "../escape.js", text: "" })).code).toBe(2);
    expect((await run({ cmd: { bin: "true", args: [] }, path: "a.js", text: "", also: { "../escape.js": "" } })).code).toBe(2);
    expect((await testCut({ files: { "../escape.test.ts": "" } })).code).toBe(2);
  });
  test("a symlink or fifo left in place of a file isn't read back: the server is root, the agent and the repo's code aren't", async () => {
    // /proc/1/environ in the container: the agent's logins. A file outside the directory stands in for it here.
    const outside = `${import.meta.dir}/fixtures-secret-${process.pid}.txt`;
    await Bun.write(outside, "ANTHROPIC_API_KEY=sk-ant-not-yours\n");
    try {
      const r = await run({ cmd: { bin: "sh", args: ["-c", `ln -sf ${outside} a.js && rm b.js && mkfifo b.js`] }, path: "a.js", text: "x\n", also: { "b.js": "b\n" } });
      expect(r).toMatchObject({ code: 0, text: null, also: { "b.js": null } });
      const through = await run({ cmd: { bin: "sh", args: ["-c", `rm -r d && ln -s ${import.meta.dir} d`] }, path: "a.js", text: "x\n", also: { [`d/${outside.split("/").pop()}`]: "y\n" } });
      expect(through.also).toEqual({ [`d/${outside.split("/").pop()}`]: null });
    } finally { await Bun.file(outside).delete(); }
  });
  test("runs bun test over a cut's files, with a JUnit report", async () => {
    const r = await testCut({ files: { "a.test.ts": 'import { expect, test } from "bun:test";\ntest("one", () => expect(1).toBe(1));\n' } });
    expect(r.code).toBe(0);
    expect(r.report).toContain('<testcase name="one"');
  });
});

/** A stand-in for `ctx.container`: its port answers with `server`, after `bootFails` refused connections. */
function fakeContainer(server: (body: any) => Promise<unknown>, bootFails = 0) {
  const seen = { started: null as null | { env?: Record<string, string> }, destroyed: 0, tries: 0 };
  let running = false;
  const c: ContainerApi = {
    get running() { return running; },
    start(opts) { running = true; seen.started = opts ?? {}; },
    async destroy() { running = false; seen.destroyed++; },
    getTcpPort: () => ({
      async fetch(_url, init) {
        if (++seen.tries <= bootFails) throw new Error("connection refused");
        return Response.json(await server(JSON.parse(String(init!.body))));
      },
    }),
  };
  return { c, seen };
}

describe("AgentSandbox", () => {
  test("starts the container, waits for its server, and stops it after the run", async () => {
    const { c, seen } = fakeContainer(run, 2);
    const env: any = { ANTHROPIC_API_KEY: "sk-a", OPENAI_API_KEY: "", GITHUB_TOKEN: "not-for-agents" };
    const res = await new AgentSandbox(gated(c), env).fetch(new Request("http://sandbox/run", {
      method: "POST", body: JSON.stringify({ cmd: { bin: "sh", args: ["-c", "echo B >> a.js"] }, path: "a.js", text: "A\n" }),
    }));
    expect(await res.json()).toEqual({ code: 0, out: "", text: "A\nB\n" });
    expect(seen.started?.env).toEqual({});   // not a harness: no logins at all
    expect(LOGINS).not.toContain("GITHUB_TOKEN" as any);
    expect(seen.tries).toBe(3);
    expect(seen.destroyed).toBe(1);
  });
  test("a run only gets its own harness's logins that are set", async () => {
    const env: any = { ANTHROPIC_API_KEY: "sk-a", CLAUDE_CODE_OAUTH_TOKEN: "oat", OPENAI_API_KEY: "sk-o", CODEX_API_KEY: "" };
    const started = async (bin: string) => {
      const { c, seen } = fakeContainer(async () => ({ code: 0, out: "", text: "" }));
      await new AgentSandbox(gated(c), env).fetch(new Request("http://sandbox/run", { method: "POST", body: JSON.stringify({ cmd: { bin, args: [] }, path: "a.js", text: "" }) }));
      return seen.started?.env;
    };
    expect(await started("claude")).toEqual({ ANTHROPIC_API_KEY: "sk-a" });   // never the subscription login (#559)
    expect(await started("codex")).toEqual({ OPENAI_API_KEY: STAND_IN });   // proxied: the gate holds the real one (#1655)
  });
});

describe("POST /api/repos/:o/:r/agents with AGENT_SANDBOX bound", () => {
  const origin = "http://codesplitter.local";
  /** The app with accounts on and AGENT_SANDBOX bound to containers that run `server`. */
  async function hosted(server: (body: any) => Promise<unknown>) {
    const booted = await boot({ GH_CLI: "off", BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: origin, ADMINS: "ryan-quinn" });
    opened.push(booted);
    const runs: any[] = [], containers: ReturnType<typeof fakeContainer>["seen"][] = [];
    booted.env.AGENT_SANDBOX = {
      idFromName: (n: string) => n,
      get: () => {
        const { c, seen } = fakeContainer(async (b) => { runs.push(b); return server(b); });
        containers.push(seen);
        return new AgentSandbox(gated(c), booted.env);
      },
    };
    // Each handle's session cookie, from signing up and claiming it.
    const cookies: Record<string, string> = {};
    const signup = async (name: string) => {
      const res = await booted(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email: `${name.replace(" ", ".")}@example.com`.toLowerCase(), password: "correct horse battery", name }) });
      const handle = name.toLowerCase().replace(" ", "-");
      cookies[handle] = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")!]).map((c) => c.split(";")[0]).join("; ");
      await booted(null, "/api/handle", { method: "POST", headers: { cookie: cookies[handle]! }, body: JSON.stringify({ name: handle }) });
    };
    for (const name of ["Ryan Quinn", "Pat Person", "Sam Sample"]) await signup(name);
    const call: Call = (user, url, init = {}) => {
      const headers = new Headers(init.headers);
      if (user) headers.set("cookie", cookies[user]!);
      return booted(null, url, { ...init, headers });
    };
    const post = (user: string, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
    await post("ryan-quinn", "/api/repos", { name: "r1", visibility: "public" });
    await post("ryan-quinn", "/api/repos/ryan-quinn/r1/collaborators", { name: "pat-person" });
    await post("ryan-quinn", "/api/repos/ryan-quinn/r1/files", { path: "src/a.js", content: "var x = 1\nf()" });
    return { call, post, runs, containers, env: booted.env };
  }
  const doc = async (call: Call) => await (await call("ryan-quinn", "/api/repos/ryan-quinn/r1/do/file?path=src/a.js")).json() as Doc;
  /** Starts a run (it answers at once, the agent riding the JOBS queue) and waits for it to end, as the phone page polls. */
  const finished = async (call: Call, body: unknown) => {
    const res = await call("ryan-quinn", "/api/repos/ryan-quinn/r1/agents", { method: "POST", body: JSON.stringify(body) });
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: number };
    for (const end = performance.now() + 15_000; performance.now() < end; await Bun.sleep(20)) {
      const run = ((await (await call("ryan-quinn", "/api/repos/ryan-quinn/r1/agents")).json()) as any[]).find((r) => r.id === id);
      if (run.status !== "running") return run;
    }
    throw new Error("the run never ended");
  };

  test("every harness is offered, even where Bun can't run CLIs: codex and pi behind the key-adding gate (#1655)", async () => {
    const { call } = await hosted(async (b) => b);
    expect(await (await call(null, "/api/agents")).json()).toMatchObject({ available: true, harnesses: ["claude", "codex", "pi", "opencode"] });
  });

  test("the owner gives an agent a task; it runs in a container off the queue, and its lines are blamed on it", async () => {
    const { call, runs } = await hosted(async (b) => ({ code: 0, out: "ok", text: b.text.replace("var", "let") }));
    const run = await finished(call, { harness: "opencode", path: "src/a.js", task: "use let" });
    expect(run).toMatchObject({ agent: "agent-opencode", status: "done", applied: 1, conflicts: [], pending: { branch: `agent-run-${run.id}` } });
    expect(runs[0].cmd.bin).toBe("opencode");
    expect(runs[0].cmd.env.OPENCODE_CONFIG_CONTENT).toContain("deny"); // the harness's own limits reach the container
    expect(runs[0].text).toBe("var x = 1\nf()\n");
    // Its batch waits on main as a ghost diff; accepted, it lands.
    expect(text(await doc(call))).toBe("var x = 1\nf()");
    expect((await call("ryan-quinn", `/api/repos/ryan-quinn/r1/agents/${run.id}/accept`, { method: "POST" })).status).toBe(200);
    const d = await doc(call);
    expect(text(d)).toBe("let x = 1\nf()");
    expect(d.lines.map((l) => l.by)).toEqual(["agent-opencode", "ryan-quinn"]);
  });

  test("an agent works on GitHub as the account its owner picked for agents, never as the one they dig as", async () => {
    const { call, post, runs, env } = await hosted(async (b) => ({ code: 0, out: "", text: b.text }));
    const authId = (await env.DB.prepare("SELECT auth_id FROM users WHERE name = 'ryan-quinn'").first())!.auth_id as string;
    for (const [id, at] of [["bot", "2026-01-01"], ["mine", "2026-02-01"]]) await env.DB.prepare(`INSERT INTO account (id, accountId, providerId, userId, accessToken, createdAt, updatedAt) VALUES (?, ?, 'github', ?, ?, ?, ?)`)
      .bind(id, id + "-gh", authId, `tok-${id}`, at, at).run();
    const start = (harness = "claude") => finished(call, { harness, path: "src/a.js", task: "x" });
    // None picked: no token, though "mine" digs.
    expect((await start()).github).toBeUndefined();
    expect(runs.at(-1).cmd.env?.GH_TOKEN).toBeUndefined();
    // A harness with no shell has nothing to use it with, so with a bot picked it still gets none (#1428).
    expect((await post("ryan-quinn", "/api/github/agent", { id: "bot" })).status).toBe(200);
    expect((await start()).github).toBeUndefined();
    expect(runs.at(-1).cmd.env?.GH_TOKEN).toBeUndefined();
    // codex has a shell, so it gets one, but only a stand-in: the gate adds the real token (#1655).
    expect((await start("codex")).github).toBe(true);
    expect(runs.at(-1).cmd.env).toMatchObject({ GH_TOKEN: STAND_IN, GITHUB_TOKEN: STAND_IN });
    expect(JSON.stringify(runs.at(-1))).not.toContain("tok-bot");
    // Only your own GitHubs, only signed in; null goes back to none.
    expect((await post("ryan-quinn", "/api/github/agent", { id: "someone-elses" })).status).toBe(404);
    expect((await post("pat-person", "/api/github/agent", { id: "bot" })).status).toBe(404);
    expect((await call(null, "/api/github/agent", { method: "POST", body: JSON.stringify({ id: "bot" }) })).status).toBe(401);
    expect((await post("ryan-quinn", "/api/github/agent", { id: null })).status).toBe(200);
    await start();
    expect(runs.at(-1).cmd.env?.GH_TOKEN).toBeUndefined();
  });

  test("only the owner starts one", async () => {
    const { post } = await hosted(async (b) => ({ code: 0, out: "", text: b.text }));
    expect((await post("pat-person", "/api/repos/ryan-quinn/r1/agents", { harness: "pi", path: "src/a.js", task: "x" })).status).toBe(403);
  });

  test("an owner who isn't in ADMINS can't start one: it bills the site's keys", async () => {
    const { post, env } = await hosted(async (b) => ({ code: 0, out: "", text: b.text }));
    await post("sam-sample", "/api/repos", { name: "mine", visibility: "public" });
    await post("sam-sample", "/api/repos/sam-sample/mine/files", { path: "a.js", content: "x" });
    const res = await post("sam-sample", "/api/repos/sam-sample/mine/agents", { harness: "claude", path: "a.js", task: "x" });
    expect(res.status).toBe(403);
    env.ADMINS = undefined;
    expect((await post("ryan-quinn", "/api/repos/ryan-quinn/r1/agents", { harness: "claude", path: "src/a.js", task: "x" })).status).toBe(403);
  });

  test("a feed digest is for admins too: it bills the site's keys, while everyone keeps the raw feed (#575)", async () => {
    const { call, post, runs } = await hosted(async (b) => ({ code: 0, out: "", text: b.text }));
    expect(await (await call("sam-sample", "/api/agents")).json()).toMatchObject({ available: true, admins_only: true });
    expect(await (await call("ryan-quinn", "/api/agents")).json()).toMatchObject({ available: true, admins_only: false });
    const res = await post("sam-sample", "/api/me/feed/digest", { harness: "claude" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error).toContain("ADMINS");
    expect(await (await call("sam-sample", "/api/me/feed/digest")).json()).toBeNull();
    expect((await call("sam-sample", "/api/me/feed")).status).toBe(200);
    expect((await post("ryan-quinn", "/api/me/feed/digest", { harness: "claude" })).status).toBe(202);
    expect(runs).toEqual([]);   // ryan follows nobody: a digest of nothing needs no agent
  });

  test("with accounts off, nothing runs: anyone could claim an admin's handle by alias", async () => {
    const call = await boot({ GH_CLI: "off", ADMINS: "ryan" });
    opened.push(call);
    const runs: any[] = [];
    call.env.AGENT_SANDBOX = { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => { runs.push(r); return Response.json({}); } }) };
    const post = (url: string, body: unknown) => call("ryan", url, { method: "POST", body: JSON.stringify(body) });
    await post("/api/login", { name: "ryan" });
    await post("/api/repos", { name: "r1", visibility: "public" });
    await post("/api/repos/ryan/r1/files", { path: "a.js", content: "x" });
    expect(await (await call(null, "/api/agents")).json()).toMatchObject({ available: false, harnesses: [] });
    const res = await post("/api/repos/ryan/r1/agents", { harness: "claude", path: "a.js", task: "x" });
    expect(res.status).toBe(501);
    expect(((await res.json()) as any).error).toContain("BETTER_AUTH_SECRET");
    expect(runs).toEqual([]);
  });

  test("an admin's cut runs bun test in its own container, marks the gutter, and the container stops", async () => {
    const { call, post, runs, containers } = await hosted(testCut);
    await post("ryan-quinn", "/api/repos/ryan-quinn/r1/files", { path: "src/sum.ts", content: "export const sum = (a: number, b: number) => a - b;" });
    await post("ryan-quinn", "/api/repos/ryan-quinn/r1/files", { path: "test/sum.test.ts", content: ['import { expect, test } from "bun:test";', 'import { sum } from "../src/sum.ts";', "", 'test("adds", () => expect(sum(2, 2)).toBe(4));', 'test("zero", () => expect(sum(0, 0)).toBe(0));'].join("\n") });
    const made = await post("ryan-quinn", "/api/repos/ryan-quinn/r1/cuts", { path: "test/sum.test.ts", from: 4, to: 5 });
    const { id } = (await made.json()) as { id: string };
    const cut = (await (await call("ryan-quinn", `/api/cuts/${id}`)).json()) as any;
    expect(cut.can_run).toBe(true);
    const ran = (await (await post("ryan-quinn", `/api/cuts/${id}/run`, {})).json()) as any;
    // The container got only the cut's files: no command, so no logins either.
    expect(Object.keys(runs[0].files).sort()).toEqual(["src/sum.ts", "test/sum.test.ts"]);
    expect(containers.map((s) => [s.started?.env, s.destroyed])).toEqual([[{}, 1]]);
    expect([ran.code, ran.passed, ran.failed]).toEqual([1, 1, 1]);
    const [adds, zero] = cut.files.find((f: any) => f.path === "test/sum.test.ts").lines.slice(-2).map((l: any) => l.id);
    expect(ran.marks["test/sum.test.ts"]).toMatchObject({ [adds]: "fail", [zero]: "pass" });
    expect(await (await call(null, `/api/cuts/${id}/share`)).text()).toContain("1 passed, 1 failed");
  });

  test("an owner who isn't in ADMINS can't run a cut in a container", async () => {
    const { post, runs } = await hosted(testCut);
    await post("sam-sample", "/api/repos", { name: "mine", visibility: "public" });
    await post("sam-sample", "/api/repos/sam-sample/mine/files", { path: "a.test.ts", content: 'import { test } from "bun:test";\ntest("x", () => {});' });
    const { id } = (await (await post("sam-sample", "/api/repos/sam-sample/mine/cuts", { path: "a.test.ts", from: 1, to: 2 })).json()) as { id: string };
    const res = await post("sam-sample", `/api/cuts/${id}/run`, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toContain("ADMINS");
    expect(runs).toEqual([]);
  });

  test("Stop on a hosted run: the run sees it in D1 and destroys its container, and nothing lands", async () => {
    let seen: { destroyed: number } | undefined;
    const { call, post, containers } = await hosted(async () => {
      seen = containers.at(-1);
      // The agent works till its container goes.
      while (!seen!.destroyed) await Bun.sleep(20);
      return { code: 137, out: "killed", text: null };
    });
    const { id } = await (await post("ryan-quinn", "/api/repos/ryan-quinn/r1/agents", { harness: "claude", path: "src/a.js", task: "use let" })).json() as { id: number };
    for (const end = performance.now() + 5_000; !seen && performance.now() < end;) await Bun.sleep(20);
    expect(await (await post("ryan-quinn", "/api/repos/ryan-quinn/r1/agents/stop", { path: "src/a.js" })).json()).toEqual({ stopped: [id] });
    for (const end = performance.now() + 10_000; !seen!.destroyed && performance.now() < end;) await Bun.sleep(20);
    expect(seen!.destroyed).toBeGreaterThan(0);
    const run = ((await (await call("ryan-quinn", "/api/repos/ryan-quinn/r1/agents")).json()) as any[])[0];
    expect(run).toMatchObject({ id, status: "stopped", error: "stopped by @ryan-quinn" });
    expect(text(await doc(call))).toBe("var x = 1\nf()");
  });

  test("hosted runs share one daily budget for the site, admins' runs included (#797)", async () => {
    const { call, post, env } = await hosted(async (b) => ({ code: 0, out: "", text: b.text }));
    await env.DB.prepare("INSERT INTO limit_rules (name, max, window_s, enabled, on_fail) VALUES ('hosted', 1, 86400, 1, 'reject')").run();
    await finished(call, { harness: "claude", path: "src/a.js", task: "x" });
    const res = await post("ryan-quinn", "/api/repos/ryan-quinn/r1/agents", { harness: "claude", path: "src/a.js", task: "x" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error).toStartWith("The site's hosted runs for the day are used up (1).");
    expect((await post("ryan-quinn", "/api/me/feed/digest", { harness: "claude" })).status).toBe(429);
  });

  test("a hosted run past its 15 minutes is stopped, however many times its CLI went round, and nothing lands (#797)", async () => {
    const { call, env } = await hosted(async (b) => { await Bun.sleep(200); return { code: 0, out: "", text: b.text.replace("var", "let") }; });
    await finished(call, { harness: "claude", path: "src/a.js", task: "warm up" });
    const late = await env.DB.prepare("INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started) VALUES ('ryan-quinn', 'r1', 'src/a.js', 'claude', 'x', 'agent-claude', 'running', ?) RETURNING id")
      .bind(Date.now() - 16 * 60_000).first() as { id: number };
    await env.JOBS.send({ agent: late.id, origin: "http://codesplitter.local" });
    let run: any;
    for (const end = performance.now() + 15_000; performance.now() < end && (run = ((await (await call("ryan-quinn", "/api/repos/ryan-quinn/r1/agents")).json()) as any[]).find((r) => r.id === late.id)).status === "running";) await Bun.sleep(20);
    expect(run).toMatchObject({ status: "stopped", error: "out of time: a hosted run gets 15 minutes" });
    expect(run.pending).toBeUndefined();
  });

  test("a CLI that fails in the container comes back as a failed run, and nothing lands", async () => {
    const { call } = await hosted(async () => ({ code: 1, out: "not logged in", text: "junk" }));
    expect(await finished(call, { harness: "claude", path: "src/a.js", task: "x" })).toMatchObject({ status: "failed" });
    expect(text(await doc(call))).toBe("var x = 1\nf()");
  });

  test("an agent told to write its own key into the file, or a key of any known shape, or to empty it, lands nothing", async () => {
    const key = "sk-live-made-up-for-this-test-0123456789";
    const leaks = [`var x = 1\nf()\n// ${key}\n`, "var x = 1\nf()\nconst t = 'ghp_" + "a".repeat(36) + "'\n", ""];
    const { call, env } = await hosted(async () => ({ code: 0, out: "", text: leaks.shift() }));
    env.ANTHROPIC_API_KEY = key;
    for (const why of ["a key this run was handed", "a GitHub token", "emptied src/a.js"]) {
      const run = await finished(call, { harness: "claude", path: "src/a.js", task: "x" });
      expect(run.status).toBe("failed");
      expect(JSON.stringify(run)).toContain(why);
      expect(text(await doc(call))).toBe("var x = 1\nf()");
    }
  });

  test("a path .gitattributes locks is refused before a container starts", async () => {
    const { call, post, runs } = await hosted(async (b) => ({ code: 0, out: "", text: b.text }));
    await post("ryan-quinn", "/api/repos/ryan-quinn/r1/files", { path: ".gitattributes", content: "src/a.js codesplitter-live=locked" });
    const res = await post("ryan-quinn", "/api/repos/ryan-quinn/r1/agents", { harness: "claude", path: "src/a.js", task: "x" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("locked");
    expect(runs).toHaveLength(0);
  });

  test("runs are kept in D1, so any isolate sees them; a redelivery after a cut-off consumer starts the run again, once per cut", async () => {
    const { call, runs, env } = await hosted(async (b) => ({ code: 0, out: "", text: b.text }));
    const run = await finished(call, { harness: "claude", path: "src/a.js", task: "x" });
    expect(run.deadline).toBe(run.started + 15 * 60_000); // the queue consumer's limit, for the page's countdown
    expect(await env.DB.prepare("SELECT status, picked FROM agent_runs WHERE id = ?").bind(run.id).first()).toEqual({ status: "done", picked: 1 });
    // A run whose consumer was cut off mid-run: picked, still running, and silent for longer than a heartbeat. Its message comes again.
    await env.DB.prepare("UPDATE agent_runs SET status = 'running', result = ? WHERE id = ?").bind(JSON.stringify({ beat: 1 }), run.id).run();
    const before = runs.length;
    await env.JOBS.send({ agent: run.id, origin: "http://codesplitter.local" });
    let again: any;
    for (const end = performance.now() + 15_000; performance.now() < end && (again = ((await (await call("ryan-quinn", "/api/repos/ryan-quinn/r1/agents")).json()) as any[])[0]).status === "running";) await Bun.sleep(20);
    // It went round again from the file as it stood, once, and says so.
    expect(again).toMatchObject({ status: "done", restarts: 1 });
    expect(again.log).toContain("interrupted by update, retrying");
    expect(runs.length).toBe(before + 1);
  });
});
