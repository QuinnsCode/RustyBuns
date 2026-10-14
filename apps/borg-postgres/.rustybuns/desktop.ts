// GENERATED desktop entry. The RWSDK worker runs here, outside Cloudflare,
// with sqlite standing in for D1/KV. Same fetch(), same env shape.
// First: workerd's globalThis.Cloudflare, read by nodejs_compat builds as they load.
import "@rustybuns/shell-bun/workerd-global";
import { serve, openBrowser, writeDesktopFile, mintToken, localBindings, stdoutReporter, applyD1Migrations, launchCheck, memWatch, within, metered, usageSnapshot, capped, edgeLimits } from "@rustybuns/shell-bun";
// Bun's own process: a Worker built with nodejs_compat (unenv) swaps globalThis.process for
// one whose cwd() is "/" and argv is empty, and that would move assets and flags (#741).
import process from "node:process";
import { homedir } from "node:os";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { basename, join, isAbsolute, resolve } from "node:path";
import { pgliteHyperdrive } from "@rustybuns/shell-bun/pglite";
import pglite0 from "./pglite/pglite.wasm" with { type: "file" };
import pglite1 from "./pglite/initdb.wasm" with { type: "file" };
import pglite2 from "./pglite/pglite.data" with { type: "file" };
// Compiled: $bunfs paths. A dev bundle: paths beside it.
const pgliteFiles = { wasm: resolve(import.meta.dir, pglite0), initdb: resolve(import.meta.dir, pglite1), data: resolve(import.meta.dir, pglite2) };

declare const RB_VERSION: string, RB_RUSTYBUNS: string, RB_DEV: boolean;
// Compiled: --asset embeds the dir at /$bunfs/root/<basename>. Dev: use the real path.
function assetDir(rel: string): string | undefined {
  if (!rel) return undefined;
  const embedded = join(import.meta.dir, basename(rel));
  return existsSync(embedded) ? embedded : join(process.cwd(), rel);
}

const dataDir = resolve("~/.borg-postgres".replace(/^~/, homedir()));
mkdirSync(dataDir, { recursive: true });
const local = localBindings(dataDir);
// RSS and heap every 5 minutes, with the growth rate; /__rb/mem serves them.
// Over the ceiling (RB_MEM_MAX_MB) it writes a heap snapshot
// to <data>/heap and exits 1, so a leak stops before it takes the machine down.
const mem = memWatch({ maxMb: Number(process.env.RB_MEM_MAX_MB) || 0, snapshotDir: join(dataDir, "heap") });
mem.tick();
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : undefined; };
const [lh, lp] = (flag("listen") ?? process.env.RB_LISTEN ?? "").split(":");
const listen = { hostname: lh || "127.0.0.1", port: lp ? Number(lp) : 0 };

const env: Record<string, unknown> = {
  DATABASE_URL: process.env["DATABASE_URL"] ?? "",
  HYPERDRIVE: process.env["DATABASE_URL"] ? local.hyperdrive(process.env["DATABASE_URL"], "HYPERDRIVE") : await pgliteHyperdrive(join(dataDir, "pglite", "HYPERDRIVE"), "HYPERDRIVE", { ...pgliteFiles }),
};
// What each binding does, counted per request, cron tick and queue batch: /__rb/usage serves it and
// <data>/usage.json keeps it, for `rustybuns plan --usage` to turn into a monthly bill.
for (const [n, k] of Object.entries({})) env[n] = metered(n, k as any, env[n]);
setInterval(() => { try { writeFileSync(join(dataDir, "usage.json"), JSON.stringify(usageSnapshot())); } catch {} }, 60_000).unref();
// D1 is sqlite: your wrangler migrations apply here unchanged, tracked in
// d1_migrations. Embedded via --asset so the binary carries its own schema.

// Lets import { env } from "cloudflare:workers" see the local bindings, before the Worker loads:
// workerd gives a module its env at import, and apps read it at the top level
// (export const repo = makeRepo(await getDb())).
globalThis.__RB_ENV = env;
// Durable Objects run in-process, and their classes are the Worker's exports, so the namespaces
// are made once it has loaded. Until then each binding is a stand-in that forwards to the real
// one, for an app that keeps it at the top level (createDb(env.DB_DO), as rwsdk/db apps do).
const doLater = (name: string) => {
  let real: any;
  const bind = (r: unknown) => { real = r; };
  return new Proxy({}, { get: (_, k) => {
    if (k === "__rbBind") return bind;
    if (typeof k === "symbol" || k === "then") return real?.[k];
    if (!real) throw new Error(`${name}: a Durable Object used before the Worker finished loading`);
    const v = real[k];
    return typeof v === "function" ? v.bind(real) : v;
  } });
};

// workerd logs a rejected waitUntil, cron or queue promise and keeps serving; Bun would exit.
process.on("unhandledRejection", (e) => console.error("[worker] unhandled rejection:", e));
const { default: worker, } = await import("../src/worker.ts");
// into this same env, because a DO's constructor receives it (a DO can use DB, KV, other DOs)


const token = (typeof RB_DEV === "boolean" && RB_DEV && process.env.RB_TOKEN) || mintToken();
const shell = serve<typeof env>({
  assets: assetDir(""),
  runWorkerFirst: [],
  token,
  reporter: stdoutReporter, hostname: listen.hostname, port: listen.port,
});

// The edge's memory and CPU limits, measured per request (RB_CPU_MS=10 tries the Free plan's).
const limits = edgeLimits(undefined);
shell.mount({ fetch: (req: Request, e: any, ctx: any) => { const p = new URL(req.url).pathname; return p === "/__rb/mem" ? Response.json(mem.stats()) : p === "/__rb/usage" ? Response.json(usageSnapshot()) : within("request", () => capped(limits, () => (worker as any).fetch(req, e, ctx))); } } as any, env);
console.log(`[borg-postgres] serving ${shell.url}`);
launchCheck(typeof RB_RUSTYBUNS === "string" ? RB_RUSTYBUNS : undefined, { dev: typeof RB_DEV === "boolean" && RB_DEV });
// <data>/desktop.json (0600, gone on exit) is how local tools find this run without RB_NO_BROWSER.
writeDesktopFile(dataDir, shell.url, token);
await openBrowser({ url: shell.url, token, code: shell.launchCode(), window: "app" });
