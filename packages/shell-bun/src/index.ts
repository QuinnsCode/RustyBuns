// @rustybuns/shell-bun
// Defaults are functions you call; ejecting is passing your own object with
// the same method names. No container, no decorators, no magic.

export { serve, type ServeOptions, type BunShell } from "./serve.ts";
export { openBrowser, findChromium, mintToken, type LaunchOptions } from "./launcher.ts";
export { d1, D1Database, applyD1Migrations } from "./bindings/d1.ts";
export { kv, KVNamespace } from "./bindings/kv.ts";
export { storage, type StorageOptions } from "./bindings/storage.ts";
export { r2, R2Bucket } from "./bindings/r2.ts";
export { LocalArtifacts, LocalArtifactsRepo, gitHttp } from "./bindings/artifacts.ts";
export { schedule, parseCron, cronMatches, type ScheduledController } from "./cron.ts";
export { durableObject, LocalDurableObjectNamespace, LocalDurableObjectState, WebSocketPair, installCloudflareGlobals, type DurableObjectCtor } from "./bindings/durable-object.ts";

import type { MemoryPort, Reporter } from "@rustybuns/ports";
import type { BunShell } from "./serve.ts";
import { d1 } from "./bindings/d1.ts";
import { kv } from "./bindings/kv.ts";
import { storage, type StorageOptions } from "./bindings/storage.ts";
import { r2 } from "./bindings/r2.ts";
import { LocalArtifacts } from "./bindings/artifacts.ts";
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

/** What a desktop host module's fetch(req, ctx) receives. */
export interface HostContext {
  env: Record<string, unknown>;
  dataDir: string;
  /** The host's own identity. A guest's travels on its upgrade request instead. */
  identity: Record<string, string>;
  reporter: Reporter;
  /** The shell itself: `shell.comms.sockets()` for who is connected, `shell.rebind()` to move. */
  shell: BunShell<Record<string, unknown>>;
  /** Multiplayer state the generated host keeps: see POST /__rb/host. */
  guests: GuestState;
}

export interface GuestState {
  /** Current join passphrase; undefined = closed. */
  join?: string;
  max: number;
  /** Required `?v=` for guests; undefined = not checked. */
  version?: string;
  /** Live guest sockets (the host's own is not counted). */
  connected(): number;
}

/** Local binding bundle: everything a desktop build hands to the Worker's env. */
export function localBindings(dataDir: string) {
  return {
    d1: (name: string) => d1(`${dataDir}/${name}.sqlite`),
    kv: (name: string) => kv(`${dataDir}/kv.sqlite`, name),
    storage: (name: string, opts?: StorageOptions) => storage(`${dataDir}/do_${name}.sqlite`, opts),
    /** R2 over a directory. With `dir` (an embedded/synced set, possibly read-only) reads come
     *  from it and writes land in the data dir overlay; without it, everything lives in the data dir. */
    r2: (bucket: string, dir?: string) => r2(dir ?? `${dataDir}/r2/${bucket}`, `${dataDir}/r2/${bucket}`),
    /** Artifacts over bare git repos. Serve them with `gitHttp` under /__rb/git/ and set `remoteBase`. */
    artifacts: (namespace: string) => new LocalArtifacts(`${dataDir}/artifacts/${namespace}`, namespace),
    durableObject: <Env>(Ctor: DurableObjectCtor<Env>, env: Env, binding: string, opts?: { codec?: "json" | "v8" }) =>
      durableObject(Ctor, env, { storage: (id) => storage(`${dataDir}/do_${binding}_${id}.sqlite`, { codec: opts?.codec }) }),
  };
}
