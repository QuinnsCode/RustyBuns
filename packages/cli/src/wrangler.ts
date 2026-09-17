// wrangler.jsonc -> RustyBunsConfig. Reads what RWSDK's scaffold emits.

import type { Binding, RustyBunsConfig } from "./config.ts";

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
  migrations?: { tag: string; new_classes?: string[]; new_sqlite_classes?: string[] }[];
  vars?: Record<string, string>;
  [k: string]: unknown;
}

export function parseWrangler(src: string): WranglerJson {
  return JSON.parse(stripJsonc(src));
}

export function wranglerToConfig(w: WranglerJson): RustyBunsConfig {
  const bindings: Record<string, Binding> = {};
  for (const d of w.d1_databases ?? []) bindings[d.binding] = { type: "d1", databaseName: d.database_name, migrationsDir: d.migrations_dir };
  for (const k of w.kv_namespaces ?? []) bindings[k.binding] = { type: "kv" };
  for (const r of w.r2_buckets ?? []) bindings[r.binding] = { type: "r2", bucketName: r.bucket_name };
  for (const o of w.durable_objects?.bindings ?? []) bindings[o.name] = { type: "durable_object", className: o.class_name, scriptName: o.script_name };
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
      build: "vite build",
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
