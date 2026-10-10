// RustyBunsConfig -> wrangler.jsonc. Alchemy is canonical; this exists so
// RWSDK's Vite plugin (which reads wrangler.jsonc for local bindings) agrees
// with what Alchemy deploys. Never hand-edit; edit the config.

import type { DoMigration, RustyBunsConfig } from "../config.ts";
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
    name: c.name,
    main: c.worker.main,
    compatibility_date: c.worker.compatibilityDate,
    compatibility_flags: c.worker.compatibilityFlags,
  };
  if (c.worker.assets) {
    w["assets"] = { binding: "ASSETS", directory: c.worker.assets, ...(c.worker.runWorkerFirst ? { run_worker_first: c.worker.runWorkerFirst } : {}) };
  }
  const d1: unknown[] = [], kv: unknown[] = [], r2: unknown[] = [], dos: unknown[] = [], artifacts: unknown[] = [], containers: unknown[] = [];
  const vars: Record<string, string> = {};
  const sqliteClasses: string[] = [];
  // No database_id / KV id: local dev doesn't need them, and a placeholder makes
  // `wrangler d1 ... --remote` in the app dir send it to the API (code 7400).
  // Without one, wrangler resolves the database by name.
  for (const [name, b] of Object.entries(c.bindings)) {
    if (b.type === "d1") d1.push({ binding: name, database_name: b.databaseName, ...(b.migrationsDir ? { migrations_dir: b.migrationsDir } : {}) });
    if (b.type === "kv") kv.push({ binding: name });
    if (b.type === "r2") r2.push({ binding: name, bucket_name: b.bucketName });
    if (b.type === "durable_object") { dos.push({ name, class_name: b.className, ...(b.scriptName ? { script_name: b.scriptName } : {}) }); if (!b.scriptName) sqliteClasses.push(b.className); }
    if (b.type === "var") vars[name] = b.value;
    if (b.type === "artifacts") artifacts.push({ binding: name, namespace: b.namespace });
    // Wrangler takes one Images binding, as an object.
    if (b.type === "images") w["images"] = { binding: name };
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
  if (dos.length) w["durable_objects"] = { bindings: dos };
  const migrations = doMigrations(sqliteClasses, previousMigrations(previous), c.worker.migrations);
  if (migrations.length) w["migrations"] = migrations;
  if (Object.keys(vars).length) w["vars"] = vars;
  if (c.worker.crons?.length) w["triggers"] = { crons: c.worker.crons };
  const header = `// GENERATED by rustybuns from rustybuns.config.ts. Alchemy owns the real\n// infra; this file only feeds RWSDK's local dev. Do not hand-edit.\n`;
  return header + JSON.stringify(w, null, 2) + "\n";
}
