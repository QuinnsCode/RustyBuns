// Code mode: `eq_execute` runs a JavaScript program an agent writes, where each read tool is `await tools.eq_apps({...})`, and only what the
// program returns comes back. A loop, a filter, a join of two lists is one call and one small answer instead of a call per step.
// The program is a dynamic Worker (env.LOADER) with no network and one binding, EQ: a bridge that runs each tool as the person who called
// execute, so the program has their reach and never holds a token. Same design as codeSplitter's (apps/codesplitter/src/codemode.ts).
// Imports types only; tools.ts hands it the way to run a tool.
import { arr, bool, int, obj, opt, raw, str } from "@rustybuns/util/guard";
import { readJson } from "@rustybuns/util/http";

/** The Worker Loader binding, as much of it as we use (the edge's and shell-bun's both fit). */
export interface WorkerLoaderLike {
  get(id: string, code: () => { compatibilityDate?: string; mainModule: string; modules: Record<string, string>; env?: Record<string, unknown>; globalOutbound?: unknown }):
    { getEntrypoint(): { fetch(input: string, init?: RequestInit): Promise<Response> } };
}

export const MAX_CALLS = 50, RUN_MS = 10_000, MAX_BACK = 20_000, MAX_CODE = 32_000;
const RunReply = obj({ ok: bool(), result: raw, error: opt(str(Infinity, { min: 0 })), log: opt(arr(str(Infinity, { min: 0 }), 1000, { drop: true })), calls: opt(int(0, 1e9)) });

/** One tool's answer to a program: an HTTP-style status and the JSON text. */
export interface ToolAnswer { status: number; text: string }
export interface Ran { text: string; isError: boolean; calls: number }

/** Makes a stub of the worker's EQBridge entrypoint for one caller; worker.tsx sets it on the edge (under Bun there is none). */
export const edge: { stub?: (props: unknown) => unknown } = {};

/** Tool names a program calls that no tool answers to, found by reading it, before anything runs. */
export const unknownTools = (code: string, names: string[]) =>
  [...new Set([...code.matchAll(/\btools\.([A-Za-z_]\w*)/g)].map((m) => m[1]!))].filter((n) => !names.includes(n));

const wrap = (code: string, input: unknown) => `
const INPUT = ${JSON.stringify(input ?? null)};
let calls = 0;
const call = async (env, name, args) => {
  if (++calls > ${MAX_CALLS}) throw new Error("429: a program makes at most ${MAX_CALLS} tool calls");
  const r = await env.EQ.call(name, JSON.stringify(args === undefined ? {} : args));
  if (r.status >= 300) throw new Error(r.status + ": " + r.text);
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

/** Run `code` in a Worker of its own; `names` are the tools it may call, `run` makes one call as the caller, `bridge` is the edge's stub of it (else an in-process object). */
export async function execute(loader: WorkerLoaderLike, code: string, names: string[], run: (name: string, json: string) => Promise<ToolAnswer>, input?: unknown, bridge?: unknown): Promise<Ran> {
  if (code.length > MAX_CODE) return { text: JSON.stringify({ error: `the program is up to ${MAX_CODE.toLocaleString("en")} characters` }), isError: true, calls: 0 };
  const unknown = unknownTools(code, names);
  if (unknown.length) return { text: JSON.stringify({ error: `no tool ${unknown.join(", ")}; the tools are ${names.join(", ")}` }), isError: true, calls: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined, log: string[] = [], out: string, isError = false, calls = 0;
  try {
    // A Worker for each run: one cached by id would keep the first caller's bridge, and so their reach.
    const stub = loader.get(`prog:${crypto.randomUUID()}`, () => ({
      compatibilityDate: "2026-06-01", mainModule: "program.js", modules: { "program.js": wrap(code, input) }, env: { EQ: bridge ?? { call: run }, }, globalOutbound: null,
    })).getEntrypoint();
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), RUN_MS); });
    const res = await Promise.race([stub.fetch("http://program/run", { method: "POST" }), timeout]);
    const r = await readJson(res, RunReply);
    if (!r) throw new Error(`the program answered ${res.status} without a result`);
    calls = r.calls ?? 0; log = r.log ?? []; isError = !r.ok;
    out = JSON.stringify(r.ok ? { result: r.result, ...log.length && { log } } : { error: r.error, ...log.length && { log } });
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    isError = true;
    out = JSON.stringify({ error: m === "timeout" ? `the program took more than ${RUN_MS / 1000} s` : m });
  } finally { clearTimeout(timer); }
  if (out.length > MAX_BACK) out = out.slice(0, MAX_BACK) + `… (cut at ${MAX_BACK.toLocaleString("en")} characters: return less)`;
  return { text: out, isError, calls };
}
