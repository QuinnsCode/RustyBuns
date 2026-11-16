// cloudflare.config.ts (the `cf` CLI's TypeScript config) -> the wrangler shape wranglerToConfig reads.
//
// The file is code, so it runs in a child process: a worker it pulls in can't touch the CLI. Its
// `import * as w from "./src/worker" with { type: "cf-worker" }` would run the Worker there and lose
// the path, so that import is swapped for its specifier before the file runs, and becomes `main`.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isRecord } from "./state.ts";
import type { WranglerJson } from "./wrangler.ts";

export const CLOUDFLARE_CONFIG = "cloudflare.config.ts";

/**
 * What init carries over: the wrangler shape, plus the secrets wrangler files don't list. `unsupported`
 * names the bindings it can't carry ("JOBS (queue)"): init stops on them unless --force, so a
 * Worker never deploys missing one without saying so.
 */
export interface CloudflareConfig { wrangler: WranglerJson; secrets: string[]; unsupported: string[] }

const WORKER_IMPORT = /import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s+(["'])([^"']+)\2\s+with\s*\{\s*type\s*:\s*(["'])cf-worker\4\s*\}\s*;?/g;
const INCOMPLETE = /throw\s+new\s+Error\(\s*[`"']Migration incomplete/;
const WORKER_MARK = "__cfWorker";

/** The file with each cf-worker import replaced by a stand-in that holds only its specifier. */
export function withoutWorkerImports(src: string): string {
  return src.replace(WORKER_IMPORT, (_, name: string, _q, spec: string) => `const ${name} = { ${WORKER_MARK}: ${JSON.stringify(spec)} };`);
}

/** A worker import's file, as a path from the app root: `./src/worker` -> `src/worker.ts`. */
function entryFile(root: string, spec: string): string {
  const base = join(root, spec);
  const hit = [base, ...[".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"].map((x) => base + x)].find(existsSync) ?? base;
  return relative(root, hit).split("\\").join("/");
}

/** Run `cloudflare.config.ts` in a child Bun and read back the config it builds. */
export function loadCloudflareConfig(path: string, fallbackMain: string | null = null): CloudflareConfig {
  const src = readFileSync(path, "utf8");
  if (INCOMPLETE.test(src)) throw new Error(incomplete());
  const root = dirname(resolve(path));
  // Beside the original, so its relative imports and `cf/config` from node_modules resolve the same.
  const tmp = join(root, `.${basename(path, ".ts")}.rustybuns-${process.pid}.ts`);
  writeFileSync(tmp, withoutWorkerImports(src));
  try {
    const run = `const m = await import(process.argv[1]); let c = m.default ?? m; if (typeof c === "function") c = await c({ mode: "production" }); process.stdout.write(JSON.stringify(c ?? null));`;
    const p = Bun.spawnSync([process.execPath, "-e", run, tmp], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, NODE_ENV: "production" } });
    const err = p.stderr.toString();
    if (/Migration incomplete/.test(err)) throw new Error(incomplete());
    if (p.exitCode !== 0) throw new Error(`${CLOUDFLARE_CONFIG} didn't load: ${err.trim().split("\n").slice(-3).join(" ") || `exit ${p.exitCode}`}`);
    const data: unknown = JSON.parse(p.stdout.toString() || "null");
    return cloudflareToWrangler(data, (spec) => entryFile(root, spec), fallbackMain);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function incomplete() {
  return `${CLOUDFLARE_CONFIG} still says "Migration incomplete": \`cf migrate\` left TODOs in it (assets directory, D1 migrations_dir, Durable Objects). Finish them and delete that throw, then run init again.`;
}

const text = (v: unknown) => typeof v === "string" && v ? v : undefined;

/** The config `defineConfig` built, as wrangler keys. */
export function cloudflareToWrangler(data: unknown, resolveEntry: (spec: string) => string = (s) => s.replace(/^\.\//, ""), fallbackMain: string | null = null): CloudflareConfig {
  if (!isRecord(data)) throw new Error(`${CLOUDFLARE_CONFIG}: its default export isn't a config object (defineConfig({ worker: { ... } }))`);
  const w = isRecord(data.worker) ? data.worker : data;
  const name = text(w.name);
  const entry = w.entrypoint ?? w.main;
  const main = typeof entry === "string" ? resolveEntry(entry) : isRecord(entry) && typeof entry[WORKER_MARK] === "string" ? resolveEntry(entry[WORKER_MARK]) : fallbackMain ?? undefined;
  const out: WranglerJson = {
    ...(name ? { name } : {}),
    ...(main ? { main } : {}),
    ...(text(w.compatibilityDate) ? { compatibility_date: text(w.compatibilityDate) } : {}),
    ...(Array.isArray(w.compatibilityFlags) ? { compatibility_flags: w.compatibilityFlags.filter((f): f is string => typeof f === "string") } : {}),
  };
  const secrets: string[] = [];
  const unsupported: string[] = [];
  const env = isRecord(w.env) ? w.env : {};
  for (const [key, b] of Object.entries(env)) {
    if (typeof b === "string") { (out.vars ??= {})[key] = b; continue; }
    const type = isRecord(b) ? text(b.type) : undefined;
    if (!isRecord(b) || !type) { unsupported.push(`${key} (not a binding)`); continue; }
    switch (type) {
      case "d1": (out.d1_databases ??= []).push({ binding: key, database_name: text(b.name) ?? text(b.databaseName) ?? key.toLowerCase(), ...(text(b.id) ? { database_id: text(b.id) } : {}) }); break;
      case "kv": (out.kv_namespaces ??= []).push({ binding: key, ...(text(b.id) ? { id: text(b.id) } : {}) }); break;
      case "r2": (out.r2_buckets ??= []).push({ binding: key, bucket_name: text(b.name) ?? text(b.bucketName) ?? key.toLowerCase() }); break;
      case "text": (out.vars ??= {})[key] = String(b.value ?? b.text ?? ""); break;
      case "secret": secrets.push(key); break;
      case "assets": out.assets = { ...out.assets, binding: key }; break;
      case "durable-object": {
        const cls = text(b.exportName) ?? text(b.className) ?? text(b.class_name);
        if (!cls) { unsupported.push(`${key} (durable-object with no exportName)`); break; }
        const script = text(b.worker) ?? text(b.scriptName);
        (out.durable_objects ??= { bindings: [] }).bindings!.push({ name: key, class_name: cls, ...(script && script !== name ? { script_name: script } : {}) });
        break;
      }
      default: unsupported.push(`${key} (${type})`);
    }
  }
  return { wrangler: out, secrets, unsupported };
}
