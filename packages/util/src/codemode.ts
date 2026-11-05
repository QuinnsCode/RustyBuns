// The runner behind code mode, shared by every app that lets an agent write a program over its tools (codeSplitter's `execute`,
// eqosys's `eq_execute`). The program is a dynamic Worker (env.LOADER) with no network and one binding that makes each tool call
// as the caller, so the program has the caller's reach and never holds a token. Each app keeps its own tool list and its bridge
// (who the call is made as); this file is the wrap, the checks before a run, the limits and the answer's shape.
import { arr, bool, check, int, obj, opt, raw, str } from "./guard.ts";
import { parseJson } from "./http.ts";

/** The Worker Loader binding, as much of it as we use (the edge's and shell-bun's both fit). */
export interface WorkerLoaderLike {
  get(id: string, code: () => { compatibilityDate?: string; mainModule: string; modules: Record<string, string>; env?: Record<string, unknown>; globalOutbound?: unknown; limits?: { cpuMs?: number; subRequests?: number } }):
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
// The count lives in a closure, not a name the program's code could assign (calls = 0 from inside it).
const [call, made] = ((n) => [async (env, name, args) => {
  if (++n > ${maxCalls}) { const e = new Error("429: a program makes at most ${maxCalls} tool calls"); e.status = 429; throw e; }
  const r = await env.${binding}.call(name, JSON.stringify(args === undefined ? {} : args));
  if (r.status >= 300) { const e = new Error(r.status + ": " + r.text); e.status = r.status; throw e; }
  try { return JSON.parse(r.text); } catch { return r.text; }
}, () => n])(0);
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
      return Response.json({ ok: true, result: result === undefined ? null : result, log, calls: made() });
    } catch (e) {
      return Response.json({ ok: false, error: String(e && e.message || e), log, calls: made() });
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
  /** Wall time the host waits for an answer. */
  runMs: number;
  /** CPU time the program's Worker may spend; the edge ends it past this, where the race above only stops the host waiting. */
  cpuMs: number;
  maxBack: number;
  maxCode: number;
  /** What to say when the program names tools that don't exist. */
  unknownMessage: (unknown: string[]) => string;
}

/** A reply's text, refused past `max` characters as it streams in, so a program returning a huge string is never held whole. */
async function textUpTo(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader(), dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + dec.decode();
    text += dec.decode(value, { stream: true });
    if (text.length > max) { await reader.cancel().catch(() => {}); throw new Error(`the program answered more than ${max.toLocaleString("en")} characters: return less`); }
  }
}

const fail = (error: string): Ran => ({ text: JSON.stringify({ error }), isError: true, calls: 0 });

/** Run `code` in a Worker of its own, after checking its size and the tools it names. */
export async function runProgram(loader: WorkerLoaderLike, code: string, o: RunOptions): Promise<Ran> {
  if (code.length > o.maxCode) return fail(`the program is up to ${o.maxCode.toLocaleString("en")} characters`);
  const unknown = unknownTools(code, o.names);
  if (unknown.length) return fail(o.unknownMessage(unknown));
  let timer: ReturnType<typeof setTimeout> | undefined, log: string[] = [], out: string, isError = false, calls = 0;
  // Counted here, on the host, when the host makes the calls (under Bun): the program's own count is only what it says.
  // On the edge the calls go to the bridge stub, and the Worker's subRequests limit is the host-side cap.
  let made = 0;
  const run = (name: string, json: string): Promise<ToolAnswer> => ++made > o.maxCalls
    ? Promise.resolve({ status: 429, text: JSON.stringify({ error: `a program makes at most ${o.maxCalls} tool calls` }) })
    : o.run(name, json);
  try {
    // A Worker for each run: one cached by id would keep the first caller's binding, and so their reach.
    const stub = loader.get(`prog:${crypto.randomUUID()}`, () => ({
      compatibilityDate: "2026-06-01", mainModule: "program.js", modules: { "program.js": wrap(code, o.input, o.binding, o.maxCalls) },
      env: { [o.binding]: o.bridge ?? { call: run } }, globalOutbound: null,
      // The program's only outbound is its binding, so each tool call is a subrequest: the edge holds the call cap too.
      limits: { cpuMs: o.cpuMs, subRequests: o.maxCalls },
    })).getEntrypoint();
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), o.runMs); });
    const res = await Promise.race([stub.fetch("http://program/run", { method: "POST" }), timeout]);
    // Read up to a bound before parsing: the cut below is for what reaches the agent, this one is for the host's memory.
    const r = check(RunReply, parseJson(await textUpTo(res, o.maxBack * 50)));
    if (!r) throw new Error(`the program answered ${res.status} without a result`);
    calls = o.bridge ? r.calls ?? 0 : Math.min(made, o.maxCalls);
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
