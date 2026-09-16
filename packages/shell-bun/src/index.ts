// @rustybuns/shell-bun
// Defaults are functions you call; ejecting is passing your own object with
// the same method names. No container, no decorators, no magic.

export { serve, type ServeOptions, type BunShell } from "./serve.ts";
export { openBrowser, findChromium, mintToken, type LaunchOptions } from "./launcher.ts";
export { d1, D1Database } from "./bindings/d1.ts";
export { kv, KVNamespace } from "./bindings/kv.ts";
export { storage } from "./bindings/storage.ts";

import type { MemoryPort, Reporter } from "@rustybuns/ports";
import { d1 } from "./bindings/d1.ts";
import { kv } from "./bindings/kv.ts";
import { storage } from "./bindings/storage.ts";

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
    storage: (name: string, onAlarm?: () => void) => storage(`${dataDir}/do_${name}.sqlite`, onAlarm),
  };
}
