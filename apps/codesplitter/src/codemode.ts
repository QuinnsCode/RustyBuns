// Code mode for the MCP server (mcp.ts). Listing 150 tools costs an agent their schemas in
// context before it does anything, and every call hands a whole answer (a file's every line)
// back through the model. In code mode the server lists four tools instead: search_tools and
// describe_tools find and explain the others on demand, and execute runs a program the agent
// writes, where each tool is `await tools.<name>({...})` and only what the program returns
// comes back. call_tool is the way to a risky tool, so the client asks the person first.
//
// A program is a dynamic Worker (env.LOADER, the worker_loader binding) with no network
// (`globalOutbound: null`) and one binding, CS: a fetcher we make in-process that makes each
// tool's HTTP call back into this app as the token that called execute, so the program has
// that token's scope and rate limits, and never sees the token itself. It is on only where
// there is a loader; without one the server lists every tool, as before.
// Before a program runs, it is read for tools that don't exist, and each call's arguments are checked
// against the tool's schema, so a typo fails at once with what is wrong, not after a request.
// Imports only types, like mcp-tools.ts, so the docs site can list the tools.

import type { Tool } from "./mcp-tools.ts";
import { runProgram, type Ran, type ToolAnswer, type WorkerLoaderLike } from "@rustybuns/util/codemode";

export type { Ran, ToolAnswer };

export const MAX_CALLS = 100;
export const RUN_MS = 20_000;
/** CPU a program may burn: its tool calls are waits, not CPU, so this is room for the filtering and joins between them. */
export const CPU_MS = 2_000;
export const MAX_BACK = 20_000;
export const MAX_CODE = 64_000;

type Schema = Record<string, any>;
export interface MetaTool { name: string; title: string; description: string; inputSchema: Schema; annotations: Tool["annotations"] }

const EXAMPLE = [
  "const f = await tools.read_file({ owner, repo, path });",
  "const todo = f.lines.filter((l) => l.text.includes('TODO'));",
  "const c = await tools.claim_lines({ owner, repo, path, body: { lines: todo.map((l) => l.id), task: 'clearing TODOs' } });",
  "try { await tools.edit_lines({ owner, repo, path, body: { claim: c.id, ops: todo.map((l) => ({ kind: 'set', line: l.id, base: l.rev, text: l.text.replace('TODO', 'DONE') })) } }); }",
  "finally { await tools.release_claim({ owner, repo, path, body: { id: c.id } }); }",
  "return { edited: todo.length };",
].join("\n");

const annotations = (title: string, o: Partial<Tool["annotations"]> = {}) => ({ title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...o });
const obj = (properties: Schema, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });

/** The tools code mode lists. */
export const META: MetaTool[] = [
  { name: "search_tools", title: "Find codeSplitter tools",
    description: "Find tools by what they do: words like \"claim lines\" or \"merge branch\". Answers each match as a call signature (name, its arguments, ? for optional) and a line on what it does. An empty query lists every tool name by group. Then describe_tools for the exact schemas, and execute to call them.",
    inputSchema: obj({ query: { type: "string", description: "words to look for; empty for every name" }, limit: { type: "integer", description: "at most this many matches (default 12)" } }, ["query"]),
    annotations: annotations("Find codeSplitter tools", { readOnlyHint: true, idempotentHint: true }) },
  { name: "describe_tools", title: "Describe codeSplitter tools",
    description: "The full input schema and description of the named tools, so a program passes the right arguments. Ask for just the ones you will call.",
    inputSchema: obj({ names: { type: "array", items: { type: "string" }, description: "tool names, from search_tools" } }, ["names"]),
    annotations: annotations("Describe codeSplitter tools", { readOnlyHint: true, idempotentHint: true }) },
  { name: "execute", title: "Run a program over the tools",
    description: "Run JavaScript over codeSplitter's tools and get back only what it returns. Prefer this to calling tools one at a time: read, filter, claim, edit and release in one program, and the file's lines never enter your context. "
      + "The program is the body of an async function. Each tool is `await tools.<name>({...})`, with the arguments describe_tools gives; its JSON answer comes back parsed, and an error throws with its status first and then the JSON reply, whose tag names the failure (`409: {\"tag\":\"LinesChanged\",…}`, so catch it, read again and retry). console.log lines come back too. "
      + "`return` a small answer: a count, ids, a few lines, never a whole file. "
      + `At most ${MAX_CALLS} tool calls, ${RUN_MS / 1000} s, ${MAX_BACK.toLocaleString("en")} characters back; no network but the tools. Your token's scope applies. Tools marked risky (they ship code, change who can get in or see what, or can't be undone) aren't callable here: use call_tool, so the person is asked. `
      + "A program that worked can be kept: save_program({ name, body: { code, description } }), then execute { program: name, input } reruns it, and list_programs lists yours; write programs to take what varies (owner, repo, path) from `input`. "
      + `Example, with owner, repo and path as consts you set first:\n${EXAMPLE}`,
    inputSchema: obj({ code: { type: "string", description: "the body of an async function; use `return` for the answer" },
      program: { type: "string", description: "the name of a program saved with save_program, to run instead of code" },
      input: { description: "any JSON; the program reads it as `input`" } }, []),
    annotations: annotations("Run a program over the tools") },
  { name: "call_tool", title: "Call a risky tool",
    description: "Call one tool that ships code, changes who can get in or see what, or can't be undone (search_tools marks these risky). Your client asks the person before this runs. Everything else goes through execute.",
    inputSchema: obj({ name: { type: "string" }, arguments: { type: "object", description: "the tool's arguments, as describe_tools gives them" } }, ["name"]),
    annotations: annotations("Call a risky tool", { destructiveHint: true }) },
];

/** What the server says to an agent in code mode, after the instructions that hold either way. */
export const INSTRUCTIONS = " Tools are reached by code: search_tools finds one, describe_tools gives its arguments, and execute runs a JavaScript program that calls them (`await tools.read_file({...})`) and returns only what you need, so a file's lines and each step's answer stay out of your context. "
  + "Write one program for a whole job (read, filter, claim, edit, release), not a call per step. call_tool is for the risky tools only.";

/** `name({ a, b?, body: { c, d? } })`: how to call a tool, without its schema. */
export function signature(t: Tool): string {
  const need = new Set(t.inputSchema.required ?? []);
  const parts = Object.entries(t.inputSchema.properties as Schema).map(([k, s]) => {
    if (k === "body" && s.properties) { const b = new Set<string>(s.required ?? []); return `body${need.has(k) ? "" : "?"}: { ${Object.keys(s.properties).map((f) => f + (b.has(f) ? "" : "?")).join(", ")} }`; }
    return k + (need.has(k) ? "" : "?");
  });
  return `${t.name}({ ${parts.join(", ")} })`;
}

/** The tools that best match the words, as `signature  summary` lines; with no words, every name under its group. */
export function search(all: Tool[], query: string, limit = 12): string {
  const words = query.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  if (!words.length) {
    const groups = new Map<string, string[]>();
    for (const t of all) groups.set(t.tag, [...groups.get(t.tag) ?? [], t.name]);
    return [...groups].map(([g, names]) => `${g}: ${names.join(", ")}`).join("\n");
  }
  const score = (t: Tool) => words.reduce((n, w) => n + (t.name.includes(w) ? 3 : 0) + (t.title.toLowerCase().includes(w) ? 2 : 0) + (t.tag.toLowerCase().includes(w) ? 1 : 0) + (t.description.toLowerCase().includes(w) ? 1 : 0), 0);
  const hits = all.map((t) => [t, score(t)] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, Math.max(1, Math.min(limit, 40)));
  if (!hits.length) return `no tool matches "${query}": search with an empty query to see every name`;
  return hits.map(([t]) => `${signature(t)}  ${t.title}${t.risky ? " [risky: call_tool]" : ""}`).join("\n");
}

/** Each named tool's description and schema, and which names there is no tool for. */
export function describe(all: Tool[], names: string[]): string {
  const out = names.map((n) => {
    const t = all.find((t) => t.name === n);
    return t ? { name: t.name, description: t.description, inputSchema: t.inputSchema, risky: t.risky } : { name: n, error: "no such tool (or it needs a write token)" };
  });
  return JSON.stringify(out);
}

/** What is wrong with `v` against a tool's schema (type, enum, required, unknown names), as short phrases; [] when it fits. */
export function check(schema: Schema, v: unknown, at = "", out: string[] = []): string[] {
  if (v === null || v === undefined || out.length >= 8) return out;
  const where = at || "arguments", t = schema.type;
  const kind = Array.isArray(v) ? "array" : typeof v;
  const numeric = typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v));
  // Path and query arguments are String()ed on the way out, so "10" for a number and "true" for a boolean pass as before.
  const fits = !t || (t === "integer" ? Number.isInteger(v) || (numeric && Number.isInteger(Number(v))) : t === "number" ? kind === "number" || numeric : t === "boolean" ? kind === "boolean" || v === "true" || v === "false" : t === "object" ? kind === "object" : kind === t);
  if (!fits) return out.push(`${where} should be ${t}, got ${kind}`), out;
  if (Array.isArray(schema.enum) && !schema.enum.includes(v)) out.push(`${where} must be one of ${schema.enum.join(", ")}, got ${JSON.stringify(v)}`);
  if (kind === "object" && schema.properties) {
    const o = v as Record<string, unknown>;
    for (const k of schema.required ?? []) if (o[k] === undefined) out.push(`${at ? at + "." : ""}${k} is required`);
    for (const [k, x] of Object.entries(o)) {
      if (schema.properties[k]) check(schema.properties[k], x, `${at ? at + "." : ""}${k}`, out);
      else if (schema.additionalProperties === false) out.push(`${at ? at + "." : ""}${k} is not an argument (${Object.keys(schema.properties).join(", ")})`);
    }
  } else if (Array.isArray(v) && schema.items) v.forEach((x, i) => check(schema.items, x, `${where}[${i}]`, out));
  return out;
}

/** Makes a stub of the worker's CSBridge entrypoint for one caller; worker.ts sets it on the edge (under Bun there is none). */
export const edge: { stub?: (props: unknown) => unknown } = {};

/** The caller a binding answers as: where to call back, with which token, what that token may use, and the address the MCP call came from (its calls count against it). */
export interface CSProps { origin: string; auth: string; scope?: string; ip?: string }

/** The props a stub arrived with, checked: they cross a process boundary, so no field is taken on trust. */
export function csProps(x: unknown): CSProps {
  const p = (x && typeof x === "object" ? x : {}) as { origin?: unknown; auth?: unknown; scope?: unknown; ip?: unknown };
  if (typeof p.origin !== "string" || typeof p.auth !== "string") throw new Error("CSBridge needs the caller's origin and token");
  return { origin: p.origin, auth: p.auth, scope: typeof p.scope === "string" ? p.scope : undefined, ...(typeof p.ip === "string" ? { ip: p.ip } : {}) };
}

/** One tool's answer to a program's call: the HTTP call it stands for, made as the caller. Only plain values cross. */
export async function answer(tools: Tool[], run: (t: Tool, args: Record<string, unknown>) => Promise<ToolAnswer>, name: string, json: string): Promise<ToolAnswer> {
  const fail = (status: number, error: string): ToolAnswer => ({ status, text: JSON.stringify({ error }) });
  const t = tools.find((t) => t.name === name);
  if (!t) return fail(404, `no tool ${name} for this token: search_tools lists them`);
  if (t.risky) return fail(403, `${name} is risky (it ships code, changes who can get in or see what, or can't be undone): ask for it with call_tool, so the person is asked`);
  let args: unknown;
  try { args = JSON.parse(json); } catch { return fail(400, "arguments must be JSON"); }
  if (!args || typeof args !== "object" || Array.isArray(args)) return fail(400, "arguments are an object");
  const bad = check(t.inputSchema, args);
  if (bad.length) return fail(400, `${name}: ${bad.join("; ")} (describe_tools gives the schema)`);
  return run(t, args as Record<string, unknown>);
}

/** Run `code` over `tools` as the caller (`run` makes each call), in a Worker of its own. */
export function execute(loader: WorkerLoaderLike, code: string, tools: Tool[], run: (t: Tool, args: Record<string, unknown>) => Promise<ToolAnswer>, input?: unknown, edge?: unknown): Promise<Ran> {
  // On the edge the binding is a stub of the worker's own CSBridge entrypoint (a plain object can't be an env binding there);
  // under Bun, where the local loader runs the program in-process, an object will do.
  return runProgram(loader, code, {
    binding: "CS", names: tools.map((t) => t.name), run: (name, json) => answer(tools, run, name, json), bridge: edge, input,
    maxCalls: MAX_CALLS, runMs: RUN_MS, cpuMs: CPU_MS, maxBack: MAX_BACK, maxCode: MAX_CODE,
    unknownMessage: (u) => `no tool ${u.join(", ")} for this token: search_tools lists them`,
  });
}
