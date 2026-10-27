// GENERATED desktop entry. The RWSDK worker runs here, outside Cloudflare,
// with sqlite standing in for D1/KV. Same fetch(), same env shape.
import { serve, openBrowser, writeDesktopFile, mintToken, localBindings, stdoutReporter, applyD1Migrations, launchCheck, memWatch, gitHttp, schedule } from "@rustybuns/shell-bun";
import worker, { FileDurableObject, GameRoom, RepoSearch } from "../dist/worker/worker.js";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { basename, join, isAbsolute } from "node:path";

declare const RB_VERSION: string, RB_RUSTYBUNS: string, RB_DEV: boolean;
// Compiled: --asset embeds the dir at /$bunfs/root/<basename>. Dev: use the real path.
function assetDir(rel: string): string | undefined {
  if (!rel) return undefined;
  const embedded = join(import.meta.dir, basename(rel));
  return existsSync(embedded) ? embedded : join(process.cwd(), rel);
}

const dataDir = "~/.codesplitters".replace(/^~/, homedir());
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
  DB: local.d1("codesplitters-db"),
  HOOKS: local.queue("codesplitters-hooks"),
  JOBS: local.queue("codesplitters-jobs"),
  LEVEL_DIGS: local.queue("codesplitters-level-digs"),
  ARTIFACTS: local.artifacts("codesplitters"),
  // LEVEL_CHUNKS: R2 -> directory adapter (slice 2)
  BETTER_AUTH_SECRET: process.env["BETTER_AUTH_SECRET"] ?? "",
  BETTER_AUTH_URL: "https://codesplitters.notryanquinn.workers.dev",
  GITHUB_CLIENT_ID: process.env["GITHUB_CLIENT_ID"] ?? "",
  GITHUB_CLIENT_SECRET: process.env["GITHUB_CLIENT_SECRET"] ?? "",
  GOOGLE_CLIENT_ID: process.env["GOOGLE_CLIENT_ID"] ?? "",
  GOOGLE_CLIENT_SECRET: process.env["GOOGLE_CLIENT_SECRET"] ?? "",
  ADMINS: "quinn",
  ADMIN_EMAIL: process.env["ADMIN_EMAIL"] ?? "",
  PRIVACY_EMAIL: process.env["PRIVACY_EMAIL"] ?? "",
  // AUTH_LIMIT: Workers Rate Limiting has no local twin; the app runs without it
};
// D1 is sqlite: your wrangler migrations apply here unchanged, tracked in
// d1_migrations. Embedded via --asset so the binary carries its own schema.
for (const f of await applyD1Migrations(env.DB as any, assetDir("migrations")!)) console.log("[migrate] " + f);
// Durable Objects run in-process. Bound after env exists because a DO's
// constructor receives this same env (a DO can use DB, KV, other DOs).
env.FILES = local.durableObject(FileDurableObject as any, env, "FILES");
env.GAMES = local.durableObject(GameRoom as any, env, "GAMES");
env.SEARCH = local.durableObject(RepoSearch as any, env, "SEARCH");
// Lets import { env } from "cloudflare:workers" see the local bindings.
globalThis.__RB_ENV = env;

const token = mintToken();
const shell = serve<typeof env>({
  assets: assetDir("dist/client"),
  runWorkerFirst: [],
  token,
  reporter: stdoutReporter, hostname: listen.hostname, port: listen.port,
  // Artifacts remotes: git clients bring a repo token, not the host cookie.
  open: { "/__rb/git/": (req: Request) => gitHttp(req, [env.ARTIFACTS as any]) },
});
(env.ARTIFACTS as any).remoteBase = shell.url;
// env.ASSETS, as the edge binds it: the Worker can fetch its own static files.
env.ASSETS ??= shell.assets;
shell.mount({ fetch: (req: Request, e: any, ctx: any) => new URL(req.url).pathname === "/__rb/mem" ? Response.json(mem.stats()) : (worker as any).fetch(req, e, ctx) } as any, env);
console.log(`[codesplitters] serving ${shell.url}`);
// Cron Triggers: the edge runs scheduled() on these; here a minute timer does.
schedule(["0 * * * *","*/5 * * * *"], (controller) => (worker as any).scheduled?.(controller, env, { waitUntil() {}, passThroughOnException() {} }));
// Queue consumer: the edge hands HOOKS's batches to queue(); here an in-process loop does.
(env.HOOKS as any).consume((batch: unknown) => (worker as any).queue?.(batch, env, { waitUntil() {}, passThroughOnException() {} }), {"batchSize":10});
// Queue consumer: the edge hands JOBS's batches to queue(); here an in-process loop does.
(env.JOBS as any).consume((batch: unknown) => (worker as any).queue?.(batch, env, { waitUntil() {}, passThroughOnException() {} }), {"batchSize":10});
// Queue consumer: the edge hands LEVEL_DIGS's batches to queue(); here an in-process loop does.
(env.LEVEL_DIGS as any).consume((batch: unknown) => (worker as any).queue?.(batch, env, { waitUntil() {}, passThroughOnException() {} }), {"batchSize":1,"maxRetries":3,"retryDelay":20});
launchCheck(typeof RB_RUSTYBUNS === "string" ? RB_RUSTYBUNS : undefined, { dev: typeof RB_DEV === "boolean" && RB_DEV });
// <data>/desktop.json (0600, gone on exit) is how local tools find this run without RB_NO_BROWSER.
writeDesktopFile(dataDir, shell.url, token);
await openBrowser({ url: shell.url, token, code: shell.launchCode(), window: "app" });
