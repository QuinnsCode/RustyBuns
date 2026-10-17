// The Dynamic Worker Loader off the edge: `env.LOADER.get(id, getCode)` (and `load(code)`) writes
// the code's modules to a folder under the data dir and imports its main module in this process.
// `getEntrypoint()` gives back a stub with fetch() and the entrypoint's other methods (RPC), and a
// stub for one id is kept, so getCode runs once per id per process, as on the edge.
//
// With `globalOutbound: null` each call runs in its own Bun Worker (a thread of its own): fetch,
// WebSocket and EventSource throw, a kill timer ends a run that never returns (a synchronous loop
// included; `killMs`, 10 s), and the bindings in `env` reach the code as RPC (an object's methods
// become async calls back to the host; plain values are copied). Bun has no permission model, so
// this is a seatbelt against a script that loops or phones home, not a wall against one that tries
// to escape. Without `globalOutbound: null` the code runs in this process with the app's own reach,
// so load only code the app trusts. `import ... from "cloudflare:workers"` gets the host's shim
// in-process only; an isolated Worker can't import it.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as shims from "../shims.ts";

type Module = string | { js: string } | { cjs: string } | { text: string } | { data: ArrayBuffer | ArrayBufferView } | { json: unknown } | { py: string };
export interface WorkerCode {
  compatibilityDate?: string; compatibilityFlags?: string[];
  mainModule: string;
  modules: Record<string, Module>;
  env?: Record<string, unknown>;
  /** null cuts the Worker off the network and runs it in a thread of its own; anything else runs in-process. */
  globalOutbound?: unknown;
}

/** Runs inside the Worker thread; everything crosses by postMessage, and the host answers `rpc` messages. */
const ISOLATE = `
for (const k of ["fetch", "WebSocket", "EventSource"]) {
  globalThis[k] = function () { throw new Error("network access is blocked: this Worker has no outbound (globalOutbound: null)"); };
}
let n = 0; const waiting = new Map();
const rpc = (key, method, args) => new Promise((res, rej) => { const id = ++n; waiting.set(id, { res, rej }); postMessage({ type: "rpc", id, key, method, args }); });
onmessage = async ({ data: m }) => {
  if (m.type === "reply") { const w = waiting.get(m.id); waiting.delete(m.id); if (m.error) w.rej(new Error(m.error)); else w.res(m.value); return; }
  try {
    const bound = {};
    for (const [k, v] of Object.entries(m.bound)) {
      if (v && v.__rpc) { bound[k] = {}; for (const f of v.__rpc) bound[k][f] = (...a) => rpc(k, f, a); } else bound[k] = v;
    }
    const mod = await import(m.file);
    const ep = mod[m.name ?? "default"];
    if (!ep) throw new Error("the Worker has no " + (m.name ? 'export "' + m.name + '"' : "default export"));
    const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
    const inst = typeof ep === "function" ? new ep(ctx, bound) : ep;
    if (typeof inst[m.method] !== "function") throw new Error("the entrypoint has no " + m.method + "()");
    let args = m.args;
    if (m.method === "fetch") args = [new Request(args[0].url, { method: args[0].method, headers: args[0].headers, body: args[0].body })];
    const out = typeof ep === "function" ? await inst[m.method](...args) : m.method === "fetch" ? await inst.fetch(args[0], bound, ctx) : await inst[m.method](...args);
    if (out instanceof Response) postMessage({ type: "done", response: { status: out.status, statusText: out.statusText, headers: [...out.headers], body: await out.arrayBuffer() } });
    else postMessage({ type: "done", value: out });
  } catch (e) { postMessage({ type: "done", error: String((e && e.message) || e) }); }
};
`;

/** Plain values copy across; an object holding functions becomes the list of its method names. */
const boundSpec = (bound: Record<string, unknown>) => Object.fromEntries(Object.entries(bound).map(([k, v]) =>
  [k, v && typeof v === "object" && Object.values(v).some((f) => typeof f === "function") ? { __rpc: Object.keys(v).filter((f) => typeof (v as any)[f] === "function") } : v]));

let shimmed = false;
/** Dynamic code that imports cloudflare:workers (or :workflows, :email) gets the same shim the host was built with. */
function shimRuntimeImports() {
  if (shimmed) return;
  shimmed = true;
  Bun.plugin({ name: "rustybuns-loader-shims", setup(b) {
    b.module("cloudflare:workers", () => ({ exports: { ...shims }, loader: "object" }));
    b.module("cloudflare:email", () => ({ exports: { EmailMessage: shims.EmailMessage }, loader: "object" }));
    b.module("cloudflare:workflows", () => ({ exports: { NonRetryableError: shims.NonRetryableError }, loader: "object" }));
  } });
}

const ctx = () => ({ waitUntil(p: Promise<unknown>) { void p?.catch?.((e) => console.error("[loader waitUntil]", e)); }, passThroughOnException() {}, props: {} });

/** What get() returns: the edge's WorkerStub. */
export class LocalWorkerStub {
  private loaded: Promise<{ mod?: Record<string, any>; file: string; env: Record<string, unknown> }>;
  constructor(dir: string, code: () => WorkerCode | Promise<WorkerCode>, private killMs = 10_000) {
    this.loaded = (async () => {
      const c = await code();
      shimRuntimeImports();
      if (Object.values(c.modules).some((m) => typeof m === "object" && "py" in m)) throw new Error("Worker Loader: Python modules don't run on the desktop");
      if (!(c.mainModule in c.modules)) throw new Error(`Worker Loader: mainModule "${c.mainModule}" isn't one of the modules`);
      // Its own folder per load: a later get() with other code under the same id is a fresh import.
      const root = join(dir, crypto.randomUUID());
      for (const [name, m] of Object.entries(c.modules)) {
        const file = join(root, name);
        mkdirSync(dirname(file), { recursive: true });
        if (typeof m === "string" || "js" in m || "cjs" in m) writeFileSync(file, typeof m === "string" ? m : "js" in m ? m.js : m.cjs);
        else if ("text" in m) writeFileSync(file, m.text);
        else if ("json" in m) writeFileSync(file, JSON.stringify(m.json));
        else if ("data" in m) writeFileSync(file, new Uint8Array(ArrayBuffer.isView(m.data) ? m.data.buffer.slice(m.data.byteOffset, m.data.byteOffset + m.data.byteLength) : m.data));
      }
      const file = pathToFileURL(join(root, c.mainModule)).href;
      // Isolated code is imported in its thread, never here.
      return { mod: c.globalOutbound === null ? undefined : await import(file), file, env: c.env ?? {} };
    })();
  }

  /** One call in a fresh Worker thread, ended when it answers or runs past killMs. */
  private isolated(l: { file: string; env: Record<string, unknown> }, name: string | undefined, method: string, args: unknown[]): Promise<any> {
    return new Promise(async (resolve, reject) => {
      const url = URL.createObjectURL(new Blob([ISOLATE], { type: "text/javascript" }));
      const w = new Worker(url);
      const end = () => { clearTimeout(timer); w.terminate(); URL.revokeObjectURL(url); };
      const timer = setTimeout(() => { end(); reject(new Error("timeout")); }, this.killMs);
      w.onerror = (e) => { end(); reject(new Error(e.message || "the Worker crashed")); };
      w.onmessage = async ({ data: m }) => {
        if (m.type === "rpc") {
          try { w.postMessage({ type: "reply", id: m.id, value: await (l.env[m.key] as any)[m.method](...m.args) }); }
          catch (e) { w.postMessage({ type: "reply", id: m.id, error: String((e as Error)?.message ?? e) }); }
        } else if (m.type === "done") {
          end();
          if (m.error) reject(new Error(m.error));
          else if (m.response) resolve(new Response(m.response.body, { status: m.response.status, statusText: m.response.statusText, headers: m.response.headers }));
          else resolve(m.value);
        }
      };
      try {
        let a = args;
        if (method === "fetch") {
          const r = args[0] as Request;
          a = [{ url: r.url, method: r.method, headers: [...r.headers], body: r.method === "GET" || r.method === "HEAD" ? undefined : await r.text() }];
        }
        w.postMessage({ file: l.file, name, method, args: a, bound: boundSpec(l.env) });
      } catch (e) { end(); reject(e); }
    });
  }

  /** The default export, or a named one. A class (WorkerEntrypoint) is made per call with (ctx, env). */
  getEntrypoint(name?: string, _opts?: { props?: unknown }): Record<string, (...a: any[]) => Promise<any>> {
    const target = async () => {
      const { mod, env } = await this.loaded;
      const ep = mod![name ?? "default"];
      if (!ep) throw new Error(`Worker Loader: the Worker has no ${name ? `export "${name}"` : "default export"}`);
      return { ep, env };
    };
    const call = async (method: string, args: unknown[]) => {
      const l = await this.loaded;
      if (!l.mod) return this.isolated(l, name, method, args);
      const { ep, env } = await target();
      if (typeof ep === "function") {
        const inst = new ep(ctx(), env);
        if (typeof inst[method] !== "function") throw new Error(`Worker Loader: the entrypoint has no method ${method}()`);
        return inst[method](...args);
      }
      if (typeof ep[method] !== "function") throw new Error(`Worker Loader: the entrypoint has no ${method}()`);
      // An object export's handlers take (request, env, ctx), the way the edge calls them.
      return method === "fetch" ? ep.fetch(args[0], env, ctx()) : ep[method](...args);
    };
    return new Proxy({} as Record<string, (...a: any[]) => Promise<any>>, {
      get: (_, k) => {
        if (typeof k === "symbol" || k === "then") return undefined;
        if (k === "fetch") return (input: RequestInfo | URL, init?: RequestInit) => call("fetch", [input instanceof Request ? input : new Request(input, init)]);
        return (...args: unknown[]) => call(k, args);
      },
    });
  }
}

export class LocalWorkerLoader {
  private stubs = new Map<string, LocalWorkerStub>();
  constructor(readonly dir: string) {}

  get(id: string, getCode: () => WorkerCode | Promise<WorkerCode>): LocalWorkerStub {
    let s = this.stubs.get(id);
    if (!s) this.stubs.set(id, s = new LocalWorkerStub(join(this.dir, safe(id)), getCode));
    return s;
  }

  /** A one-off Worker, not kept. */
  load(code: WorkerCode): LocalWorkerStub {
    return new LocalWorkerStub(join(this.dir, "_once"), () => code);
  }
}

const safe = (id: string) => id.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100) || "_";

export const workerLoader = (dir: string) => new LocalWorkerLoader(dir);
