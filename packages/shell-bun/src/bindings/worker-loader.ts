// The Dynamic Worker Loader off the edge: `env.LOADER.get(id, getCode)` (and `load(code)`) writes
// the code's modules to a folder under the data dir and imports its main module in this process.
// `getEntrypoint()` gives back a stub with fetch() and the entrypoint's other methods (RPC), and a
// stub for one id is kept, so getCode runs once per id per process, as on the edge.
//
// Not a sandbox: on the edge each dynamic Worker gets its own isolate, and `globalOutbound: null`
// cuts its network. Here the code runs with the app's own reach, so load code the app trusts.
// `import ... from "cloudflare:workers"` inside it gets the host's shim.

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
  /** null on the edge cuts the Worker off the network. Not enforced here. */
  globalOutbound?: unknown;
}

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
  private loaded: Promise<{ mod: Record<string, any>; env: Record<string, unknown> }>;
  constructor(dir: string, code: () => WorkerCode | Promise<WorkerCode>) {
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
      return { mod: await import(pathToFileURL(join(root, c.mainModule)).href), env: c.env ?? {} };
    })();
  }

  /** The default export, or a named one. A class (WorkerEntrypoint) is made per call with (ctx, env). */
  getEntrypoint(name?: string, _opts?: { props?: unknown }): Record<string, (...a: any[]) => Promise<any>> {
    const target = async () => {
      const { mod, env } = await this.loaded;
      const ep = mod[name ?? "default"];
      if (!ep) throw new Error(`Worker Loader: the Worker has no ${name ? `export "${name}"` : "default export"}`);
      return { ep, env };
    };
    const call = async (method: string, args: unknown[]) => {
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
