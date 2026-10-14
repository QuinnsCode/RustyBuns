// Layout: the container Durable Object hosted agents run in
// Hosted agents: a Worker can't start the agents' CLIs (native programs that
// run shell commands; an isolate has node:fs but no processes), so the agent
// runs in a container (sandbox/Dockerfile: each CLI, plus a small server). The
// AgentSandbox Durable Object owns one container. Each run gets its own
// instance, which starts the container, hands it the file and the command, and
// stops it when the agent is done, so nothing bills while idle.

import type { Sandbox } from "./agent-run.ts";
import { json, type Env } from "./env.ts";
import { gate, GITHUB_HOSTS, STAND_IN, HARNESS_HOSTS, hostList, hostOf, REGISTRIES, type GateExports, type Interceptor } from "./egress.ts";

/**
 * The CLIs' logins, passed into the container from the Worker's secrets when set.
 * API keys only: a Claude subscription login (CLAUDE_CODE_OAUTH_TOKEN) is for your
 * own use, not for running a service for others (#559), so hosted runs never get one.
 */
export const LOGINS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"] as const;

/** The logins each CLI may see. An agent can read its own env, so a run only gets its harness's keys. */
const KEYS: Record<string, readonly (typeof LOGINS)[number][]> = {
  claude: ["ANTHROPIC_API_KEY"],
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
  // pi and opencode take a provider/model, so they may need either provider's key.
  pi: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
  opencode: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
};

/**
 * The harnesses whose key (and GH_TOKEN) never enter the container: codex has a
 * shell and pi a `read` that isn't held to its directory, so either could print
 * it. The container gets a stand-in, and the egress gate adds the real one to
 * requests to that API's host (#1655).
 */
const PROXIED = ["codex", "pi"];

/** The headers the gate adds, by host: each key to its own API, the GH_TOKEN to GitHub. */
export function injections(bin: string, env: Env, token?: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const openai = env.OPENAI_API_KEY || env.CODEX_API_KEY;
  if (KEYS[bin]?.includes("ANTHROPIC_API_KEY") && env.ANTHROPIC_API_KEY) out["api.anthropic.com"] = { "x-api-key": env.ANTHROPIC_API_KEY };
  if (openai && KEYS[bin]?.some((k) => k !== "ANTHROPIC_API_KEY")) out["api.openai.com"] = { authorization: `Bearer ${openai}` };
  if (token) for (const h of GITHUB_HOSTS) out[h] = { authorization: h === "github.com" ? `Basic ${btoa(`x-access-token:${token}`)}` : `Bearer ${token}` };
  return out;
}

/** The slice of the Workers container API we use (`ctx.container` on a container-backed DO). */
export interface ContainerApi extends Interceptor {
  readonly running: boolean;
  start(opts?: { env?: Record<string, string>; enableInternet?: boolean }): void;
  destroy(reason?: unknown): Promise<void>;
  getTcpPort(port: number): { fetch(url: string, init?: RequestInit): Promise<Response> };
}

const PORT = 8080;

/** POST `body` to the container's server, waiting for it to listen: it takes a moment after the container boots. */
export async function portFetch(c: ContainerApi, path: string, body: string): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      return await c.getTcpPort(PORT).fetch(`http://sandbox${path}`, { method: "POST", body, headers: { "content-type": "application/json" } });
    } catch (e) {
      if (i >= 60) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/**
 * Where a run's container may go (#681, src/egress.ts): its CLI's LLM API, GitHub
 * when it has a GH_TOKEN, and with a clone (the doctor's runs) the git remote, the
 * registries and any the repo's .npmrc names (`hosts`, from src/deps.ts). A cut's
 * tests get none.
 */
export function sandboxHosts(body: { cmd?: { bin?: string; env?: Record<string, string> }; remote?: string; hosts?: string[] }): string[] {
  return hostList(
    HARNESS_HOSTS[body.cmd?.bin ?? ""] ?? [],
    body.cmd?.env?.GH_TOKEN ? GITHUB_HOSTS : [],
    body.remote ? [hostOf(body.remote), ...REGISTRIES, ...(body.hosts ?? [])] : [],
  );
}

export class AgentSandbox {
  constructor(private ctx: { container?: ContainerApi; exports?: GateExports }, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const c = this.ctx.container;
    if (!c) return json({ error: "this Durable Object has no container" }, 501);
    // Stop on a run: the container goes, so the agent's /run answers with an error.
    if (new URL(req.url).pathname === "/stop") {
      if (c.running) await c.destroy("stopped").catch(() => {});
      return json({ stopped: true });
    }
    let body = await req.text();
    if (!c.running) {
      const env: Record<string, string> = {};
      let parsed: Parameters<typeof sandboxHosts>[0] = {};
      try { parsed = JSON.parse(body) ?? {}; } catch {}
      const bin = String(parsed.cmd?.bin ?? ""), proxied = PROXIED.includes(bin);
      for (const k of KEYS[bin] ?? []) if (this.env[k]) env[k] = proxied ? STAND_IN : this.env[k]!;
      let inject: ReturnType<typeof injections> | undefined, sent = body;
      if (proxied) {
        const token = parsed.cmd?.env?.GH_TOKEN;
        inject = injections(bin, this.env, token);
        if (token) {
          const swapped = { ...parsed, cmd: { ...parsed.cmd, env: { ...parsed.cmd!.env, GH_TOKEN: STAND_IN, GITHUB_TOKEN: STAND_IN } } };
          sent = JSON.stringify(swapped);
        }
      }
      try { await gate(c, this.ctx.exports, sandboxHosts(parsed), inject); } catch (e) { return json({ error: (e as Error).message }, 503); }
      c.start({ env, enableInternet: false });
      body = sent;
    }
    try {
      // /run: an agent on a file; /test: bun test on a cut's files (cuts.ts); /deps-test and /deps-fix: the dependency doctor's runs (deps.ts).
      return await portFetch(c, new URL(req.url).pathname, body);
    } finally {
      await c.destroy().catch(() => {});
    }
  }
}

/** A Sandbox backed by the AgentSandbox binding: one container per run. `signal` aborting destroys it. */
export const containerSandbox = (ns: NonNullable<Env["AGENT_SANDBOX"]>): Sandbox => async (cmd, file, signal) => {
  signal?.throwIfAborted();
  const stub = ns.get(ns.idFromName(crypto.randomUUID()));
  const stop = () => { void stub.fetch(new Request("http://sandbox/stop", { method: "POST" })).catch(() => {}); };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const res = await stub.fetch(new Request("http://sandbox/run", { method: "POST", body: JSON.stringify({ cmd, ...file }) }));
    signal?.throwIfAborted();
    if (!res.ok) throw new Error(`sandbox: ${res.status} ${await res.text()}`);
    return (await res.json()) as { code: number; out: string; text: string | null };
  } finally { signal?.removeEventListener("abort", stop); }
};
