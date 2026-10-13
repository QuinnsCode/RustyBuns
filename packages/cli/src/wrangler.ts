// wrangler.jsonc -> RustyBunsConfig. Reads what RWSDK's scaffold emits.

import type { Binding, RustyBunsConfig, Stage, StageBinding } from "./config.ts";
import { inferWorkerBuild } from "./glue/build-script.ts";

import { stripJsonc } from "./glue/jsonc.ts";
export { stripJsonc };

export interface WranglerJson {
  name?: string;
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  assets?: { directory?: string; binding?: string; run_worker_first?: boolean | string[]; not_found_handling?: "single-page-application" | "404-page" | "none" };
  d1_databases?: { binding: string; database_name: string; database_id?: string; migrations_dir?: string }[];
  kv_namespaces?: { binding: string; id?: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  durable_objects?: { bindings?: { name: string; class_name: string; script_name?: string }[] };
  migrations?: { tag: string; new_classes?: string[]; new_sqlite_classes?: string[]; renamed_classes?: { from: string; to: string }[]; deleted_classes?: string[] }[];
  vars?: Record<string, string>;
  triggers?: { crons?: string[] };
  limits?: { cpu_ms?: number };
  placement?: { mode?: string };
  images?: { binding: string };
  send_email?: { name: string; allowed_sender_addresses?: string[] }[];
  ratelimits?: { name: string; namespace_id: string; simple: { limit: number; period: 10 | 60 } }[];
  ai?: { binding: string };
  hyperdrive?: { binding: string; id?: string; localConnectionString?: string }[];
  queues?: {
    producers?: { binding: string; queue: string }[];
    consumers?: { queue: string; max_batch_size?: number; max_batch_timeout?: number; max_retries?: number; retry_delay?: number; max_concurrency?: number; dead_letter_queue?: string }[];
  };
  workflows?: { binding: string; name?: string; class_name: string; script_name?: string }[];
  analytics_engine_datasets?: { binding: string; dataset?: string }[];
  worker_loaders?: { binding: string }[];
  vectorize?: { binding: string; index_name: string }[];
  containers?: { class_name: string; image: string; max_instances?: number; instance_type?: string | object; name?: string }[];
  route?: WranglerRoute;
  routes?: WranglerRoute[];
  observability?: {
    enabled?: boolean; head_sampling_rate?: number;
    logs?: { enabled?: boolean; invocation_logs?: boolean; head_sampling_rate?: number; persist?: boolean };
    traces?: { enabled?: boolean; head_sampling_rate?: number; persist?: boolean };
  };
  account_id?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  /** Per-environment overrides: `wrangler deploy --env <name>`. */
  env?: Record<string, WranglerJson>;
  [k: string]: unknown;
}

type WranglerRoute = string | { pattern: string; zone_name?: string; zone_id?: string; custom_domain?: boolean };

export function parseWrangler(src: string): WranglerJson {
  return JSON.parse(stripJsonc(src));
}

/** wrangler.toml uses the same key names as the JSON form, so Bun's TOML parser is all it takes. */
export function parseWranglerToml(src: string): WranglerJson {
  return (Bun as any).TOML.parse(src) as WranglerJson;
}

/** Top-level keys that Rusty Buns reads. Anything else in a wrangler file is not carried into the config. */
const HANDLED = new Set([
  "$schema", "name", "main", "compatibility_date", "compatibility_flags", "assets",
  "d1_databases", "kv_namespaces", "r2_buckets", "durable_objects", "migrations", "vars", "triggers", "images", "send_email", "ratelimits", "ai", "queues", "placement", "hyperdrive",
  "workflows", "analytics_engine_datasets", "worker_loaders", "vectorize", "containers", "route", "routes", "observability", "limits",
  "account_id", "workers_dev", "preview_urls", "env",
]);

/** Keys wrangler doesn't inherit into an `env.<name>` block: the env has only the bindings it declares. */
const ENV_BINDINGS = ["d1_databases", "kv_namespaces", "r2_buckets", "durable_objects", "vars", "images", "send_email", "ratelimits", "ai",
  "queues", "hyperdrive", "workflows", "analytics_engine_datasets", "worker_loaders", "vectorize"] as const;
/** What a stage can say for an env block; any other key it sets differently from the top level is not carried over. */
const ENV_HANDLED = new Set<string>([...ENV_BINDINGS, "name", "route", "routes", "triggers", "account_id", "workers_dev", "preview_urls"]);

/** A container `image` that is a Dockerfile here, not a registry image (`docker.io/org/app:tag`). */
const localImage = (image: string) => /^\.{0,2}\//.test(image) || /(^|\/)Dockerfile[^/]*$/i.test(image);

/** Wrangler keys that `init` cannot represent yet; `env.<name>.<key>` for one inside an env block. */
export function droppedWranglerKeys(w: WranglerJson): string[] {
  const top = Object.keys(w).filter((k) => !HANDLED.has(k) || (k === "containers" && (w.containers ?? []).some((c) => !localImage(c.image))));
  const envs = Object.entries(w.env ?? {}).flatMap(([n, e]) => !STAGE_NAME.test(n) ? [`env.${n}`]
    : Object.keys(e ?? {}).filter((k) => !ENV_HANDLED.has(k) && JSON.stringify(e[k]) !== JSON.stringify(w[k])).map((k) => `env.${n}.${k}`));
  return [...top, ...envs];
}

/** Alchemy's rule for a stage name (state.ts's alchemyStage). */
const STAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Binding fields a stage can lay over a binding of the same type; any other difference replaces the binding. */
const STAGE_FIELDS = new Set(["value", "databaseName", "bucketName", "queueName", "indexName", "dataset", "namespaceId", "configName"]);

/**
 * Wrangler's `env.<name>` blocks as `stages`, against `base`, the config init made from the top level.
 * `missing` names the bindings an env leaves out: wrangler wouldn't bind them there, but a stage keeps them.
 */
export function wranglerStages(w: WranglerJson, base: RustyBunsConfig): { stages: Record<string, Stage>; missing: string[] } {
  const stages: Record<string, Stage> = {};
  const missing: string[] = [];
  for (const [n, e] of Object.entries(w.env ?? {})) {
    if (!STAGE_NAME.test(n) || !e) continue;
    const s: Stage = { workerName: e.name ?? `${w.name ?? "app"}-${n}` };
    if (e.account_id !== undefined) s.accountId = e.account_id;
    if (e.workers_dev !== undefined) s.workersDev = e.workers_dev;
    if (e.preview_urls !== undefined) s.previewUrls = e.preview_urls;
    if (e.route !== undefined || e.routes !== undefined) {
      const { domains, zoneRoutes } = edgeRoutes(e);
      s.domain = domains.length === 1 ? domains[0]! : domains;
      s.routes = zoneRoutes;
    }
    if (e.triggers !== undefined) s.crons = e.triggers.crons ?? [];
    // The env's own bindings, with the top level's containers so a container's DO reads as one.
    const own = wranglerToConfig({ ...Object.fromEntries(ENV_BINDINGS.flatMap((k) => e[k] === undefined ? [] : [[k, e[k]]])), containers: e.containers ?? w.containers }).bindings;
    const bindings: Record<string, StageBinding> = {};
    for (const [k, b] of Object.entries(own)) {
      const was = base.bindings[k];
      if (!was || was.type !== b.type) { bindings[k] = b; continue; }
      const diff = Object.entries(b).filter(([f, v]) => JSON.stringify(v) !== JSON.stringify((was as Record<string, unknown>)[f]));
      if (!diff.length) continue;
      bindings[k] = diff.every(([f]) => STAGE_FIELDS.has(f)) ? Object.fromEntries(diff) : b;
    }
    if (Object.keys(bindings).length) s.bindings = bindings;
    for (const [k, b] of Object.entries(base.bindings)) if (!own[k] && b.type !== "secret") missing.push(`env.${n}: ${k}`);
    stages[n] = s;
  }
  return { stages, missing };
}

/** A wrangler file's `route` and `routes`: custom domains the Worker owns, and the zone routes. */
function edgeRoutes(w: WranglerJson) {
  const routes = [...(w.route ? [w.route] : []), ...(w.routes ?? [])].map((r) => typeof r === "string" ? { pattern: r } : r);
  return {
    domains: routes.filter((r) => r.custom_domain).map((r) => r.pattern),
    zoneRoutes: routes.filter((r) => !r.custom_domain).map((r) => ({ pattern: r.pattern, ...(r.zone_name ? { zoneName: r.zone_name } : {}), ...(r.zone_id ? { zoneId: r.zone_id } : {}) })),
  };
}

/** A binding key from a queue or class name: `jobs-dlq` -> `JOBS_DLQ`, `MyBox` -> `MY_BOX`. */
const bindingKey = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "BINDING";
/** `key`, or `key_2`, `key_3`... when bindings already has it. */
const freeKey = (bindings: Record<string, unknown>, key: string) => { let k = key; for (let i = 2; k in bindings; i++) k = `${key}_${i}`; return k; };

/**
 * How the Worker is built, which decides where its bundle lands: RWSDK's vite build
 * (dist/worker), the Cloudflare Vite plugin's (dist/<name, dashes as underscores>),
 * or no build at all, a plain Worker that Alchemy bundles from its main.
 */
export type WorkerBuilt = "rwsdk" | "vite" | null;

export function wranglerToConfig(w: WranglerJson, scripts: Record<string, string> = {}, built: WorkerBuilt = "rwsdk"): RustyBunsConfig {
  const bindings: Record<string, Binding> = {};
  for (const d of w.d1_databases ?? []) bindings[d.binding] = { type: "d1", databaseName: d.database_name, migrationsDir: d.migrations_dir };
  for (const k of w.kv_namespaces ?? []) bindings[k.binding] = { type: "kv" };
  for (const r of w.r2_buckets ?? []) bindings[r.binding] = { type: "r2", bucketName: r.bucket_name };
  for (const o of w.durable_objects?.bindings ?? []) bindings[o.name] = { type: "durable_object", className: o.class_name, scriptName: o.script_name };
  // A container built from a Dockerfile here is its Durable Object binding with the image behind it.
  for (const k of w.containers ?? []) {
    if (!localImage(k.image)) continue;
    const name = Object.entries(bindings).find(([, b]) => b.type === "durable_object" && !b.scriptName && b.className === k.class_name)?.[0] ?? freeKey(bindings, bindingKey(k.class_name));
    bindings[name] = { type: "container", className: k.class_name, dockerfile: k.image.replace(/^\.\//, ""),
      ...(k.max_instances ? { maxInstances: k.max_instances } : {}), ...(typeof k.instance_type === "string" ? { instanceType: k.instance_type } : {}) };
  }
  for (const f of w.workflows ?? []) bindings[f.binding] = { type: "workflow", className: f.class_name, ...(f.script_name ? { scriptName: f.script_name } : {}) };
  for (const a of w.analytics_engine_datasets ?? []) bindings[a.binding] = { type: "analytics_engine", ...(a.dataset ? { dataset: a.dataset } : {}) };
  for (const l of w.worker_loaders ?? []) bindings[l.binding] = { type: "worker_loader" };
  // Wrangler doesn't record an index's dimensions, so this binding fails the config's check until
  // they're filled in: guessing would have Alchemy replace the index, and its vectors with it.
  for (const v of w.vectorize ?? []) bindings[v.binding] = { type: "vectorize", indexName: v.index_name } as Binding;
  if (w.images?.binding) bindings[w.images.binding] = { type: "images" };
  for (const e of w.send_email ?? []) bindings[e.name] = { type: "send_email", ...(e.allowed_sender_addresses ? { allowedSenderAddresses: e.allowed_sender_addresses } : {}) };
  for (const l of w.ratelimits ?? []) bindings[l.name] = { type: "ratelimit", namespaceId: String(l.namespace_id), simple: l.simple };
  if (w.ai?.binding) bindings[w.ai.binding] = { type: "ai" };
  // The origin lives in the Hyperdrive config on Cloudflare, not in wrangler: its URL becomes a secret.
  for (const [i, h] of (w.hyperdrive ?? []).entries()) {
    const urlSecret = i === 0 ? "DATABASE_URL" : `${h.binding}_URL`;
    bindings[urlSecret] ??= { type: "secret" };
    bindings[h.binding] = { type: "hyperdrive", urlSecret };
  }
  // Queues: each producer's binding, then a key for each queue only consumed (a dead-letter
  // queue's consumer, say) or only named as a dead-letter queue, which env doesn't get.
  const queueKey = new Map<string, string>();
  for (const q of w.queues?.producers ?? []) if (!queueKey.has(q.queue)) queueKey.set(q.queue, q.binding);
  const consumers = w.queues?.consumers ?? [];
  for (const name of [...consumers.map((c) => c.queue), ...consumers.flatMap((c) => c.dead_letter_queue ? [c.dead_letter_queue] : [])])
    if (!queueKey.has(name)) queueKey.set(name, freeKey({ ...bindings, ...Object.fromEntries([...queueKey.values()].map((k) => [k, 1])) }, bindingKey(name)));
  const producers = new Set((w.queues?.producers ?? []).map((q) => q.binding));
  for (const [queue, key] of queueKey) {
    const c = consumers.find((c) => c.queue === queue);
    bindings[key] = { type: "queue", queueName: queue, ...(c ? { consumer: JSON.parse(JSON.stringify({
      batchSize: c.max_batch_size, maxWaitTimeMs: c.max_batch_timeout === undefined ? undefined : c.max_batch_timeout * 1000,
      maxRetries: c.max_retries, retryDelay: c.retry_delay, maxConcurrency: c.max_concurrency,
      deadLetterQueue: c.dead_letter_queue === undefined ? undefined : queueKey.get(c.dead_letter_queue) })) } : { consumer: false as const }),
      ...(producers.has(key) ? {} : { producer: false as const }) };
  }
  // Producers sharing a queue: the first one consumes it, the others only send.
  for (const q of w.queues?.producers ?? []) if (queueKey.get(q.queue) !== q.binding) bindings[q.binding] = { type: "queue", queueName: q.queue, consumer: false };
  for (const [k, v] of Object.entries(w.vars ?? {})) bindings[k] = { type: "var", value: String(v) };
  const rwf = w.assets?.run_worker_first;
  // Routes: a custom domain is a hostname the Worker owns; the rest are zone routes.
  const { domains, zoneRoutes } = edgeRoutes(w);
  const o = w.observability;
  const camel = (x: Record<string, unknown>) => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(x).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]))));
  const pick = <T extends object>(x: T, keys: (keyof T)[]) => Object.fromEntries(keys.filter((k) => x[k] !== undefined).map((k) => [k, x[k]]));
  return {
    name: w.name ?? "app",
    worker: {
      main: w.main ?? "src/worker.tsx",
      ...(built === "rwsdk" ? { builtMain: "dist/worker/worker.js" } : built === "vite" ? { builtMain: `dist/${(w.name ?? "app").replaceAll("-", "_")}/index.js` } : {}),
      // The Vite plugin always writes the client to dist/client; a plain Worker serves only what wrangler named.
      ...(() => { const a = built === "rwsdk" ? w.assets?.directory ?? "dist/client" : built === "vite" ? "dist/client" : w.assets?.directory; return a ? { assets: a } : {}; })(),
      runWorkerFirst: Array.isArray(rwf) ? rwf : rwf === true ? ["/*"] : undefined,
      ...(w.assets?.not_found_handling ? { notFoundHandling: w.assets.not_found_handling } : {}),
      compatibilityDate: w.compatibility_date ?? new Date().toISOString().slice(0, 10),
      compatibilityFlags: w.compatibility_flags ?? ["nodejs_compat"],
      ...(() => { const b = inferWorkerBuild(scripts, built ? "vite build" : null).build; return b ? { build: b } : {}; })(),
      ...(w.triggers?.crons?.length ? { crons: w.triggers.crons } : {}),
      ...(w.limits?.cpu_ms ? { cpuMs: w.limits.cpu_ms } : {}),
      ...(w.placement?.mode === "smart" ? { placement: { mode: "smart" as const } } : {}),
      ...(o ? { observability: {
        ...camel({ enabled: o.enabled ?? !!(o.logs?.enabled || o.traces?.enabled), head_sampling_rate: o.head_sampling_rate }),
        ...(o.logs ? { logs: camel({ enabled: o.logs.enabled ?? true, ...pick(o.logs, ["invocation_logs", "head_sampling_rate", "persist"]) }) } : {}),
        ...(o.traces ? { traces: camel(pick(o.traces, ["enabled", "head_sampling_rate", "persist"])) } : {}),
      } } : {}),
    },
    bindings,
    targets: {
      edge: { provider: "cloudflare", ...(domains.length ? { domain: domains.length === 1 ? domains[0] : domains } : {}), ...(zoneRoutes.length ? { routes: zoneRoutes } : {}),
        ...(w.account_id ? { accountId: w.account_id } : {}), ...(w.workers_dev !== undefined ? { workersDev: w.workers_dev } : {}),
        ...(w.preview_urls !== undefined ? { previewUrls: w.preview_urls } : {}) },
      desktop: {
        mode: "spa",
        clientBuild: "vite build --config vite.desktop.config.ts",
        clientDir: "dist/desktop",
        world: "packages/desktop/world.ts",
        worldPath: "/ws",
        targets: ["darwin-arm64"],
        window: "app",
      },
    },
  };
}
