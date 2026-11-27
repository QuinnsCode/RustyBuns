// RustyBunsConfig -> wrangler.jsonc. Alchemy is canonical; this exists so
// RWSDK's Vite plugin (which reads wrangler.jsonc for local bindings) agrees
// with what Alchemy deploys. Never hand-edit; edit the config.

import { TURNSTILE_TEST_SECRET, TURNSTILE_TEST_SITE_KEY, turnstileEnv, workerName, type DoMigration, type QueueConsumer, type RustyBunsConfig } from "../config.ts";
import { parseWrangler } from "../wrangler.ts";

/**
 * The migration history wrangler.jsonc should carry for `classes`: the steps
 * it already has, then the config's declared ones it lacks, then one new tag
 * for any class still not created. Cloudflare refuses a deployed tag that
 * changes (code 10074), so history is only ever appended to.
 */
export function doMigrations(classes: string[], previous: DoMigration[] = [], declared: DoMigration[] = [], flagged: Record<string, string> = {}, moved: string[] = []): DoMigration[] {
  const history = [...previous];
  for (const m of declared) if (!history.some((h) => h.tag === m.tag)) history.push(m);
  const live = new Set<string>();
  for (const m of history) {
    for (const k of [...(m.new_classes ?? []), ...(m.new_sqlite_classes ?? [])]) live.add(k);
    for (const r of m.renamed_classes ?? []) { live.delete(r.from); live.add(r.to); }
    for (const k of m.deleted_classes ?? []) live.delete(k);
  }
  // `moved`: still bound, but hosted by another app now (a durable_object's `app`); its data went with it, so it isn't gone.
  const gone = [...live].filter((k) => !classes.includes(k) && !moved.includes(k));
  if (gone.length) throw new Error(unboundMessage(gone, nextTag(history), flagged));
  const added = classes.filter((k) => !live.has(k));
  if (added.length) history.push({ tag: nextTag(history), new_sqlite_classes: added });
  return history;
}

/**
 * Why a deploy stops on a class that left the bindings. Most often a flag the config reads is off
 * in this shell, so that comes first (#3428): `deleted_classes` wipes the class's live data.
 */
function unboundMessage(gone: string[], tag: string, flagged: Record<string, string>): string {
  const s = gone.length > 1;
  const flags = [...new Set(gone.flatMap((k) => flagged[k] ? [flagged[k]] : []))];
  const head = `Durable Object class${s ? "es" : ""} ${gone.join(", ")} ${s ? "are" : "is"} in wrangler.jsonc's migrations but not bound by this run. `;
  const on = flags.length
    ? `The config binds ${s ? "them" : "it"} only with ${flags.join(" ")}: run again with ${flags.length > 1 ? "those" : "that"} set. `
    : `If a flag or env var in the config turns the binding off, run again with it on. `;
  const unflagged = gone.filter((k) => !flagged[k]);
  if (!unflagged.length) return head + on + `Don't add deleted_classes for ${s ? "them" : "it"}: that deletes the live data.`;
  return head + on + `If ${unflagged.length > 1 ? "they were" : "it was"} really removed or renamed, say so in worker.migrations: ` +
    `{ tag: "${tag}", renamed_classes: [{ from: "${unflagged[0]}", to: "NewName" }] }, or { tag: "${tag}", deleted_classes: ${JSON.stringify(unflagged)} } (deletes the data for good).`;
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
  const snake = (x: object) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase()), v]));
  return { ...snake({ enabled: o.enabled, headSamplingRate: o.headSamplingRate }), ...(o.logs ? { logs: snake(o.logs) } : {}), ...(o.traces ? { traces: snake(o.traces) } : {}) };
}

/** The migrations in an existing wrangler.jsonc, or none when it's missing or unreadable. */
export function previousMigrations(src: string | null): DoMigration[] {
  if (!src) return [];
  try { return ((parseWrangler(src).migrations ?? []) as DoMigration[]).filter((m) => typeof m?.tag === "string"); } catch { return []; }
}

type Worker = NonNullable<RustyBunsConfig["worker"]>;
type Binding = { binding: string };

/** The wrangler.jsonc keys this file writes, from wrangler's own schema (node_modules/wrangler/config-schema.json). */
interface WranglerJson {
  $schema: string;
  name: string;
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  assets?: { binding?: string; directory: string; run_worker_first?: Worker["runWorkerFirst"]; not_found_handling?: Worker["notFoundHandling"] };
  images?: Binding;
  ai?: Binding;
  browser?: Binding;
  containers?: object[];
  d1_databases?: object[];
  kv_namespaces?: object[];
  r2_buckets?: object[];
  artifacts?: object[];
  send_email?: object[];
  ratelimits?: object[];
  vectorize?: object[];
  hyperdrive?: object[];
  queues?: { producers?: object[]; consumers?: object[] };
  workflows?: object[];
  analytics_engine_datasets?: object[];
  worker_loaders?: object[];
  services?: object[];
  durable_objects?: { bindings?: object[]; code_update_strategy?: object };
  migrations?: DoMigration[];
  vars?: Record<string, string>;
  limits?: { cpu_ms: number };
  placement?: Worker["placement"];
  observability?: object;
  triggers?: { crons: string[] };
  connect?: { protocol: "tcp"; port: number }[];
}

/** `previous` is the current wrangler.jsonc, whose migration history is kept. */
export function generateWrangler(c: RustyBunsConfig, previous: string | null = null): string {
  if (!c.worker) throw new Error("this config has no worker section (desktop-only app); there is no edge stack to generate");
  // Built up key by key; the keys come out in the order they are set.
  const w: WranglerJson = {
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
  const d1: object[] = [], kv: object[] = [], r2: object[] = [], dos: object[] = [], artifacts: object[] = [], containers: object[] = [], sendEmail: object[] = [], ratelimits: object[] = [], vectorize: object[] = [], hyperdrive: object[] = [];
  const producers: object[] = [], consumers: object[] = [], workflows: object[] = [], analytics: object[] = [], loaders: object[] = [], services: object[] = [];
  const vars: Record<string, string> = {};
  const sqliteClasses: string[] = [];
  // No database_id / KV id: local dev doesn't need them, and a placeholder makes
  // `wrangler d1 ... --remote` in the app dir send it to the API (code 7400).
  // Without one, wrangler resolves the database by name.
  for (const [name, b] of Object.entries(c.bindings ?? {})) {
    if (b.type === "d1") d1.push({ binding: name, database_name: b.databaseName, ...(b.migrationsDir ? { migrations_dir: b.migrationsDir } : {}) });
    if (b.type === "kv") kv.push({ binding: name });
    if (b.type === "r2") r2.push({ binding: name, bucket_name: b.bucketName });
    // Locally another app's Worker goes by its app name (each app's wrangler.jsonc `name`), run beside this one (vite's auxiliaryWorkers).
    if (b.type === "durable_object") {
      const host = b.scriptName ?? b.app;
      dos.push({ name, class_name: b.className, ...(host ? { script_name: host } : {}) });
      if (!host) sqliteClasses.push(b.className);
    }
    if (b.type === "service") services.push({ binding: name, service: b.app, ...(b.entrypoint ? { entrypoint: b.entrypoint } : {}) });
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
    // Wrangler takes one Browser binding, as an object.
    if (b.type === "browser") w["browser"] = { binding: name };
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
  if (services.length) w["services"] = services;
  const codeUpdate = c.worker.codeUpdate;
  const strategy = codeUpdate && (codeUpdate === "immediate" ? { mode: "immediate" } : { mode: "deferred", max_delay: codeUpdate.maxDelay });
  if (dos.length || strategy) w["durable_objects"] = { ...(dos.length ? { bindings: dos } : {}), ...(strategy ? { code_update_strategy: strategy } : {}) };
  const moved = Object.values(c.bindings ?? {}).flatMap((b) => b.type === "durable_object" && b.app ? [b.className] : []);
  const migrations = doMigrations(sqliteClasses, previousMigrations(previous), c.worker.migrations, c.worker.flaggedClasses, moved);
  if (migrations.length) w["migrations"] = migrations;
  // worker.turnstile in local dev: Cloudflare's always-pass test keys. The deployed widget's keys come from the stack.
  if (c.worker?.turnstile) { const t = turnstileEnv(c.worker.turnstile); vars[t.siteKey] = TURNSTILE_TEST_SITE_KEY; vars[t.secret] = TURNSTILE_TEST_SECRET; }
  if (Object.keys(vars).length) w["vars"] = vars;
  if (c.worker.cpuMs) w["limits"] = { cpu_ms: c.worker.cpuMs };
  if (c.worker.placement) w["placement"] = c.worker.placement;
  if (c.worker.observability) w["observability"] = wranglerObservability(c.worker.observability);
  if (c.worker.crons?.length) w["triggers"] = { crons: c.worker.crons };
  if (c.worker.connect) w["connect"] = [{ protocol: "tcp", port: c.worker.connect.port }];
  const header = `// GENERATED by rustybuns from rustybuns.config.ts. Alchemy owns the real\n// infra; this file only feeds RWSDK's local dev. Do not hand-edit.\n`;
  return header + JSON.stringify(w, null, 2) + "\n";
}
