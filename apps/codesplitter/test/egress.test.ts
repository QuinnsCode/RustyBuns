import { afterEach, describe, expect, test } from "bun:test";
import { allowed, EgressGate, gate, GITHUB_HOSTS, REGISTRIES } from "../src/egress.ts";
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
