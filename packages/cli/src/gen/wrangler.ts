// RustyBunsConfig -> wrangler.jsonc. Alchemy is canonical; this exists so
// RWSDK's Vite plugin (which reads wrangler.jsonc for local bindings) agrees
// with what Alchemy deploys. Never hand-edit; edit the config.

import { workerName, type DoMigration, type QueueConsumer, type RustyBunsConfig } from "../config.ts";
import { parseWrangler } from "../wrangler.ts";

/**
 * The migration history wrangler.jsonc should carry for `classes`: the steps
 * it already has, then the config's declared ones it lacks, then one new tag
 * for any class still not created. Cloudflare refuses a deployed tag that
 * changes (code 10074), so history is only ever appended to.
 */
export function doMigrations(classes: string[], previous: DoMigration[] = [], declared: DoMigration[] = []): DoMigration[] {
  const history = [...previous];
  for (const m of declared) if (!history.some((h) => h.tag === m.tag)) history.push(m);
  const live = new Set<string>();
  for (const m of history) {
    for (const k of [...(m.new_classes ?? []), ...(m.new_sqlite_classes ?? [])]) live.add(k);
    for (const r of m.renamed_classes ?? []) { live.delete(r.from); live.add(r.to); }
    for (const k of m.deleted_classes ?? []) live.delete(k);
  }
  const gone = [...live].filter((k) => !classes.includes(k));
  if (gone.length) {
    const tag = nextTag(history);
    throw new Error(`Durable Object class${gone.length > 1 ? "es" : ""} ${gone.join(", ")} ${gone.length > 1 ? "are" : "is"} in wrangler.jsonc's migrations but no longer bound. ` +
      `Say what happened in worker.migrations: { tag: "${tag}", deleted_classes: ${JSON.stringify(gone)} } (deletes the data), or { tag: "${tag}", renamed_classes: [{ from: "${gone[0]}", to: "NewName" }] }.`);
  }
  const added = classes.filter((k) => !live.has(k));
  if (added.length) history.push({ tag: nextTag(history), new_sqlite_classes: added });
  return history;
}

function nextTag(history: DoMigration[]): string {
  const n = Math.max(history.length, ...history.map((m) => Number(m.tag.match(/^v(\d+)$/)?.[1] ?? 0)));
  return `v${n + 1}`;
}

/** A `queues.consumers` entry: wrangler's names, and its batch timeout in seconds. */
function wranglerConsumer(queue: string, c: QueueConsumer, dlq?: string) {
  return {
    queue,
    ...(dlq !== undefined ? { dead_letter_queue: dlq } : {}),
    ...(c.batchSize !== undefined ? { max_batch_size: c.batchSize } : {}),
    ...(c.maxWaitTimeMs !== undefined ? { max_batch_timeout: c.maxWaitTimeMs / 1000 } : {}),
    ...(c.maxRetries !== undefined ? { max_retries: c.maxRetries } : {}),
    ...(c.retryDelay !== undefined ? { retry_delay: c.retryDelay } : {}),
    ...(c.maxConcurrency !== undefined ? { max_concurrency: c.maxConcurrency } : {}),
  };
}

/** worker.observability with wrangler's snake_case keys. */
function wranglerObservability(o: NonNullable<NonNullable<RustyBunsConfig["worker"]>["observability"]>) {
  const snake = (x: Record<string, unknown>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase()), v]));
  return { ...snake({ enabled: o.enabled, headSamplingRate: o.headSamplingRate }), ...(o.logs ? { logs: snake(o.logs) } : {}), ...(o.traces ? { traces: snake(o.traces) } : {}) };
}

/** The migrations in an existing wrangler.jsonc, or none when it's missing or unreadable. */
export function previousMigrations(src: string | null): DoMigration[] {
  if (!src) return [];
  try { return ((parseWrangler(src).migrations ?? []) as DoMigration[]).filter((m) => typeof m?.tag === "string"); } catch { return []; }
}

/** `previous` is the current wrangler.jsonc, whose migration history is kept. */
export function generateWrangler(c: RustyBunsConfig, previous: string | null = null): string {
  if (!c.worker) throw new Error("this config has no worker section (desktop-only app); there is no edge stack to generate");
  const w: Record<string, unknown> = {
    $schema: "node_modules/wrangler/config-schema.json",
    name: workerName(c),
    main: c.worker.main,
    compatibility_date: c.worker.compatibilityDate,
    compatibility_flags: c.worker.compatibilityFlags,
  };
  if (c.worker.assets) {
    // An assets-only Worker (no main) has no code to hand an ASSETS binding to, and wrangler refuses one.
    w["assets"] = { ...(c.worker.main ? { binding: "ASSETS" } : {}), directory: c.worker.assets, ...(c.worker.runWorkerFirst ? { run_worker_first: c.worker.runWorkerFirst } : {}),
      ...(c.worker.notFoundHandling ? { not_found_handling: c.worker.notFoundHandling } : {}) };
  }
  const d1: unknown[] = [], kv: unknown[] = [], r2: unknown[] = [], dos: unknown[] = [], artifacts: unknown[] = [], containers: unknown[] = [], sendEmail: unknown[] = [], ratelimits: unknown[] = [], vectorize: unknown[] = [], hyperdrive: unknown[] = [];
  const producers: unknown[] = [], consumers: unknown[] = [], workflows: unknown[] = [], analytics: unknown[] = [], loaders: unknown[] = [];
  const vars: Record<string, string> = {};
  const sqliteClasses: string[] = [];
  // No database_id / KV id: local dev doesn't need them, and a placeholder makes
  // `wrangler d1 ... --remote` in the app dir send it to the API (code 7400).
  // Without one, wrangler resolves the database by name.
  for (const [name, b] of Object.entries(c.bindings ?? {})) {
    if (b.type === "d1") d1.push({ binding: name, database_name: b.databaseName, ...(b.migrationsDir ? { migrations_dir: b.migrationsDir } : {}) });
    if (b.type === "kv") kv.push({ binding: name });
    if (b.type === "r2") r2.push({ binding: name, bucket_name: b.bucketName });
    if (b.type === "durable_object") { dos.push({ name, class_name: b.className, ...(b.scriptName ? { script_name: b.scriptName } : {}) }); if (!b.scriptName) sqliteClasses.push(b.className); }
    if (b.type === "var") vars[name] = b.value;
    if (b.type === "artifacts") artifacts.push({ binding: name, namespace: b.namespace });
    // Wrangler takes one Images binding, as an object.
    if (b.type === "images") w["images"] = { binding: name };
    if (b.type === "send_email") sendEmail.push({ name, ...(b.allowedSenderAddresses ? { allowed_sender_addresses: b.allowedSenderAddresses } : {}) });
    if (b.type === "ratelimit") ratelimits.push({ name, namespace_id: b.namespaceId, simple: b.simple });
    // Wrangler wants an id, but local dev never uses it: it connects to
    // CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<binding> instead, which keeps the password off disk.
    if (b.type === "hyperdrive") hyperdrive.push({ binding: name, id: "00000000000000000000000000000000" });
    if (b.type === "vectorize") vectorize.push({ binding: name, index_name: b.indexName });
    // Wrangler takes one AI binding, as an object.
    if (b.type === "ai") w["ai"] = { binding: name };
    if (b.type === "queue") {
      if (b.producer !== false) producers.push({ binding: name, queue: b.queueName });
      const dlq = b.consumer ? b.consumer.deadLetterQueue : undefined;
      const dlqBinding = dlq !== undefined ? c.bindings[dlq] : undefined;
      if (b.consumer !== false) consumers.push(wranglerConsumer(b.queueName, b.consumer ?? {}, dlqBinding?.type === "queue" ? dlqBinding.queueName : undefined));
    }
    // Wrangler wants a name; local dev only needs a unique one. Alchemy names the deployed workflow `<worker>-<class>-<hash>`.
    if (b.type === "workflow") workflows.push({ binding: name, name: `${workerName(c)}-${b.className}`.toLowerCase(), class_name: b.className, ...(b.scriptName ? { script_name: b.scriptName } : {}) });
    if (b.type === "analytics_engine") analytics.push({ binding: name, dataset: b.dataset ?? name });
    if (b.type === "worker_loader") loaders.push({ binding: name });
    if (b.type === "container") {
      dos.push({ name, class_name: b.className });
      sqliteClasses.push(b.className);
      containers.push({ class_name: b.className, image: b.dockerfile, max_instances: b.maxInstances ?? 1, instance_type: b.instanceType ?? "lite" });
    }
  }
  if (containers.length) w["containers"] = containers;
  if (d1.length) w["d1_databases"] = d1;
  if (kv.length) w["kv_namespaces"] = kv;
  if (r2.length) w["r2_buckets"] = r2;
  if (artifacts.length) w["artifacts"] = artifacts;
  if (sendEmail.length) w["send_email"] = sendEmail;
  if (ratelimits.length) w["ratelimits"] = ratelimits;
  if (vectorize.length) w["vectorize"] = vectorize;
  if (hyperdrive.length) w["hyperdrive"] = hyperdrive;
  if (producers.length || consumers.length) w["queues"] = { ...(producers.length ? { producers } : {}), ...(consumers.length ? { consumers } : {}) };
  if (workflows.length) w["workflows"] = workflows;
  if (analytics.length) w["analytics_engine_datasets"] = analytics;
  if (loaders.length) w["worker_loaders"] = loaders;
  if (dos.length) w["durable_objects"] = { bindings: dos };
  const migrations = doMigrations(sqliteClasses, previousMigrations(previous), c.worker.migrations);
  if (migrations.length) w["migrations"] = migrations;
  if (Object.keys(vars).length) w["vars"] = vars;
  if (c.worker.cpuMs) w["limits"] = { cpu_ms: c.worker.cpuMs };
  if (c.worker.placement) w["placement"] = c.worker.placement;
  if (c.worker.observability) w["observability"] = wranglerObservability(c.worker.observability);
  if (c.worker.crons?.length) w["triggers"] = { crons: c.worker.crons };
  const header = `// GENERATED by rustybuns from rustybuns.config.ts. Alchemy owns the real\n// infra; this file only feeds RWSDK's local dev. Do not hand-edit.\n`;
  return header + JSON.stringify(w, null, 2) + "\n";
}
