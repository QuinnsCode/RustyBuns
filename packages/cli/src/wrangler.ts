// wrangler.jsonc -> RustyBunsConfig. Reads what RWSDK's scaffold emits.

import type { Binding, RustyBunsConfig } from "./config.ts";
import { inferWorkerBuild } from "./glue/build-script.ts";

import { stripJsonc } from "./glue/jsonc.ts";
export { stripJsonc };

export interface WranglerJson {
  name?: string;
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  assets?: { directory?: string; binding?: string; run_worker_first?: boolean | string[] };
  d1_databases?: { binding: string; database_name: string; database_id?: string; migrations_dir?: string }[];
  kv_namespaces?: { binding: string; id?: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  durable_objects?: { bindings?: { name: string; class_name: string; script_name?: string }[] };
  migrations?: { tag: string; new_classes?: string[]; new_sqlite_classes?: string[]; renamed_classes?: { from: string; to: string }[]; deleted_classes?: string[] }[];
  vars?: Record<string, string>;
  triggers?: { crons?: string[] };
  images?: { binding: string };
  send_email?: { name: string; allowed_sender_addresses?: string[] }[];
  [k: string]: unknown;
}

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
  "d1_databases", "kv_namespaces", "r2_buckets", "durable_objects", "migrations", "vars", "triggers", "images", "send_email",
]);

/** Wrangler keys (bindings, routes, per-env overrides) that `init` cannot represent yet. */
export function droppedWranglerKeys(w: WranglerJson): string[] {
  return Object.keys(w).filter((k) => !HANDLED.has(k));
}

export function wranglerToConfig(w: WranglerJson, scripts: Record<string, string> = {}): RustyBunsConfig {
  const bindings: Record<string, Binding> = {};
  for (const d of w.d1_databases ?? []) bindings[d.binding] = { type: "d1", databaseName: d.database_name, migrationsDir: d.migrations_dir };
  for (const k of w.kv_namespaces ?? []) bindings[k.binding] = { type: "kv" };
  for (const r of w.r2_buckets ?? []) bindings[r.binding] = { type: "r2", bucketName: r.bucket_name };
  for (const o of w.durable_objects?.bindings ?? []) bindings[o.name] = { type: "durable_object", className: o.class_name, scriptName: o.script_name };
  if (w.images?.binding) bindings[w.images.binding] = { type: "images" };
  for (const e of w.send_email ?? []) bindings[e.name] = { type: "send_email", ...(e.allowed_sender_addresses ? { allowedSenderAddresses: e.allowed_sender_addresses } : {}) };
  for (const [k, v] of Object.entries(w.vars ?? {})) bindings[k] = { type: "var", value: String(v) };
  const rwf = w.assets?.run_worker_first;
  return {
    name: w.name ?? "app",
    worker: {
      main: w.main ?? "src/worker.tsx",
      builtMain: "dist/worker/worker.js",
      assets: w.assets?.directory ?? "dist/client",
      runWorkerFirst: Array.isArray(rwf) ? rwf : rwf === true ? ["/*"] : undefined,
      compatibilityDate: w.compatibility_date ?? new Date().toISOString().slice(0, 10),
      compatibilityFlags: w.compatibility_flags ?? ["nodejs_compat"],
      build: inferWorkerBuild(scripts).build,
      ...(w.triggers?.crons?.length ? { crons: w.triggers.crons } : {}),
    },
    bindings,
    targets: {
      edge: { provider: "cloudflare" },
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
