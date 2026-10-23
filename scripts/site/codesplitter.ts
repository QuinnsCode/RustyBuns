// The codeSplitter docs site: its README as the home page, a page per feature from REFERENCE.md, and
// an API reference generated from the same OpenAPI object GET /api/openapi.json serves
// (apps/codesplitter/src/openapi.ts), with the MCP tools it derives (src/mcp-tools.ts). Change an
// endpoint and its page changes in the same PR. A version without those two importable files (from
// before they stopped importing the rest of the app) gets the feature pages only.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, type Site, type Source, slug, titleOf } from "./lib.ts";

const APP = "apps/codesplitter";
const LIVE = "https://codesplitter.notryanquinn.workers.dev";

type Schema = Record<string, any>;
type Tool = { name: string; title: string; tag: string; risky: boolean; method: string; path: string; inputSchema: Schema };
type Api = { spec: Schema; tools?: Tool[] };

const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const tagPage = (tag: string) => `api/${slug(tag)}.html`;

// openapi.ts and mcp-tools.ts at this version, run in a child bun so a broken or missing one costs
// that version its API pages, not the whole build.
function loadApi(src: Source): Api | undefined {
  const spec = src.read(`${APP}/src/openapi.ts`);
  if (!spec) return;
  const dir = mkdtempSync(join(tmpdir(), "codesplitter-api-"));
  try {
    writeFileSync(join(dir, "openapi.ts"), spec);
    const tools = src.read(`${APP}/src/mcp-tools.ts`);
    if (tools) writeFileSync(join(dir, "mcp-tools.ts"), tools);
    const script = `const { openapi } = await import(${JSON.stringify(join(dir, "openapi.ts"))});
      const tools = ${tools ? `(await import(${JSON.stringify(join(dir, "mcp-tools.ts"))})).tools()` : "undefined"};
      console.log(JSON.stringify({ spec: openapi(${JSON.stringify(LIVE)}), tools }));`;
    const out = Bun.spawnSync([process.execPath, "-e", script], { cwd: dir, stderr: "pipe" });
    if (out.exitCode !== 0) {
      console.warn(`codeSplitter ${src.version}: no API pages, openapi.ts didn't load on its own: ${out.stderr.toString().trim().split("\n")[0]}`);
      return;
    }
    return JSON.parse(out.stdout.toString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A schema's type in a few words, with named schemas linked to their entry on the Schemas page.
function typeOf(s: Schema | undefined, from: string): string {
  if (!s) return "any";
  if (s.$ref) {
    const name = String(s.$ref).split("/").at(-1)!;
    return `[${name}](${from === "api/schemas.html" ? "" : "schemas.html"}#${slug(name)})`;
  }
  if (s.enum) return s.enum.map((v: unknown) => `\`${JSON.stringify(v)}\``).join(" or ");
  if (s.oneOf) return s.oneOf.map((x: Schema) => typeOf(x, from)).join(" or ");
  if (s.type === "array") return `array of ${typeOf(s.items, from)}`;
  if (Array.isArray(s.type)) return s.type.join(" or ");
  return s.type ?? "any";
}

// An object's fields as a nested list; inline objects (and arrays of them) list theirs underneath.
function fields(s: Schema | undefined, from: string, indent = ""): string[] {
  const props = s?.properties as Record<string, Schema> | undefined;
  if (!props) return [];
  const required = new Set<string>(s!.required ?? []);
  return Object.entries(props).flatMap(([name, p]) => {
    const what = [typeOf(p, from), required.has(name) && "required"].filter(Boolean).join(", ");
    const inner = p.type === "array" && p.items?.properties ? p.items : p;
    return [`${indent}- \`${name}\` (${what})${p.description ? `: ${p.description}` : ""}`, ...fields(inner, from, `${indent}  `)];
  });
}

// What a schema is, then its fields if it has any.
function describe(s: Schema | undefined, from: string): string {
  const list = fields(s?.type === "array" ? s.items : s, from);
  const type = typeOf(s, from);
  // A plain object says what it is through its fields.
  const head = [type === "object" && list.length ? "" : type, !s?.$ref && s?.description].filter(Boolean).join(": ");
  return [head, ...list].filter(Boolean).join("\n");
}

type Op = { method: string; path: string; op: Schema };

function operation({ method, path, op }: Op, from: string): string {
  const open = (op.security as Schema[]).some((x) => Object.keys(x).length === 0);
  const scope = op["x-codesplitter-scope"] ?? (method === "get" ? "read" : "write");
  const risky = op["x-codesplitter-risky"] === true;
  const out = [
    `## ${op.operationId}`,
    "",
    `\`${method.toUpperCase()} /api${path}\` · ${scope} scope · ${open ? "open to anyone (a token sees more)" : "needs a token"}${risky ? " · ⚠️ **risky** (`x-codesplitter-risky`)" : ""}`,
    "",
    `${op.summary}.${op.description ? ` ${op.description}` : ""}`,
  ];
  if (risky) out.push("", "> Risky: it changes who can get in or see what, can't be undone, or ships code. A gateway or MCP client should ask a person before calling it.");
  const params = op.parameters as Schema[];
  if (params.length) {
    out.push("", "**Parameters**", "", "| Name | In | Type | Description |", "|---|---|---|---|");
    for (const p of params) out.push(`| \`${p.name}\`${p.required ? " (required)" : ""} | ${p.in} | ${cell(typeOf(p.schema, from))} | ${cell(p.schema?.description)} |`);
  }
  const body = op.requestBody?.content?.["application/json"]?.schema;
  if (body) out.push("", "**Body** (JSON)", "", describe(body, from));
  const [status, ok] = Object.entries(op.responses as Record<string, Schema>).find(([code]) => code.startsWith("2"))!;
  out.push("", `**Answers ${status}**`, "", describe(ok.content?.["application/json"]?.schema, from));
  return out.join("\n");
}

function apiPages(api: Api, ref: string): Page[] {
  const { spec, tools } = api;
  const github = (file: string) => `https://github.com/QuinnsCode/RustyBuns/blob/${ref}/${APP}/${file}`;
  const from = `${APP}/src/openapi.ts`;
  const byTag = new Map<string, Op[]>();
  for (const [path, methods] of Object.entries(spec.paths as Record<string, Record<string, Schema>>))
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags?.[0] ?? "Other";
      byTag.set(tag, [...(byTag.get(tag) ?? []), { method, path, op }]);
    }
  const all = [...byTag.values()].flat();
  const risky = all.filter((o) => o.op["x-codesplitter-risky"]);
  const errors = Object.entries((all[0]?.op.responses ?? {}) as Record<string, Schema>).filter(([code]) => !code.startsWith("2"));
  const opLink = (o: Op, here: string) => `[\`${o.op.operationId}\`](${here === tagPage(o.op.tags[0]) ? "" : tagPage(o.op.tags[0]).slice(4)}#${slug(o.op.operationId)})`;

  const overview = [
    "# API reference",
    "",
    `Generated from [\`src/openapi.ts\`](${github("src/openapi.ts")}), the object \`GET /api/openapi.json\` serves, so it lists exactly what this version's server answers. ${all.length} operations in ${byTag.size} groups.`,
    "",
    spec.info?.description ?? "",
    "",
    `Every path is under \`${spec.servers?.[0]?.url ?? `${LIVE}/api`}\`. Fetch the spec itself from [\`/api/openapi.json\`](${LIVE}/api/openapi.json) to point a gateway at it.`,
    "",
    "## Groups",
    "",
    "| Group | Operations |",
    "|---|---|",
    ...[...byTag].map(([tag, ops]) => `| [${tag}](${tagPage(tag).slice(4)}) | ${ops.length} |`),
    "",
    "## Signing in",
    "",
    ...Object.entries((spec.components?.securitySchemes ?? {}) as Record<string, Schema>).map(([name, s]) => `- **${name}** (${s.type}${s.scheme ? `, ${s.scheme}` : ""}): ${s.description ?? ""}`),
    "",
    "A GET needs the read scope and anything else the write scope. Operations marked open answer without a token too.",
    "",
    "## Risky operations",
    "",
    `These ${risky.length} carry \`x-codesplitter-risky: true\`: they change who can get in or see what, can't be undone, or ship code. The MCP server marks them destructive, so a client asks a person first. The server's own checks are what hold either way.`,
    "",
    ...risky.map((o) => `- ${opLink(o, "api/index.html")}: ${o.op.summary}`),
    "",
    "## Errors",
    "",
    "Every operation can answer these, as `{ \"error\": \"…\" }`:",
    "",
    "| Status | When |",
    "|---|---|",
    ...errors.map(([code, r]) => `| ${code} | ${cell(r.description)} |`),
    "",
  ].join("\n");

  const pages: Page[] = [{ path: "api/index.html", title: "API reference", md: overview, from, section: "API" }];
  for (const [tag, ops] of byTag) {
    const path = tagPage(tag);
    const toc = ops.map((o) => `- ${opLink(o, path)} \`${o.method.toUpperCase()} /api${o.path}\`${o.op["x-codesplitter-risky"] ? " ⚠️" : ""}: ${o.op.summary}`);
    const md = [`# ${tag}`, toc.join("\n"), ...ops.map((o) => operation(o, path))].join("\n\n") + "\n";
    pages.push({ path, title: tag, md, from, anchor: slug(tag), section: "API" });
  }

  const schemas = Object.entries((spec.components?.schemas ?? {}) as Record<string, Schema>);
  pages.push({
    path: "api/schemas.html",
    title: "Schemas",
    md: ["# Schemas", "", "The shapes operations refer to by name.", "", ...schemas.flatMap(([name, s]) => [`## ${name}`, "", describe(s, "api/schemas.html"), ""])].join("\n"),
    from,
    anchor: "schemas",
    section: "API",
  });

  if (tools) {
    const byName = new Map(all.map((o) => [o.op.operationId as string, o]));
    const rows = tools.map((t) => {
      const o = byName.get(t.name);
      return `| ${o ? opLink(o, "api/mcp.html") : `\`${t.name}\``} | ${t.tag} | \`${t.method} /api${t.path}\` | ${t.method === "GET" ? "read" : "write"} | ${t.risky ? "⚠️ destructive" : ""} | ${cell(t.title)} |`;
    });
    pages.push({
      path: "api/mcp.html",
      title: "MCP tools",
      md: [
        "# MCP tools",
        "",
        `\`POST /api/mcp\` is a remote MCP server. Its ${tools.length} tools are the [API reference](index.html)'s operations, one per \`operationId\` ([\`src/mcp-tools.ts\`](${github("src/mcp-tools.ts")})), so the two never drift: a tool call is that HTTP call, made with your own token. A read token lists only the reads. Risky operations are marked destructive, so your client asks before it calls them.`,
        "",
        `The server is in code mode: it lists \`search_tools\`, \`describe_tools\`, \`execute\` and \`call_tool\`, and an agent writes one JavaScript program that calls the others (\`await tools.read_file({ owner, repo, path })\`) and returns only what it needs, so the schemas and the answers it only filters stay out of its context. A program runs in a Worker of its own with no network, as your token, and the risky tools go through \`call_tool\` so your client still asks first. Add \`?mode=tools\` to the URL, or send \`x-codesplitter-tools: all\`, for the full list below.`,
        "",
        "```sh",
        `claude mcp add --transport http codesplitter ${LIVE}/api/mcp`,
        "```",
        "",
        "Each tool takes the operation's path and query parameters as arguments, and its JSON body as `body`. The same tools are commands in the CLI (`codesplitter tools`).",
        "",
        "| Tool | Group | HTTP | Scope | Risky | What it does |",
        "|---|---|---|---|---|---|",
        ...rows,
        "",
      ].join("\n"),
      from: `${APP}/src/mcp-tools.ts`,
      section: "API",
    });
  }
  return pages;
}

// REFERENCE.md's "Features in detail": each `- **Lead.** …` bullet and `**Lead** …` paragraph is a
// page, and so is each `###` under it (deploying, accounts, hosted deploys...). The docs keep one
// sentence per line (#935), so a line that starts in bold only starts a page after a blank line.
function featurePages(reference: string): Page[] {
  const from = `${APP}/REFERENCE.md`;
  const section = reference.match(/\n## Features in detail\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
  const [blocks = "", ...subs] = section.split(/\n(?=### )/);
  const pages: Page[] = [];
  const seen = new Set<string>();
  for (const block of blocks.split(/\n(?=- \*\*)|\n\n(?=\*\*)/)) {
    const text = block.trim().replace(/^- /, "");
    const lead = text.match(/^\*\*(.+?)\*\*/)?.[1];
    if (!lead) continue;
    const title = lead.replace(/[.:]$/, "").replace(/`/g, "");
    const anchor = slug(title);
    if (seen.has(anchor)) continue;
    seen.add(anchor);
    pages.push({ path: `features/${anchor}.html`, title, md: `# ${title}\n\n${text}\n`, from, anchor, section: "Features" });
  }
  for (const sub of subs) {
    const [, heading = "", body = ""] = sub.match(/^### (.+)\n([\s\S]*)$/) ?? [];
    const anchor = slug(heading);
    pages.push({ path: `running/${anchor}.html`, title: heading.replace(/`/g, ""), md: `# ${heading}\n${body.replace(/^(#{4,6}) /gm, (h) => h.slice(2))}`, from, anchor, section: "Running it" });
  }
  return pages;
}

export const codesplitter: Site = {
  name: "codeSplitter",
  tagline: "Git for the agentic era: every line is its own record, and git keeps going when other gits don't.",
  repo: "QuinnsCode/RustyBuns",
  ogImage: "og-codesplitter.png",
  pages(src) {
    const readme = src.read(`${APP}/README.md`) ?? "# codeSplitter\n";
    const reference = src.read(`${APP}/REFERENCE.md`);
    const pages: Page[] = [{ path: "index.html", title: "codeSplitter", md: readme, from: `${APP}/README.md` }];
    if (reference) {
      pages.push({ path: "reference.html", title: titleOf(reference, "Reference"), md: reference, from: `${APP}/REFERENCE.md` });
      pages.push(...featurePages(reference));
    }
    const api = loadApi(src);
    if (api) pages.push(...apiPages(api, src.ref));
    return pages;
  },
};
