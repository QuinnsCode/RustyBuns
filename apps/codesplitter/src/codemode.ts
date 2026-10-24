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

import type { WorkerLoaderLike } from "./env.ts";
import type { Tool } from "./mcp-tools.ts";

export const MAX_CALLS = 100;
export const RUN_MS = 20_000;
export const MAX_BACK = 20_000;
const MAX_CODE = 64_000;

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
      + "The program is the body of an async function. Each tool is `await tools.<name>({...})`, with the arguments describe_tools gives; its JSON answer comes back parsed, and an error throws with its status first (`409: …`, so catch a 409, read again and retry). console.log lines come back too. "
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

/** Tool names a program calls that no tool answers to, found by reading it, before anything runs. */
export function unknownTools(code: string, tools: Tool[]): string[] {
  const names = new Set(tools.map((t) => t.name));
  return [...new Set([...code.matchAll(/\btools\.([A-Za-z_]\w*)/g)].map((m) => m[1]!))].filter((n) => !names.has(n));
}

/** The dynamic Worker's module: the agent's code inside a fetch handler, with `tools` over env.CS. */
const wrap = (code: string, input: unknown) => `
const INPUT = ${JSON.stringify(input ?? null)};
const call = async (env, name, args) => {
  const r = await env.CS.call(name, JSON.stringify(args === undefined ? {} : args));
  if (r.status >= 300) { const e = new Error(r.status + ": " + r.text); e.status = r.status; throw e; }
  try { return JSON.parse(r.text); } catch { return r.text; }
};
const program = async ({ tools, console, input }) => {
${code}
};
export default {
  async fetch(req, env) {
    const log = [];
    const say = (...a) => { log.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); };
    const tools = new Proxy({}, { get: (_, name) => (args) => call(env, String(name), args) });
    try {
      const result = await program({ tools, input: INPUT, console: { log: say, info: say, warn: say, error: say } });
      return Response.json({ ok: true, result: result === undefined ? null : result, log });
    } catch (e) {
      return Response.json({ ok: false, error: String(e && e.message || e), log });
    }
  },
};
`;

/** One tool's answer: its HTTP status and body. */
export interface ToolAnswer { status: number; text: string }

/**
 * The CS binding: each call is one tool's HTTP call, made as the caller. Only plain values cross, so it
 * works as an RPC stub on the edge and as an object in the local twin.
 */
function fetcher(tools: Tool[], run: (t: Tool, args: Record<string, unknown>) => Promise<ToolAnswer>, Base: new () => object = Object) {
  let calls = 0;
  const fail = (status: number, error: string): ToolAnswer => ({ status, text: JSON.stringify({ error }) });
  // On the edge the binding must be an RpcTarget; under Bun (no cloudflare:workers) a plain base does.
  return new (class extends Base {
    calls = () => calls;
    async call(name: string, json: string): Promise<ToolAnswer> {
      if (++calls > MAX_CALLS) return fail(429, `a program makes at most ${MAX_CALLS} tool calls`);
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
  })() as { calls(): number; call(name: string, json: string): Promise<ToolAnswer> };
}

/** RpcTarget where the runtime has it (the edge); undefined under Bun, where an object is enough. */
const rpcBase = import("cloudflare:workers").then((m) => (m as unknown as { RpcTarget: new () => object }).RpcTarget, () => undefined);

/** What a program came to, shaped as the text `execute` answers with. */
export interface Ran { text: string; isError: boolean; calls: number }

/** Run `code` over `tools` as the caller (`run` makes each call), in a Worker of its own. */
export async function execute(loader: WorkerLoaderLike, code: string, tools: Tool[], run: (t: Tool, args: Record<string, unknown>) => Promise<ToolAnswer>, input?: unknown): Promise<Ran> {
  if (code.length > MAX_CODE) return { text: `the program is up to ${MAX_CODE.toLocaleString("en")} characters`, isError: true, calls: 0 };
  const unknown = unknownTools(code, tools);
  if (unknown.length) return { text: JSON.stringify({ error: `no tool ${unknown.join(", ")} for this token: search_tools lists them` }), isError: true, calls: 0 };
  const cs = fetcher(tools, run, await rpcBase);
  let timer: ReturnType<typeof setTimeout> | undefined, log: string[] = [], out: string, isError = false;
  try {
    // A Worker for each run: one cached by id would keep the first caller's CS, and so their token.
    const stub = loader.get(`prog:${crypto.randomUUID()}`, () => ({
      compatibilityDate: "2026-06-01", mainModule: "program.js", modules: { "program.js": wrap(code, input) }, env: { CS: cs }, globalOutbound: null,
    })).getEntrypoint();
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), RUN_MS); });
    const res = await Promise.race([stub.fetch("http://program/run", { method: "POST" }), timeout]);
    const r = (await res.json()) as { ok: boolean; result?: unknown; error?: string; log?: string[] };
    log = Array.isArray(r.log) ? r.log : [];
    isError = !r.ok;
    out = JSON.stringify(r.ok ? { result: r.result, ...log.length && { log } } : { error: r.error, ...log.length && { log } });
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    isError = true;
    out = JSON.stringify({ error: m === "timeout" ? `the program took more than ${RUN_MS / 1000} s` : m });
  } finally { clearTimeout(timer); }
  if (out.length > MAX_BACK) out = out.slice(0, MAX_BACK) + `… (cut at ${MAX_BACK.toLocaleString("en")} characters: return less)`;
  return { text: out, isError, calls: cs.calls() };
}
