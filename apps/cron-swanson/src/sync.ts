// An app's own jobs, read from its folder and sent to Cron Swanson in one call:
//   bun apps/cron-swanson/src/sync.ts apps/qcrm [more app folders]
// Each folder may have a `cron-swanson.json` ({ app?, jobs: [{ key, name, cadence, why?, note?, tags?, tz?, action? }] })
// and a wrangler config whose `triggers.crons` come in as jobs Cloudflare runs, so they show in their lanes too.
// The app's name is the file's `app`, else the folder's name. Sends to CRON_SWANSON_URL (default
// http://localhost:8790) with CRON_SWANSON_TOKEN when set. Jobs made by hand on the page are never touched.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { arr, obj, opt, raw, rec, str } from "@rustybuns/util/guard";
import { parseJson } from "@rustybuns/util/http";
import { AppName, Declared, Refusal, SyncReply, type AppJobs } from "./api.ts";

const FILE = "cron-swanson.json";
const WRANGLER = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

const OwnFile = obj({ app: opt(AppName), jobs: arr(rec(raw, 20), 500) });
const Wrangler = obj({ triggers: opt(obj({ crons: arr(str(100), 50) })) });

/** A Cloudflare cron trigger as a job: keyed by its line, run by Cloudflare (always on UTC). */
const fromCron = (expr: string): Declared =>
  Declared({ key: `cloudflare:${expr}`, name: "Cloudflare cron trigger", why: "A cron trigger in the app's wrangler config", tags: ["cloudflare"], cadence: { kind: "cron", expr }, tz: "UTC", action: { kind: "elsewhere", by: "Cloudflare" } });

/** The cron lines in a wrangler config's top-level `triggers` (none when it has no triggers). */
export function wranglerCrons(name: string, text: string): string[] {
  const conf: unknown = name.endsWith(".toml") ? Bun.TOML.parse(text) : Bun.JSONC.parse(text);
  return Wrangler(conf).triggers?.crons ?? [];
}

/** Everything an app folder declares: its own list (with plain defaults filled in) and its Cloudflare crons. */
export function declared(dir: string): { app: string } & AppJobs {
  let app = basename(dir.replace(/\/+$/, ""));
  const jobs: Declared[] = [];
  if (existsSync(join(dir, FILE))) {
    const own = OwnFile(Bun.JSONC.parse(readFileSync(join(dir, FILE), "utf8")));
    app = own.app ?? app;
    for (const j of own.jobs) jobs.push(Declared({ tags: [], tz: "UTC", action: { kind: "remind" }, ...j }));
  }
  for (const name of WRANGLER) {
    if (existsSync(join(dir, name))) { jobs.push(...wranglerCrons(name, readFileSync(join(dir, name), "utf8")).map(fromCron)); break; }
  }
  return { app: AppName(app), jobs };
}

/** Sends one app's list and says what changed. */
export async function push(base: string, dir: string, token?: string): Promise<{ app: string; reply: SyncReply }> {
  const { app, jobs } = declared(dir);
  const res = await fetch(`${base.replace(/\/+$/, "")}/api/apps/${encodeURIComponent(app)}/jobs`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jobs } satisfies AppJobs),
  });
  const body = parseJson(await res.text());
  if (!res.ok) throw new Error(`${app}: ${res.status} ${Refusal(body).error}`);
  return { app, reply: SyncReply(body) };
}

if (import.meta.main) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error("usage: bun apps/cron-swanson/src/sync.ts <app folder> [...]"); process.exit(2); }
  const base = process.env.CRON_SWANSON_URL ?? "http://localhost:8790";
  for (const dir of dirs) {
    const { app, reply: r } = await push(base, dir, process.env.CRON_SWANSON_TOKEN || undefined);
    const list = (word: string, names: string[]) => (names.length ? ` ${word} ${names.join(", ")};` : "");
    console.log(`${app}:${list("added", r.added)}${list("changed", r.changed)}${list("removed", r.removed)} ${r.same} the same`);
  }
}
