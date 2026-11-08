// The MCP server's tools (mcp.ts), one per operation of the OpenAPI spec (openapi.ts).
// Like the spec, it imports nothing else, so the docs site (scripts/site/codesplitter.ts)
// lists the same tools the server does.

import { openapi } from "./openapi.ts";

type Schema = Record<string, any>;
export interface Tool {
  name: string; title: string; description: string; tag: string; risky: boolean;
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

/** An operation's named failures (#3804), for its description: the `tag` a failed call's reply carries. */
const failsWith = (op: Schema) => {
  const e: { tag: string }[] = op["x-codesplitter-errors"] ?? [];
  return e.length ? `Fails with (the reply's tag): ${e.map((x) => x.tag).join(", ")}.` : "";
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
      const risky = !!op["x-codesplitter-risky"], read = method === "get";
      out.push({
        name: op.operationId, title: op.summary, tag: op.tags[0], risky,
        description: [op.summary, op.description, `(${method.toUpperCase()} /api${path})`, risky && "Changes who can get in or see what, can't be undone, or ships code: ask the person first.", failsWith(op)].filter(Boolean).join(" "),
        inputSchema: { type: "object", properties, ...(required.length && { required }), additionalProperties: false },
        annotations: { title: op.summary, readOnlyHint: read, destructiveHint: risky, idempotentHint: read || method === "put", openWorldHint: false },
        method: method.toUpperCase(), path, pathParams, queryParams, hasBody: !!body,
      });
    }
  }
  return out;
}
