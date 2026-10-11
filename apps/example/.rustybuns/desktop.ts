// GENERATED desktop entry. The RWSDK worker runs here, outside Cloudflare,
// with sqlite standing in for D1/KV. Same fetch(), same env shape.
import { serve, openBrowser, mintToken, localBindings, stdoutReporter, applyD1Migrations } from "@rustybuns/shell-bun";
import worker, { WorldDurableObject } from "../dist/worker/worker.js";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { basename, join, isAbsolute } from "node:path";

// Compiled: --asset embeds the dir at /$bunfs/root/<basename>. Dev: use the real path.
function assetDir(rel: string): string | undefined {
  if (!rel) return undefined;
  const embedded = join(import.meta.dir, basename(rel));
  return existsSync(embedded) ? embedded : join(process.cwd(), rel);
}

const dataDir = "~/.druids-curse".replace(/^~/, homedir());
mkdirSync(dataDir, { recursive: true });
const local = localBindings(dataDir);
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : undefined; };
const [lh, lp] = (flag("listen") ?? process.env.RB_LISTEN ?? "").split(":");
const listen = { hostname: lh || "127.0.0.1", port: lp ? Number(lp) : 0 };

const env: Record<string, unknown> = {
  DB: local.d1("druids-curse-db"),
  PRESENCE_KV: local.kv("PRESENCE_KV"),
  DEBUG_DIRECTOR_USERS: "",
};
// D1 is sqlite: your wrangler migrations apply here unchanged, tracked in
// d1_migrations. Embedded via --asset so the binary carries its own schema.

// Durable Objects run in-process. Bound after env exists because a DO's
// constructor receives this same env (a DO can use DB, KV, other DOs).
env.WORLD_DURABLE_OBJECT = local.durableObject(WorldDurableObject as any, env, "WORLD_DURABLE_OBJECT");
// Lets import { env } from "cloudflare:workers" see the local bindings.
globalThis.__RB_ENV = env;

const token = mintToken();
const shell = serve<typeof env>({
  assets: assetDir("dist/client"),
  runWorkerFirst: [],
  token,
  reporter: stdoutReporter, hostname: listen.hostname, port: listen.port,
});

// env.ASSETS, as the edge binds it: the Worker can fetch its own static files.
env.ASSETS ??= shell.assets;
shell.mount(worker as any, env);
console.log(`[druids-curse] serving ${shell.url}`);
await openBrowser({ url: shell.url, token, code: shell.launchCode(), window: "app" });
