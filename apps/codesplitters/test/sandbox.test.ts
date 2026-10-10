import { afterAll, describe, expect, test } from "bun:test";
import { text, type Doc } from "../src/lines.ts";
import { local as boot, type Call } from "../src/local.ts";
import { AgentSandbox, LOGINS, type ContainerApi } from "../src/sandbox.ts";
// @ts-expect-error plain .mjs, no types: it is the server inside the container image
import { run, test as testCut } from "../sandbox/server.mjs";

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
  test("a path that climbs out of the directory is refused", async () => {
    expect((await run({ cmd: { bin: "true", args: [] }, path: "../escape.js", text: "" })).code).toBe(2);
    expect((await testCut({ files: { "../escape.test.ts": "" } })).code).toBe(2);
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
    const res = await new AgentSandbox({ container: c }, env).fetch(new Request("http://sandbox/run", {
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
      await new AgentSandbox({ container: c }, env).fetch(new Request("http://sandbox/run", { method: "POST", body: JSON.stringify({ cmd: { bin, args: [] }, path: "a.js", text: "" }) }));
      return seen.started?.env;
    };
    expect(await started("claude")).toEqual({ ANTHROPIC_API_KEY: "sk-a", CLAUDE_CODE_OAUTH_TOKEN: "oat" });
    expect(await started("codex")).toEqual({ OPENAI_API_KEY: "sk-o" });
  });
});

describe("POST /api/repos/:o/:r/agents with AGENT_SANDBOX bound", () => {
  const origin = "http://codesplitters.local";
  /** The app with accounts on and AGENT_SANDBOX bound to containers that run `server`. */
  async function hosted(server: (body: any) => Promise<unknown>) {
    const booted = await boot({ GH_CLI: "off", BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: origin, ADMINS: "ryan-quinn" });
    opened.push(booted);
    const runs: any[] = [];
    booted.env.AGENT_SANDBOX = {
      idFromName: (n: string) => n,
      get: () => new AgentSandbox({ container: fakeContainer(async (b) => { runs.push(b); return server(b); }).c }, booted.env),
    };
    // Each handle's session cookie, from signing up with a name that makes it.
    const cookies: Record<string, string> = {};
    const signup = async (name: string) => {
      const res = await booted(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email: `${name.replace(" ", ".")}@example.com`.toLowerCase(), password: "correct horse battery", name }) });
      cookies[name.toLowerCase().replace(" ", "-")] = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")!]).map((c) => c.split(";")[0]).join("; ");
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
    return { call, post, runs, env: booted.env };
  }
  const doc = async (call: Call) => await (await call("ryan-quinn", "/api/repos/ryan-quinn/r1/do/file?path=src/a.js")).json() as Doc;

  test("every harness is offered, even where Bun can't run CLIs", async () => {
    const { call } = await hosted(async (b) => b);
    expect(await (await call(null, "/api/agents")).json()).toMatchObject({ available: true, harnesses: ["claude", "codex", "pi", "opencode"] });
  });

  test("the owner gives an agent a task; it runs in a container, answers when done, and its lines are blamed on it", async () => {
    const { call, post, runs } = await hosted(async (b) => ({ code: 0, out: "ok", text: b.text.replace("var", "let") }));
    const res = await post("ryan-quinn", "/api/repos/ryan-quinn/r1/agents", { harness: "opencode", path: "src/a.js", task: "use let" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ agent: "agent-opencode", status: "done", applied: 1, conflicts: [] });
    expect(runs[0].cmd.bin).toBe("opencode");
    expect(runs[0].cmd.env.OPENCODE_CONFIG_CONTENT).toContain("deny"); // the harness's own limits reach the container
    expect(runs[0].text).toBe("var x = 1\nf()\n");
    const d = await doc(call);
    expect(text(d)).toBe("let x = 1\nf()");
    expect(d.lines.map((l) => l.by)).toEqual(["agent-opencode", "ryan-quinn"]);
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

  test("a CLI that fails in the container comes back as a failed run, and nothing lands", async () => {
    const { call, post } = await hosted(async () => ({ code: 1, out: "not logged in", text: "junk" }));
    const res = await post("ryan-quinn", "/api/repos/ryan-quinn/r1/agents", { harness: "codex", path: "src/a.js", task: "x" });
    expect(await res.json()).toMatchObject({ status: "failed" });
    expect(text(await doc(call))).toBe("var x = 1\nf()");
  });
});
