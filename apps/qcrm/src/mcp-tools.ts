// Every API operation as a tool, from the OpenAPI spec (openapi.ts), so the doors never drift:
// the MCP server (mcp.ts), the page's commands (Cmd/Ctrl-K, WebMCP and window.__commands, through
// app/api-commands.ts) and the command line (scripts/cli.ts) all list these and call them with
// `toRequest`. Like the spec it imports nothing else, so a docs page, the browser and a script can load it.

import { openapi } from "./openapi.ts";

type Schema = Record<string, any>;
export interface Tool {
  name: string; title: string; description: string; tag: string; risky: boolean; open: boolean;
  /** The least role that may call it (x-qcrm-role), when the spec names one. */
  role: string | null;
  /** Refuses API keys: only a signed-in browser may call it. Left out of `tools()` unless asked for. */
  cookieOnly: boolean;
  inputSchema: Schema;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  method: string; path: string; pathParams: string[]; queryParams: string[]; hasBody: boolean;
}

/** Inline every $ref, so each tool's schema stands alone. */
const inline = (s: unknown, defs: Record<string, Schema>): any => {
  if (Array.isArray(s)) return s.map((x) => inline(x, defs));
  if (!s || typeof s !== "object") return s;
  const ref = (s as Schema).$ref;
  if (typeof ref === "string") return inline(defs[ref.split("/").at(-1)!], defs);
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, inline(v, defs)]));
};

/** The tools. A key can't call cookie-only operations, so MCP and the CLI leave them out; the signed-in page asks for them. */
export function tools(o: { cookieOnly?: boolean } = {}): Tool[] {
  const spec = openapi("");
  const defs = spec.components.schemas as Record<string, Schema>;
  const out: Tool[] = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods) as [string, Schema][]) {
      const cookieOnly = !!op["x-qcrm-cookie-only"];
      if (cookieOnly && !o.cookieOnly) continue; // a key is refused there: no tool to try
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
      const risky = !!op["x-qcrm-risky"], read = method === "get";
      out.push({
        name: op.operationId, title: op.summary, tag: op.tags[0], risky, open: !!op.security?.some((s: Schema) => !Object.keys(s).length),
        role: op["x-qcrm-role"] ?? null, cookieOnly,
        description: [op.summary, op.description, op["x-qcrm-role"] && `Needs ${op["x-qcrm-role"]} or above.`, `(${method.toUpperCase()} /api${path})`,
          risky && "Changes who can get in or see what, can't be undone, or hands out the whole org: ask the person first."].filter(Boolean).join(" "),
        inputSchema: { type: "object", properties, ...(required.length && { required }), additionalProperties: false },
        annotations: { title: op.summary, readOnlyHint: read, destructiveHint: risky, idempotentHint: read || method === "put", openWorldHint: false },
        method: method.toUpperCase(), path, pathParams, queryParams, hasBody: !!body,
      });
    }
  }
  return out;
}

/**
 * The HTTP call a tool stands for, or what's wrong with its arguments. `origin` may be "" for a same-origin page.
 * Agents often send a row's fields beside `org` rather than under `body` (`{ org, first_name }`): those go into the
 * body, as the CLI's flags do. A name the tool can't take is refused rather than dropped, which made blank rows.
 */
export function toRequest(t: Tool, input: Record<string, unknown>, origin: string, headers: Record<string, string>): Request | string {
  const args: Record<string, unknown> = {}, loose: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) (k === "body" || t.pathParams.includes(k) || t.queryParams.includes(k) ? args : loose)[k] = v;
  const stray = Object.keys(loose);
  if (stray.length && !t.hasBody) return `${t.name} takes no ${stray.join(", ")}: its arguments are ${Object.keys(t.inputSchema.properties).join(", ") || "none"}`;
  if (stray.length) args.body = { ...(args.body && typeof args.body === "object" ? args.body : {}), ...loose };
  for (const k of t.inputSchema.required ?? []) if (args[k] === undefined || args[k] === "") return `${k} is required`;
  const path = t.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k])));
  const url = new URL(`${origin}/api${path}`, origin || globalThis.location?.origin);
  for (const k of t.queryParams) if (args[k] !== undefined && args[k] !== null) url.searchParams.set(k, String(args[k]));
  if (t.hasBody) headers = { ...headers, "content-type": "application/json" };
  return new Request(url, { method: t.method, headers, ...(t.hasBody && { body: JSON.stringify(args.body ?? {}) }) });
}

/** Whether `role` reaches a tool's least role (seasonal < employee < manager < owner < admin < super_admin). */
const RANKS = ["seasonal", "employee", "manager", "owner", "admin", "super_admin"];
export const reaches = (role: string, least: string | null) => !least || RANKS.indexOf(role) >= RANKS.indexOf(least);
