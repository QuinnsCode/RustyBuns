import { afterEach, describe, expect, test } from "bun:test";
import { allowed, EgressGate, gate, STAND_IN, GITHUB_HOSTS, REGISTRIES } from "../src/egress.ts";
import { AgentSandbox, sandboxHosts, type ContainerApi } from "../src/sandbox.ts";
import { gated } from "./fake-gate.ts";

describe("the egress list", () => {
  test("a host is on it by its exact name, or under a *. entry", () => {
    expect(allowed("registry.npmjs.org", REGISTRIES)).toBe(true);
    expect(allowed("Registry.NPMJS.org.", REGISTRIES)).toBe(true);
    expect(allowed("evil-registry.npmjs.org", REGISTRIES)).toBe(false);
    expect(allowed("registry.npmjs.org.evil.dev", REGISTRIES)).toBe(false);
    expect(allowed("a.b.example.com", ["*.example.com"])).toBe(true);
    expect(allowed("example.com", ["*.example.com"])).toBe(false);
    expect(allowed("anything", [])).toBe(false);
  });

  test("an agent run reaches its CLI's API; a doctor's run the clone and registries too; a cut's tests nothing", () => {
    expect(sandboxHosts({ cmd: { bin: "claude" } })).toEqual(["api.anthropic.com"]);
    expect(sandboxHosts({ cmd: { bin: "codex", env: { GH_TOKEN: "gh" } } })).toEqual(["api.openai.com", ...GITHUB_HOSTS]);
    expect(sandboxHosts({})).toEqual([]);
    expect(sandboxHosts({ cmd: { bin: "sh" } })).toEqual([]);
    const fix = sandboxHosts({ cmd: { bin: "claude" }, remote: "https://x:tok@acct.artifacts.cloudflare.net/r.git", hosts: ["npm.acme.dev"] });
    expect(fix).toEqual(["api.anthropic.com", "acct.artifacts.cloudflare.net", ...REGISTRIES, "npm.acme.dev"]);
  });
});

describe("EgressGate", () => {
  const real = globalThis.fetch;
  afterEach(() => { globalThis.fetch = real; });

  test("forwards a request to a host on the run's list, and refuses any other", async () => {
    const sent: string[] = [];
    globalThis.fetch = (async (r: Request) => { sent.push(r.url); return new Response("ok"); }) as typeof fetch;
    const ctx = { props: { hosts: ["registry.npmjs.org"] } };
    expect(await (await EgressGate.fetch(new Request("https://registry.npmjs.org/mitt"), {}, ctx)).text()).toBe("ok");
    const no = await EgressGate.fetch(new Request("https://second-stage.example/x.sh"), {}, ctx);
    expect(no.status).toBe(403);
    expect(await no.text()).toContain("second-stage.example");
    expect(sent).toEqual(["https://registry.npmjs.org/mitt"]);
  });

  test("puts a run's key on requests to its host only, over whatever the CLI sent (#1655)", async () => {
    const seen: Record<string, string | null> = {};
    globalThis.fetch = (async (r: Request) => { seen[new URL(r.url).hostname] = r.headers.get("authorization"); return new Response("ok"); }) as typeof fetch;
    const ctx = { props: { hosts: ["api.openai.com", "example.com"], inject: { "api.openai.com": { authorization: "Bearer real" } } } };
    await EgressGate.fetch(new Request("https://api.openai.com/v1", { headers: { authorization: "Bearer stand-in" } }), {}, ctx);
    await EgressGate.fetch(new Request("https://example.com/", { headers: { authorization: "Bearer stand-in" } }), {}, ctx);
    expect(seen).toEqual({ "api.openai.com": "Bearer real", "example.com": "Bearer stand-in" });
  });

  test("routes all of a container's HTTP and HTTPS through the gate, and won't start one without it", async () => {
    const calls: string[] = [];
    const c = { interceptOutboundHttps: async (a: string) => { calls.push(`https ${a}`); }, interceptAllOutboundHttp: async () => { calls.push("http"); } };
    await gate(c, { EgressGate: ({ props }) => props }, ["api.anthropic.com"]);
    expect(calls).toEqual(["https *", "http"]);
    await expect(gate(c, undefined, [])).rejects.toThrow("egress gate");
    await expect(gate({}, { EgressGate: ({ props }) => props }, [])).rejects.toThrow("egress gate");
  });
});

test("AgentSandbox starts its container with the internet off and the run's list on the gate", async () => {
  let opts: Parameters<ContainerApi["start"]>[0];
  const lists: string[][] = [];
  const c: ContainerApi = { running: false, start(o) { opts = o; }, async destroy() {}, getTcpPort: () => ({ fetch: async () => Response.json({ code: 0, out: "", text: "" }) }) };
  const env: any = { ANTHROPIC_API_KEY: "sk-a" };
  const run = new Request("http://sandbox/run", { method: "POST", body: JSON.stringify({ cmd: { bin: "claude", args: [] }, path: "a.js", text: "" }) });
  await new AgentSandbox(gated(c, lists), env).fetch(run.clone());
  expect(opts!.enableInternet).toBe(false);
  expect(lists).toEqual([["api.anthropic.com"]]);
  // No gate, no container: it never starts with the internet open.
  opts = undefined;
  const res = await new AgentSandbox({ container: c }, env).fetch(run);
  expect(res.status).toBe(503);
  expect(opts).toBeUndefined();
});

test("codex's container holds stand-ins; the real key and GH_TOKEN ride on the gate (#1655)", async () => {
  let opts: Parameters<ContainerApi["start"]>[0], sent = "";
  const injects: any[] = [];
  const c: ContainerApi = { running: false, start(o) { opts = o; }, async destroy() {}, getTcpPort: () => ({ fetch: async (_u, init) => { sent = String(init!.body); return Response.json({}); } }) };
  const env: any = { OPENAI_API_KEY: "sk-real", ANTHROPIC_API_KEY: "sk-ant" };
  const body = JSON.stringify({ cmd: { bin: "codex", args: [], env: { GH_TOKEN: "ghp-real" } }, path: "a.js", text: "" });
  await new AgentSandbox(gated(c, [], injects), env).fetch(new Request("http://sandbox/run", { method: "POST", body }));
  expect(opts!.env).toEqual({ OPENAI_API_KEY: STAND_IN });
  expect(sent).not.toContain("ghp-real");
  expect(JSON.parse(sent).cmd.env.GH_TOKEN).toBe(STAND_IN);
  expect(injects[0]["api.openai.com"]).toEqual({ authorization: "Bearer sk-real" });
  expect(injects[0]["api.github.com"]).toEqual({ authorization: "Bearer ghp-real" });
  expect(JSON.stringify(opts)).not.toContain("sk-real");
});
