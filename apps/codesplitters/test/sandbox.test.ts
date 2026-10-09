import { afterAll, describe, expect, test } from "bun:test";
import { text, type Doc } from "../src/lines.ts";
import { local as boot, type Call } from "../src/local.ts";
import { AgentSandbox, LOGINS, type ContainerApi } from "../src/sandbox.ts";
// @ts-expect-error plain .mjs, no types: it is the server inside the container image
import { run } from "../sandbox/server.mjs";

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
  test("starts the container with the logins that are set, waits for its server, and stops it after the run", async () => {
    const { c, seen } = fakeContainer(run, 2);
    const env: any = { ANTHROPIC_API_KEY: "sk-a", OPENAI_API_KEY: "", GITHUB_TOKEN: "not-for-agents" };
    const res = await new AgentSandbox({ container: c }, env).fetch(new Request("http://sandbox/run", {
      method: "POST", body: JSON.stringify({ cmd: { bin: "sh", args: ["-c", "echo B >> a.js"] }, path: "a.js", text: "A\n" }),
    }));
    expect(await res.json()).toEqual({ code: 0, out: "", text: "A\nB\n" });
    expect(seen.started?.env).toEqual({ ANTHROPIC_API_KEY: "sk-a" });
    expect(LOGINS).not.toContain("GITHUB_TOKEN" as any);
    expect(seen.tries).toBe(3);
    expect(seen.destroyed).toBe(1);
  });
});

describe("POST /api/repos/:o/:r/agents", () => {
  /** The app with AGENT_SANDBOX bound to containers that run `server`. */
  async function hosted(server: (body: any) => Promise<unknown>) {
    const call = await boot();
    opened.push(call);
    const runs: any[] = [];
    call.env.AGENT_SANDBOX = {
      idFromName: (n: string) => n,
      get: () => new AgentSandbox({ container: fakeContainer(async (b) => { runs.push(b); return server(b); }).c }, call.env),
    };
    const post = (user: string, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
    await post("ryan", "/api/login", { name: "ryan" });
    await post("ryan", "/api/repos", { name: "r1", visibility: "public" });
    await post("ryan", "/api/repos/ryan/r1/collaborators", { name: "agent-x" });
    await post("ryan", "/api/repos/ryan/r1/collaborators", { name: "pat" });
    await post("ryan", "/api/repos/ryan/r1/files", { path: "src/a.js", content: "var x = 1\nf()" });
    return { call, post, runs };
  }
  const doc = async (call: Call) => await (await call("ryan", "/api/repos/ryan/r1/do/file?path=src/a.js")).json() as Doc;

  test("the owner puts an agent on a file; it runs in a container and its lines are blamed on it", async () => {
    const { call, post, runs } = await hosted(async (b) => ({ code: 0, out: "ok", text: b.text.replace("var", "let") }));
    const res = await post("ryan", "/api/repos/ryan/r1/agents", { harness: "claude", path: "src/a.js", task: "use let", as: "agent-x" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ changed: true, applied: 1, runs: 1, conflicts: [] });
    expect(runs[0].cmd.bin).toBe("claude");
    expect(runs[0].text).toBe("var x = 1\nf()\n");
    const d = await doc(call);
    expect(text(d)).toBe("let x = 1\nf()");
    expect(d.lines.map((l) => l.by)).toEqual(["agent-x", "ryan"]);
  });

  test("a collaborator runs one as themselves, not as someone else; a stranger not at all", async () => {
    const { post } = await hosted(async (b) => ({ code: 0, out: "", text: b.text }));
    const ask = (user: string, as?: string) => post(user, "/api/repos/ryan/r1/agents", { harness: "pi", path: "src/a.js", task: "x", as });
    expect((await ask("pat")).status).toBe(200);
    expect((await ask("pat", "agent-x")).status).toBe(403);
    expect((await ask("eve")).status).toBe(403);
    expect((await post("ryan", "/api/repos/ryan/r1/agents", { harness: "vim", path: "src/a.js", task: "x" })).status).toBe(400);
  });

  test("a CLI that fails in the container comes back as an error, and nothing lands", async () => {
    const { call, post } = await hosted(async () => ({ code: 1, out: "not logged in", text: "junk" }));
    const res = await post("ryan", "/api/repos/ryan/r1/agents", { harness: "codex", path: "src/a.js", task: "x" });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("not logged in");
    expect(text(await doc(call))).toBe("var x = 1\nf()");
  });
});
