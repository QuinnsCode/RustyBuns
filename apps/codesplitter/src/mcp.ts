// POST /api/mcp  a remote MCP server (Streamable HTTP, stateless) for agents outside
// the browser: Claude Code, Claude Desktop, any MCP client. Its tools are the
// operations of GET /api/openapi.json (openapi.ts), one per operationId, so the two
// never drift: a tool call is that HTTP call, made back through the app with the
// client's own personal API token (tokens.ts). Sign in by sending the token:
//
//   claude mcp add --transport http codesplitter https://<site>/api/mcp \
//     --header "Authorization: Bearer cst_…"
//
// Or sign in with OAuth (oauth.ts): with no header, the 401 points the client at
// /.well-known/oauth-protected-resource/api/mcp, and it opens a sign-in page.
//
// A read token lists only the reads. Risky operations (openapi.ts `risky`: what changes
// who can get in or see what, can't be undone, or ships code) are marked destructive, so
// a client asks a person before it calls them. The hint is the client's to heed; the
// routes check who may call them all the same. No sessions and no
// server-sent stream: each POST is one JSON-RPC request, answered as JSON.

import { json } from "./env.ts";
import { tools, type Tool } from "./mcp-tools.ts";

export { tools, type Tool };

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = "codeSplitter is a code host where every line is its own record with a stable id. "
  + "Read a file with read_file to get its line ids and revs, then edit_lines by id (a set or delete names the line's rev as base; a 409 means read again). "
  + "Before rewriting a block, claim_lines it, send its claim id with your edits (that renews the 2-minute lease), and release_claim when done. When a line is held, work elsewhere and come back after retryAfter; never poll. If your task needs those very lines, claim_lines with wait to get in line (let go of what you hold first). To say what you're about to do without keeping anyone off, claim_lines with soft. "
  + "Files are addressed by owner, repo and path. Given an invite link (…/invite/csi_…), claim it with claim_invite, as: agent, then connect again with the token it gives you. Tools marked destructive change who can get in or see what, can't be undone, or ship code: ask the person first.";

let cached: Tool[] | null = null;
const all = () => (cached ??= tools());
/** GET /api/mcp/tools: every tool, for the /mcp page. Public, like the OpenAPI spec it comes from. */
export const catalogue = () => all().map((t) => ({ ...listed(t), tag: t.tag, scope: t.method === "GET" ? "read" : "write", risky: t.risky, http: `${t.method} /api${t.path}` }));
const listed = (t: Tool) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations });

const rpc = (id: unknown, result: unknown) => json({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string, status = 200) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
const unauthorized = (why: string, origin: string) => json({ error: why }, 401,
  { "www-authenticate": `Bearer realm="codeSplitter", error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"` });

/** A tool by name (the CLI, cli.ts, calls them too). */
export const tool = (name: string) => all().find((t) => t.name === name);

/** The HTTP call a tool stands for, or what's missing from its arguments. */
export function toRequest(t: Tool, args: Record<string, unknown>, origin: string, headers: Record<string, string>): Request | string {
  for (const k of t.inputSchema.required ?? []) if (args[k] === undefined || args[k] === "") return `${k} is required`;
  const path = t.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k])));
  const url = new URL(`${origin}/api${path}`);
  for (const k of t.queryParams) if (args[k] !== undefined && args[k] !== null) url.searchParams.set(k, String(args[k]));
  if (t.hasBody) headers = { ...headers, "content-type": "application/json" };
  return new Request(url, { method: t.method, headers, ...(t.hasBody && { body: JSON.stringify(args.body ?? {}) }) });
}

/** One tool call: the HTTP call it stands for, as the token that made it. */
async function call(t: Tool, args: Record<string, unknown>, origin: string, auth: string, dispatch: (r: Request) => Promise<Response>) {
  const req = toRequest(t, args, origin, { authorization: auth });
  if (typeof req === "string") return { content: [{ type: "text", text: req }], isError: true };
  const res = await dispatch(req);
  const text = await res.text();
  // A 202 is a queued request or a run that's started: an answer, not an error.
  return { content: [{ type: "text", text: res.ok ? text : `${res.status}: ${text}` }], isError: !res.ok };
}

export async function mcp(req: Request, origin: string, dispatch: (r: Request) => Promise<Response>): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST JSON-RPC here; this server keeps no sessions or streams" }, 405, { allow: "POST" });
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer\s+cst_\S+$/i.test(auth)) return unauthorized("sign in with OAuth, or send a personal API token from your profile page: Authorization: Bearer cst_…", origin);

  // The client's message: each field unknown until checked. An array is a batch, which we don't take.
  let msg: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown } | null;
  try { msg = await req.json(); } catch { return rpcError(null, -32700, "parse error", 400); }
  if (Array.isArray(msg) || msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "one JSON-RPC 2.0 request per POST", 400);
  // Notifications (initialized, cancelled, …) need no answer.
  if (msg.id === undefined) return new Response(null, { status: 202 });

  // Who the token is, and its scope; tool calls check it again on the way through.
  const who = await dispatch(new Request(`${origin}/api/session`, { headers: { authorization: auth } }));
  if (who.status === 401) return unauthorized(((await who.json().catch(() => ({}))) as { error?: string }).error ?? "bad token", origin);
  const scope = ((await who.json().catch(() => ({}))) as { token?: { scope?: string } }).token?.scope;
  const mine = all().filter((t) => scope === "write" || scope === "admin" || t.method === "GET");

  const { id, method } = msg, params = (msg.params ?? {}) as { protocolVersion?: unknown; name?: unknown; arguments?: unknown };
  switch (method) {
    case "initialize":
      return rpc(id, {
        protocolVersion: VERSIONS.find((v) => v === params.protocolVersion) ?? VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "codesplitter", title: "codeSplitter", version: "1" },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return rpc(id, {});
    case "tools/list":
      return rpc(id, { tools: mine.map(listed) });
    case "tools/call": {
      const t = mine.find((t) => t.name === params.name);
      if (!t) return rpcError(id, -32602, all().some((t) => t.name === params.name) ? `${params.name} needs a write token` : `no tool ${params.name}`);
      // toRequest only String()s or re-serializes each argument, and the API route it calls checks them.
      return rpc(id, await call(t, (params.arguments ?? {}) as Record<string, unknown>, origin, auth, dispatch));
    }
    default:
      return rpcError(id, -32601, `no method ${method}`);
  }
}
