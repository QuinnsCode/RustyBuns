// @rustybuns/shell-bun
// Defaults are functions you call; ejecting is passing your own object with
// the same method names. No container, no decorators, no magic.

export { serve, type ServeOptions, type BunShell } from "./serve.ts";
export { openBrowser, findChromium, mintToken, type LaunchOptions } from "./launcher.ts";
export { d1, D1Database, applyD1Migrations } from "./bindings/d1.ts";
export { kv, KVNamespace } from "./bindings/kv.ts";
export { storage, type StorageOptions } from "./bindings/storage.ts";
export { r2, R2Bucket } from "./bindings/r2.ts";
export { durableObject, LocalDurableObjectNamespace, LocalDurableObjectState, WebSocketPair, installCloudflareGlobals, type DurableObjectCtor } from "./bindings/durable-object.ts";

import type { MemoryPort, Reporter } from "@rustybuns/ports";
import { d1 } from "./bindings/d1.ts";
import { kv } from "./bindings/kv.ts";
import { storage, type StorageOptions } from "./bindings/storage.ts";
import { r2 } from "./bindings/r2.ts";
import { durableObject, type DurableObjectCtor } from "./bindings/durable-object.ts";

export const caps: MemoryPort["caps"] = { sab: true, ffi: true, fs: true, gpu: false };

export const memory: MemoryPort = {
  caps,
  worker: (modulePath) => new Worker(modulePath),
};

export const stdoutReporter: Reporter = {
  breadcrumb: (name, data) => console.log(`[crumb] ${name}`, data ?? ""),
  report: (err, ctx) => console.error("[report]", err, ctx ?? ""),
  escaped: (where, err, ctx) => console.error(`[escaped:${where}]`, err, ctx ?? ""),
};

/** Local binding bundle: everything a desktop build hands to the Worker's env. */
export function localBindings(dataDir: string) {
  return {
    d1: (name: string) => d1(`${dataDir}/${name}.sqlite`),
    kv: (name: string) => kv(`${dataDir}/kv.sqlite`, name),
    storage: (name: string, opts?: StorageOptions) => storage(`${dataDir}/do_${name}.sqlite`, opts),
    /** R2 over a directory. Pass an embedded/synced dir to read shipped assets; defaults to the data dir. */
    r2: (bucket: string, dir?: string) => r2(dir ?? `${dataDir}/r2/${bucket}`),
    durableObject: <Env>(Ctor: DurableObjectCtor<Env>, env: Env, binding: string, opts?: { codec?: "json" | "v8" }) =>
      durableObject(Ctor, env, { storage: (id) => storage(`${dataDir}/do_${binding}_${id}.sqlite`, { codec: opts?.codec }) }),
  };
}
