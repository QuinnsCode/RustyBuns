// POST /api/mcp  a remote MCP server (Streamable HTTP, stateless) for agents outside
// the browser: Claude Code, Claude Desktop, any MCP client. Its tools are the
// operations of GET /api/openapi.json (openapi.ts), one per operationId, so the two
// never drift: a tool call is that HTTP call, made back through the app with the
// client's own personal API token (tokens.ts). Sign in by sending the token:
//
//   claude mcp add --transport http codesplitters https://<site>/api/mcp \
//     --header "Authorization: Bearer cst_…"
//
// A read token lists only the reads. Risky operations (openapi.ts `risky`) are marked
// destructive, so a client asks a person before it calls them. No sessions and no
// server-sent stream: each POST is one JSON-RPC request, answered as JSON.

import { json } from "./env.ts";
import { openapi } from "./openapi.ts";

type Schema = Record<string, any>;
interface Tool {
  name: string; title: string; description: string; tag: string; risky: boolean;
  inputSchema: Schema;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  method: string; path: string; pathParams: string[]; queryParams: string[]; hasBody: boolean;
}

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = "codeSplitters is a code host where every line is its own record with a stable id. "
  + "Read a file with read_file to get its line ids and revs, then edit_lines by id (a set or delete names the line's rev as base; a 409 means read again). "
  + "Files are addressed by owner, repo and path. Tools marked destructive can't be undone or ship code: ask the person first.";

/** Inline every $ref, so each tool's schema stands alone. */
const inline = (s: unknown, defs: Record<string, Schema>): any => {
  if (Array.isArray(s)) return s.map((x) => inline(x, defs));
  if (!s || typeof s !== "object") return s;
  const ref = (s as Schema).$ref;
  if (typeof ref === "string") return inline(defs[ref.split("/").at(-1)!], defs);
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, inline(v, defs)]));
};

/** The tools, from the OpenAPI spec. */
export function tools(): Tool[] {
  const spec = openapi("");
  const defs = spec.components.schemas as Record<string, Schema>;
  const out: Tool[] = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods) as [string, Schema][]) {
      const properties: Schema = {}, required: string[] = [], pathParams: string[] = [], queryParams: string[] = [];
      for (const p of op.parameters as Schema[]) {
        properties[p.name] = p.schema;
        if (p.required) required.push(p.name);
        (p.in === "path" ? pathParams : queryParams).push(p.name);
      }
      const body = op.requestBody?.content["application/json"].schema;
      if (body) {
        properties.body = inline(body, defs);
        if (body.required?.length) required.push("body");
      }
      const risky = !!op["x-codesplitters-risky"], read = method === "get";
      out.push({
        name: op.operationId, title: op.summary, tag: op.tags[0], risky,
        description: [op.summary, op.description, `(${method.toUpperCase()} /api${path})`, risky && "Can't be undone, or ships code: ask the person first."].filter(Boolean).join(" "),
        inputSchema: { type: "object", properties, ...(required.length && { required }), additionalProperties: false },
        annotations: { title: op.summary, readOnlyHint: read, destructiveHint: risky, idempotentHint: read || method === "put", openWorldHint: false },
        method: method.toUpperCase(), path, pathParams, queryParams, hasBody: !!body,
      });
    }
  }
  return out;
}

let cached: Tool[] | null = null;
const all = () => (cached ??= tools());
/** GET /api/mcp/tools: every tool, for the /mcp page. Public, like the OpenAPI spec it comes from. */
export const catalogue = () => all().map((t) => ({ ...listed(t), tag: t.tag, scope: t.method === "GET" ? "read" : "write", risky: t.risky, http: `${t.method} /api${t.path}` }));
const listed = (t: Tool) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations });

const rpc = (id: unknown, result: unknown) => json({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string, status = 200) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
const unauthorized = (why: string) => json({ error: why }, 401, { "www-authenticate": 'Bearer realm="codeSplitters", error="invalid_token"' });

/** One tool call: the HTTP call it stands for, as the token that made it. */
async function call(t: Tool, args: Record<string, unknown>, origin: string, auth: string, dispatch: (r: Request) => Promise<Response>) {
  for (const k of t.inputSchema.required ?? []) if (args[k] === undefined || args[k] === "") return { content: [{ type: "text", text: `${k} is required` }], isError: true };
  const path = t.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k])));
  const url = new URL(`${origin}/api${path}`);
  for (const k of t.queryParams) if (args[k] !== undefined && args[k] !== null) url.searchParams.set(k, String(args[k]));
  const headers: Record<string, string> = { authorization: auth };
  if (t.hasBody) headers["content-type"] = "application/json";
  const res = await dispatch(new Request(url, { method: t.method, headers, ...(t.hasBody && { body: JSON.stringify(args.body ?? {}) }) }));
  const text = await res.text();
  // A 202 is a queued request or a run that's started: an answer, not an error.
  return { content: [{ type: "text", text: res.ok ? text : `${res.status}: ${text}` }], isError: !res.ok };
}

export async function mcp(req: Request, origin: string, dispatch: (r: Request) => Promise<Response>): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST JSON-RPC here; this server keeps no sessions or streams" }, 405, { allow: "POST" });
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer\s+cst_\S+$/i.test(auth)) return unauthorized("send a personal API token from your profile page: Authorization: Bearer cst_…");

  let msg: any;
  try { msg = await req.json(); } catch { return rpcError(null, -32700, "parse error", 400); }
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "one JSON-RPC 2.0 request per POST", 400);
  // Notifications (initialized, cancelled, …) need no answer.
  if (msg.id === undefined) return new Response(null, { status: 202 });

  // Who the token is, and its scope; tool calls check it again on the way through.
  const who = await dispatch(new Request(`${origin}/api/session`, { headers: { authorization: auth } }));
  if (who.status === 401) return unauthorized(((await who.json().catch(() => ({}))) as { error?: string }).error ?? "bad token");
  const scope = ((await who.json().catch(() => ({}))) as { token?: { scope?: string } }).token?.scope;
  const mine = all().filter((t) => scope === "write" || t.method === "GET");

  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize":
      return rpc(id, {
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "codesplitters", title: "codeSplitters", version: "1" },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return rpc(id, {});
    case "tools/list":
      return rpc(id, { tools: mine.map(listed) });
    case "tools/call": {
      const t = mine.find((t) => t.name === params.name);
      if (!t) return rpcError(id, -32602, all().some((t) => t.name === params.name) ? `${params.name} needs a write token` : `no tool ${params.name}`);
      return rpc(id, await call(t, params.arguments ?? {}, origin, auth, dispatch));
    }
    default:
      return rpcError(id, -32601, `no method ${method}`);
  }
}
