// Hosted agents: on Cloudflare there is no CLI and no filesystem, so the agent
// runs in a container (sandbox/Dockerfile: each CLI, plus a small server). The
// AgentSandbox Durable Object owns one container. Each run gets its own
// instance, which starts the container, hands it the file and the command, and
// stops it when the agent is done, so nothing bills while idle.

import type { Sandbox } from "./agent-run.ts";
import { json, type Env } from "./env.ts";

/** The CLIs' logins, passed into the container from the Worker's secrets when set. */
export const LOGINS = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"] as const;

/** The logins each CLI may see. An agent can read its own env, so a run only gets its harness's keys. */
const KEYS: Record<string, readonly (typeof LOGINS)[number][]> = {
  claude: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
  // pi and opencode take a provider/model, so they may need either provider's key.
  pi: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
  opencode: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
};

/** The slice of the Workers container API we use (`ctx.container` on a container-backed DO). */
export interface ContainerApi {
  readonly running: boolean;
  start(opts?: { env?: Record<string, string>; enableInternet?: boolean }): void;
  destroy(reason?: unknown): Promise<void>;
  getTcpPort(port: number): { fetch(url: string, init?: RequestInit): Promise<Response> };
}

const PORT = 8080;

export class AgentSandbox {
  constructor(private ctx: { container?: ContainerApi }, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const c = this.ctx.container;
    if (!c) return json({ error: "this Durable Object has no container" }, 501);
    const body = await req.text();
    if (!c.running) {
      const env: Record<string, string> = {};
      let bin = "";
      try { bin = String(JSON.parse(body)?.cmd?.bin ?? ""); } catch {}
      for (const k of KEYS[bin] ?? []) if (this.env[k]) env[k] = this.env[k]!;
      c.start({ env, enableInternet: true });
    }
    try {
      // The server takes a moment to listen after the container boots.
      for (let i = 0; ; i++) {
        try {
          return await c.getTcpPort(PORT).fetch("http://sandbox/run", { method: "POST", body, headers: { "content-type": "application/json" } });
        } catch (e) {
          if (i >= 60) throw e;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    } finally {
      await c.destroy().catch(() => {});
    }
  }
}

/** A Sandbox backed by the AgentSandbox binding: one container per run. */
export const containerSandbox = (ns: NonNullable<Env["AGENT_SANDBOX"]>): Sandbox => async (cmd, file) => {
  const stub = ns.get(ns.idFromName(crypto.randomUUID()));
  const res = await stub.fetch(new Request("http://sandbox/run", { method: "POST", body: JSON.stringify({ cmd, ...file }) }));
  if (!res.ok) throw new Error(`sandbox: ${res.status} ${await res.text()}`);
  return (await res.json()) as { code: number; out: string; text: string | null };
};
