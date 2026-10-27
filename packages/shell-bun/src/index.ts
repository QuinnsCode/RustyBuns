// @rustybuns/shell-bun
// Defaults are functions you call; ejecting is passing your own object with
// the same method names. No container, no decorators, no magic.

export { serve, type ServeOptions, type BunShell } from "./serve.ts";
export { openBrowser, writeDesktopFile, findChromium, mintToken, type LaunchOptions } from "./launcher.ts";
export { d1, D1Database, applyD1Migrations } from "./bindings/d1.ts";
export { kv, KVNamespace } from "./bindings/kv.ts";
export { storage, type StorageOptions } from "./bindings/storage.ts";
export { sqlStorage } from "./bindings/sql.ts";
export { r2, R2Bucket } from "./bindings/r2.ts";
export { hyperdrive, type LocalHyperdrive } from "./bindings/hyperdrive.ts";
export { LocalArtifacts, LocalArtifactsRepo, gitHttp } from "./bindings/artifacts.ts";
export { images, LocalImages } from "./bindings/images.ts";
export { queue, LocalQueue, type QueueBatch, type QueueMessage, type QueueConsumerSettings, type QueueSendOptions } from "./bindings/queue.ts";
export { launchCheck, appLaunchCheck } from "./advisories.ts";
export { memWatch, slope, formatMemStats, type MemStats, type MemWatchOptions } from "./memwatch.ts";
export { cpuProfile, profRoute, profiling, PROF_MAX_MS, type CpuProfileOptions } from "./cpuprof.ts";
export { summarizeProfile, formatProfileSummary, listSaved, type CpuProfile, type ProfileSummary, type HotFrame, type SavedFile } from "./profsummary.ts";
export { history, readHistory, historyRuns, formatHistory, type History, type HistoryEntry, type Run } from "./history.ts";
export { webMcpRoute, webMcpScript, WEBMCP_PATH, WEBMCP_TAG } from "./webmcp.ts";
export { appServer, proxyMatcher, type AppServer, type AppServerOptions } from "./app-server.ts";
export { schedule, parseCron, cronMatches, type ScheduledController } from "./cron.ts";
export { scheduler, hostScheduler, adapt, machineLoad, lowPriorityCommand, memoryCapCommand, processTreeMb, treeMb, JobStopped, PERSONAS, type JobContext, type EffectJobContext, type RunOptions, type SpawnOptions, type WorkerOptions, type Priority, type Persona, type Budget, type Load, type SchedulerOptions, type SchedulerStats, type Scheduler } from "./priority.ts";
export { capped, edgeLimits, edgeLike, watchEnvAtImport, EDGE_MEMORY_MB, EDGE_DO_IDLE_MS, type EdgeLimits } from "./edge-limits.ts";
export { within, count, metered, usageSnapshot, resetUsage, type UsageSnapshot, type CauseUsage } from "./usage.ts";
export { workflow, LocalWorkflow, LocalWorkflowInstance, durationMs, type WorkflowCtor, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig, type InstanceStatus } from "./bindings/workflow.ts";
export { vectorize, LocalVectorize, type VectorizeMetric, type VectorizeVector, type VectorizeMatch, type VectorizeQueryOptions } from "./bindings/vectorize.ts";
export { ai, LocalAi } from "./bindings/ai.ts";
export { analyticsEngine, LocalAnalyticsEngine, type AnalyticsEngineDataPoint } from "./bindings/analytics.ts";
export { sendEmail, LocalSendEmail, type EmailBuilder } from "./bindings/email.ts";
export { workerLoader, LocalWorkerLoader, LocalWorkerStub, type WorkerCode } from "./bindings/worker-loader.ts";
export { durableObject, LocalDurableObjectNamespace, LocalDurableObjectState, WebSocketPair, installCloudflareGlobals, type DurableObjectCtor } from "./bindings/durable-object.ts";

import type { MemoryPort, Reporter } from "@rustybuns/ports";
import type { BunShell } from "./serve.ts";
import { existsSync, renameSync } from "node:fs";
import { d1 } from "./bindings/d1.ts";
import { kv } from "./bindings/kv.ts";
import { storage, type StorageOptions } from "./bindings/storage.ts";
import { r2 } from "./bindings/r2.ts";
import { hyperdrive } from "./bindings/hyperdrive.ts";
import { LocalArtifacts } from "./bindings/artifacts.ts";
import { images } from "./bindings/images.ts";
import { queue } from "./bindings/queue.ts";
import { durableObject, type DurableObjectCtor } from "./bindings/durable-object.ts";
import { workflow } from "./bindings/workflow.ts";
import { vectorize, type VectorizeMetric } from "./bindings/vectorize.ts";
import { ai } from "./bindings/ai.ts";
import { analyticsEngine } from "./bindings/analytics.ts";
import { workerLoader } from "./bindings/worker-loader.ts";
import { sendEmail } from "./bindings/email.ts";
import { edgeLike } from "./edge-limits.ts";

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
    /** With `renamedFrom`, its file (and WAL) move over when there's none under `name` yet. */
    d1: (name: string, renamedFrom?: string) => {
      const file = `${dataDir}/${name}.sqlite`, was = `${dataDir}/${renamedFrom}.sqlite`;
      if (renamedFrom && !existsSync(file) && existsSync(was))
        for (const ext of ["-wal", "-shm", ""]) if (existsSync(was + ext)) renameSync(was + ext, file + ext);
      return d1(file);
    },
    kv: (name: string) => kv(`${dataDir}/kv.sqlite`, name),
    storage: (name: string, opts?: StorageOptions) => storage(`${dataDir}/do_${name}.sqlite`, opts),
    /** R2 over a directory. With `dir` (an embedded/synced set, possibly read-only) reads come
     *  from it and writes land in the data dir overlay; without it, everything lives in the data dir. */
    r2: (bucket: string, dir?: string) => r2(dir ?? `${dataDir}/r2/${bucket}`, `${dataDir}/r2/${bucket}`),
    /** Hyperdrive as the origin's own URL: no pool off the edge. Undefined when the URL is unset. */
    hyperdrive,
    /** Artifacts over bare git repos. Serve them with `gitHttp` under /__rb/git/ and set `remoteBase`. */
    artifacts: (namespace: string) => new LocalArtifacts(`${dataDir}/artifacts/${namespace}`, namespace),
    /** Cloudflare Images as a passthrough: info() reads the header, output() returns the original. */
    images,
    /** A Cloudflare Queue over sqlite. Its consumer is whoever calls `consume()`, in this process. */
    /** With `renamedFrom`, messages still waiting under that name are carried over to `name`. */
    queue: (name: string, renamedFrom?: string) => queue(`${dataDir}/queues.sqlite`, name, renamedFrom),
    /** A Workflow over sqlite. The app's class arrives with the Worker: `.bind(Class, env)` starts
     *  the instances created before then, and those left running when the process stopped. */
    workflow: (name: string) => workflow(`${dataDir}/workflows.sqlite`, name),
    /** A Vectorize index over sqlite, queried by exact scan. */
    vectorize: (indexName: string, opts?: { dimensions?: number; metric?: VectorizeMetric }) => vectorize(`${dataDir}/vectorize.sqlite`, indexName, opts),
    /** Workers AI: bge text embeddings run locally (word and trigram hashing, not meaning); every other call says it runs only on Cloudflare. */
    ai,
    /** Analytics Engine: data points land in analytics.sqlite. */
    analyticsEngine: (dataset: string) => analyticsEngine(`${dataDir}/analytics.sqlite`, dataset),
    /** Email Sending: nothing leaves the machine; each message is an .eml file under email/<binding>. */
    sendEmail: (name: string, allowedSenderAddresses?: string[]) => sendEmail(`${dataDir}/email/${name}`, name, allowedSenderAddresses),
    /** The Dynamic Worker Loader, in this process (not a sandbox). */
    workerLoader: (name: string) => workerLoader(`${dataDir}/loader/${name}`),
    durableObject: <Env>(Ctor: DurableObjectCtor<Env>, env: Env, binding: string, opts?: { codec?: "json" | "v8" }) =>
      durableObject(Ctor, env, { name: binding, idleMs: edgeLike()?.idleMs, storage: (id) => storage(`${dataDir}/do_${binding}_${id}.sqlite`, { codec: opts?.codec }) }),
  };
}
