// The runner behind code mode, shared by every app that lets an agent write a program over its tools (codeSplitter's `execute`,
// eqosys's `eq_execute`). The program is a dynamic Worker (env.LOADER) with no network and one binding that makes each tool call
// as the caller, so the program has the caller's reach and never holds a token. Each app keeps its own tool list and its bridge
// (who the call is made as); this file is the wrap, the checks before a run, the limits and the answer's shape.
import { arr, bool, int, obj, opt, raw, str } from "./guard.ts";
import { readJson } from "./http.ts";

/** The Worker Loader binding, as much of it as we use (the edge's and shell-bun's both fit). */
export interface WorkerLoaderLike {
  get(id: string, code: () => { compatibilityDate?: string; mainModule: string; modules: Record<string, string>; env?: Record<string, unknown>; globalOutbound?: unknown }):
    { getEntrypoint(): { fetch(input: string, init?: RequestInit): Promise<Response> } };
}

/** One tool's answer to a program: an HTTP-style status and the JSON text. */
export interface ToolAnswer { status: number; text: string }
/** What a program came to, shaped as the text `execute` answers with. */
export interface Ran { text: string; isError: boolean; calls: number }

/** What a program Worker answers from POST /run. */
const RunReply = obj({ ok: bool(), result: raw, error: opt(str(Infinity, { min: 0 })), log: opt(arr(str(Infinity, { min: 0 }), 10_000, { drop: true })), calls: opt(int(0, 1e9)) });

/** Tool names a program calls that no tool answers to, found by reading it, before anything runs. */
export const unknownTools = (code: string, names: Iterable<string>): string[] => {
  const known = new Set(names);
  return [...new Set([...code.matchAll(/\btools\.([A-Za-z_]\w*)/g)].map((m) => m[1]!))].filter((n) => !known.has(n));
};

/** The dynamic Worker's module: the agent's code inside a fetch handler, with `tools` over env.<binding>. */
export const wrap = (code: string, input: unknown, binding: string, maxCalls: number) => `
const INPUT = ${JSON.stringify(input ?? null)};
let calls = 0;
const call = async (env, name, args) => {
  if (++calls > ${maxCalls}) { const e = new Error("429: a program makes at most ${maxCalls} tool calls"); e.status = 429; throw e; }
  const r = await env.${binding}.call(name, JSON.stringify(args === undefined ? {} : args));
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
      return Response.json({ ok: true, result: result === undefined ? null : result, log, calls });
    } catch (e) {
      return Response.json({ ok: false, error: String(e && e.message || e), log, calls });
    }
  },
};
`;

/** One app's code mode: how it is limited, what its binding is called, and what it says when a program is turned away. */
export interface RunOptions {
  /** The program Worker's binding name (`CS`, `EQ`): `env.<binding>.call(name, json)` answers a ToolAnswer. */
  binding: string;
  /** The tool names a program may call. */
  names: string[];
  /** Makes one call as the caller; used in-process where there is no edge stub (under Bun). */
  run: (name: string, json: string) => Promise<ToolAnswer>;
  /** The edge's stub of the app's bridge entrypoint for this caller; it replaces `run` as the binding. */
  bridge?: unknown;
  input?: unknown;
  maxCalls: number;
  runMs: number;
  maxBack: number;
  maxCode: number;
  /** What to say when the program names tools that don't exist. */
  unknownMessage: (unknown: string[]) => string;
}

const fail = (error: string): Ran => ({ text: JSON.stringify({ error }), isError: true, calls: 0 });

/** Run `code` in a Worker of its own, after checking its size and the tools it names. */
export async function runProgram(loader: WorkerLoaderLike, code: string, o: RunOptions): Promise<Ran> {
  if (code.length > o.maxCode) return fail(`the program is up to ${o.maxCode.toLocaleString("en")} characters`);
  const unknown = unknownTools(code, o.names);
  if (unknown.length) return fail(o.unknownMessage(unknown));
  let timer: ReturnType<typeof setTimeout> | undefined, log: string[] = [], out: string, isError = false, calls = 0;
  try {
    // A Worker for each run: one cached by id would keep the first caller's binding, and so their reach.
    const stub = loader.get(`prog:${crypto.randomUUID()}`, () => ({
      compatibilityDate: "2026-06-01", mainModule: "program.js", modules: { "program.js": wrap(code, o.input, o.binding, o.maxCalls) },
      env: { [o.binding]: o.bridge ?? { call: o.run } }, globalOutbound: null,
    })).getEntrypoint();
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), o.runMs); });
    const res = await Promise.race([stub.fetch("http://program/run", { method: "POST" }), timeout]);
    const r = await readJson(res, RunReply);
    if (!r) throw new Error(`the program answered ${res.status} without a result`);
    calls = r.calls ?? 0;
    log = r.log ?? [];
    isError = !r.ok;
    out = JSON.stringify(r.ok ? { result: r.result, ...log.length && { log } } : { error: r.error, ...log.length && { log } });
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    isError = true;
    out = JSON.stringify({ error: m === "timeout" ? `the program took more than ${o.runMs / 1000} s` : m });
  } finally { clearTimeout(timer); }
  if (out.length > o.maxBack) out = out.slice(0, o.maxBack) + `… (cut at ${o.maxBack.toLocaleString("en")} characters: return less)`;
  return { text: out, isError, calls };
}
