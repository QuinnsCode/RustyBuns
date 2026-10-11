// What the containers may reach (#681). The deploy container (DeployRunner) and
// the agent sandbox (AgentSandbox) start with the internet off, and their HTTP
// and HTTPS go through EgressGate, an entrypoint of this Worker that lets a
// request out only to a host on that run's list and answers anything else 403.
// The runtime puts a CA of its own in the container for the HTTPS it
// intercepts (/etc/cloudflare/certs/...), which each image trusts at start.
// With the internet off nothing but HTTP and HTTPS gets out, and names outside
// the list don't even resolve. One exception: a Hetzner deploy reaches its
// server over SSH, to an address nobody knows before the run, so a run holding
// a Hetzner key keeps other ports open (its HTTP and HTTPS are still gated).

import type { Provider } from "./deploy-keys.ts";

/** The package registries an install reaches: npm's, and yarn's (corepack fetches pnpm and yarn from them too). */
export const REGISTRIES = ["registry.npmjs.org", "registry.yarnpkg.com", "repo.yarnpkg.com"];

/** Each provider's API, for the deploy holding its key. */
export const PROVIDER_HOSTS: Record<Provider, string[]> = {
  cloudflare: ["api.cloudflare.com"],
  railway: ["backboard.railway.com", "backboard.railway.app", "storage.railway.app"],
  hetzner: ["api.hetzner.cloud"],
};

const ANTHROPIC = "api.anthropic.com", OPENAI = "api.openai.com";
/** Each agent CLI's LLM API. opencode also reads its model list from models.dev. */
export const HARNESS_HOSTS: Record<string, string[]> = {
  claude: [ANTHROPIC],
  codex: [OPENAI],
  pi: [ANTHROPIC, OPENAI],
  opencode: [ANTHROPIC, OPENAI, "models.dev"],
};

/** GitHub, for an agent run handed a GH_TOKEN (its owner's bot account). */
export const GITHUB_HOSTS = ["github.com", "api.github.com", "codeload.github.com", "objects.githubusercontent.com", "raw.githubusercontent.com"];

export const hostOf = (url: string): string | null => {
  try { return new URL(url).hostname.toLowerCase() || null; } catch { return null; }
};

/** Whether `host` is on `list`: an exact name, or `*.example.com` for its subdomains. */
export function allowed(host: string, list: readonly string[]): boolean {
  host = host.toLowerCase().replace(/\.$/, "");
  return list.some((h) => h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h);
}

/** A list without repeats or blanks. */
export const hostList = (...lists: (readonly (string | null | undefined)[])[]): string[] =>
  [...new Set(lists.flat().filter((h): h is string => !!h).map((h) => h.toLowerCase()))];

/** The gate's answer to a request the list doesn't cover. */
export const refused = (host: string) =>
  new Response(`codeSplitters: ${host} isn't on this container's egress list (#681)\n`, { status: 403, headers: { "content-type": "text/plain" } });

/**
 * The gate itself, exported from the Worker so `ctx.exports.EgressGate` can
 * hand it to the container. A plain handler, not a WorkerEntrypoint class, so
 * the Worker still imports under Bun's tests; the run's list comes in as props.
 */
export const EgressGate = {
  async fetch(req: Request, _env: unknown, ctx: { props?: { hosts?: string[] } }): Promise<Response> {
    const host = new URL(req.url).hostname;
    if (!allowed(host, ctx.props?.hosts ?? [])) return refused(host);
    return fetch(req);
  },
};

/** The slice of `ctx.exports` a container's Durable Object needs: the gate, bound to one run's list. */
export interface GateExports {
  EgressGate?: (opts: { props: { hosts: string[] } }) => unknown;
}

/** The interception calls on `ctx.container` (workers-types' Container). */
export interface Interceptor {
  interceptOutboundHttps?(addr: string, binding: unknown): Promise<void>;
  interceptAllOutboundHttp?(binding: unknown): Promise<void>;
}

/**
 * Route the container's HTTP and HTTPS through the gate with `hosts` as its
 * list. Call before `start`, so the runtime puts its CA in the container as it
 * boots. Throws rather than run with the internet open when the gate isn't there.
 */
export async function gate(c: Interceptor, exports: GateExports | undefined, hosts: string[]): Promise<void> {
  const g = exports?.EgressGate?.({ props: { hosts } });
  if (!g || !c.interceptOutboundHttps || !c.interceptAllOutboundHttp)
    throw new Error("the egress gate isn't available (ctx.exports.EgressGate, and a runtime that intercepts container HTTPS)");
  await c.interceptOutboundHttps("*", g);
  await c.interceptAllOutboundHttp(g);
}
