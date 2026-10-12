// Moves codeSplitter's live resources off their codesplitters names (#809). The config
// names them codesplitter-*, and a deploy renames each by replacing it: Alchemy makes the
// new one (adopting it, when it's there already) and deletes the old one with its data.
// So this copies the data first, into resources under the new names, for the deploy to adopt.
// It deletes nothing, and without --copy it only reads.
//
//   cd apps/codesplitter
//   CLOUDFLARE_ACCOUNT_ID=… bun scripts/move-resources.ts           what's there, what it would do
//   CLOUDFLARE_ACCOUNT_ID=… bun scripts/move-resources.ts --copy    do it, then deploy right away
//
// The token is wrangler's (`wrangler auth token`), or CLOUDFLARE_API_TOKEN when set.
//
//   Alchemy state  .alchemy/state/codesplitters moves to .alchemy/state/codesplitter, the app's
//                  new name, so the deploy finds the stack it made
//   D1             codesplitters-db is exported (the .sql stays in .rustybuns/moved as a backup)
//                  and loaded into a new codesplitter-db in the same region; row counts compared.
//                  A codesplitter-db left by an earlier run that stopped before deploying is
//                  stale, so it's deleted and copied again, but only while the live Worker is
//                  seen reading codesplitters-db; once it reads codesplitter-db there's no copying
//
// The release does all of this in order: zsh ~/release-codesplitters.sh --move (scripts/release.ts).
//   R2             each object of codesplitters-level-chunks copied into codesplitter-level-chunks
//                  (none so far, so usually nothing)
//   Queues         not copied: the deploy makes codesplitter-* and the old ones go with what they
//                  still hold, so their backlog should be 0 first (dashboard, Queues)
//   Vectorize      refused if codesplitters-vectors exists: a new index starts empty, and nothing
//                  re-embeds what the repos think they already sent
//
// D1 writes made after the export aren't in the copy, so deploy straight after --copy:
//   CODESPLITTER_DEPLOYS=1 CODESPLITTER_AGENTS=1 CODESPLITTER_CHECKS=1 bunx rustybuns plan
// It should list the database, queues and bucket as renamed (a warning), and create or
// delete nothing else. Then the same flags with `bunx rustybuns deploy --allow-delete`.

import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const OLD = "codesplitters", NEW = "codesplitter";
const DB = { from: `${OLD}-db`, to: `${NEW}-db` };
const BUCKET = { from: `${OLD}-level-chunks`, to: `${NEW}-level-chunks` };
const QUEUES = ["hooks", "jobs", "level-digs"];
const INDEX = `${OLD}-vectors`;

// ---- Decisions, kept pure so test/move-resources.test.ts can check them against the real formats ----

/**
 * The token out of `wrangler auth token --json`. Wrangler 4.149 (src/user/commands.ts, authTokenCommand)
 * prints `JSON.stringify({ type: "oauth", token }, null, 2)` with no banner when --json is passed;
 * without it the banner comes first, so a plain last line is the fallback.
 */
export function parseAuthToken(out: string): string | null {
  const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  try {
    const t = JSON.parse(json)?.token;
    if (typeof t === "string" && t.length >= 20) return t;
  } catch { /* not JSON: an older wrangler */ }
  const last = out.trim().split("\n").at(-1)?.trim() ?? "";
  return /^\S{20,}$/.test(last) ? last : null;
}

/**
 * A Cloudflare v4 error that means "not there". The codes are the ones @distilled.cloud/cloudflare
 * 1.0.0-rc.9 matches its NotFound errors on: D1 DatabaseNotFound 7404, R2 NoSuchBucket 10006,
 * WorkerNotFound (and R2 NoSuchKey) 10007, Vectorize NotFound 3000 and Gone 3005 ("index deleted").
 */
export const MISSING_CODES = [7404, 10006, 10007, 3000, 3005];
export function isMissing(status: number, errors: { code?: number; message?: string }[] | undefined): boolean {
  if (status === 404 || status === 410) return true;
  return (errors ?? []).some((e) => MISSING_CODES.includes(e.code as number) || /not.?found|does not exist|index deleted/i.test(e.message ?? ""));
}

/**
 * The D1 database a Worker's `DB` binding reads, from GET /workers/scripts/{name}/settings. The API
 * gives a d1 binding as `{ type: "d1", name, database_id, id? }`: `database_id` is required and `id`
 * optional (ScriptsScriptAndVersionSettingsGetResponseBindingsItemD1 in @distilled.cloud/cloudflare).
 */
export function liveDatabaseId(bindings: unknown, binding = "DB"): string | null {
  const b = (Array.isArray(bindings) ? bindings : []).find((b: any) => b?.type === "d1" && b?.name === binding) as any;
  return b?.database_id ?? b?.id ?? null;
}

/** D1's location hints (wrangler's LOCATION_CHOICES): anything else in running_in_region is left out of the create. */
export const LOCATIONS = ["weur", "eeur", "apac", "oc", "wnam", "enam"];
export const locationHint = (region: unknown): string | undefined =>
  typeof region === "string" && LOCATIONS.includes(region.toLowerCase()) ? region.toLowerCase() : undefined;

/**
 * The cursor for the next page of R2's list objects, or null at the end. Its `result_info` has
 * `cursor` (the field distilled's listBucketObjects follows) and `is_truncated`; a page that names
 * no cursor, says it isn't truncated, or hands back the cursor it was given is the last.
 */
export function nextCursor(info: { cursor?: string | null; is_truncated?: boolean | null } | null | undefined, was: string): string | null {
  const c = info?.cursor ?? "";
  if (!c || info?.is_truncated === false || c === was) return null;
  return c;
}

/** The tables to copy and count. LIKE's `_` matches any character, so it's escaped: only D1's own `_cf_*` and SQLite's `sqlite_*` are left out. */
export const TABLES_SQL = "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name";
/** Indexes, triggers and views, which a dump writes after the data, so a copy could lose them without a row count changing. */
export const SCHEMA_SQL = "SELECT type, name FROM sqlite_master WHERE type IN ('index', 'trigger', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY type, name";

/** Virtual tables (FTS5 and the like): `wrangler d1 export` can't export a database that has one. */
export const virtualTables = (tables: { name: string; sql: string | null }[]) =>
  tables.filter((t) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql ?? "")).map((t) => t.name);

/** Where two databases differ: tables whose row counts don't match, and indexes, triggers or views only one has. */
export function differences(a: Map<string, number>, b: Map<string, number>, schemaA: string[] = [], schemaB: string[] = []): string[] {
  const off = [...new Set([...a.keys(), ...b.keys()])].filter((t) => a.get(t) !== b.get(t)).map((t) => `${t} (${a.get(t) ?? "missing"} vs ${b.get(t) ?? "missing"})`);
  const [sa, sb] = [new Set(schemaA), new Set(schemaB)];
  for (const s of sa) if (!sb.has(s)) off.push(`${s} (missing from the copy)`);
  for (const s of sb) if (!sa.has(s)) off.push(`${s} (only in the copy)`);
  return off;
}

/** What to do with the Alchemy state: `.alchemy/state/<app>/<stage>/*.json` (packages/cli/src/state.ts). */
export function stateStep(fromExists: boolean, toHasEntries: boolean): "moved" | "move" | "both" | "none" {
  if (fromExists && toHasEntries) return "both";
  if (toHasEntries) return "moved";
  return fromExists ? "move" : "none";
}

// ---- The run ----

async function main() {
  const app = join(import.meta.dir, "..");
  const copy = process.argv.includes("--copy");
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) throw new Error("set CLOUDFLARE_ACCOUNT_ID (the codeSplitter account's id)");
  // Wrangler's own OAuth token. CLOUDFLARE_API_TOKEN is left out of its env: with it set, `auth token`
  // just echoes it back, and release.ts sets it to an OAuth token that may have expired since.
  const wranglerToken = () => {
    const { CLOUDFLARE_API_TOKEN: _t, CLOUDFLARE_API_KEY: _k, CLOUDFLARE_EMAIL: _e, ...env } = process.env;
    const r = Bun.spawnSync(["bunx", "wrangler", "auth", "token", "--json"], { cwd: app, env, stderr: "ignore" });
    return r.exitCode === 0 ? parseAuthToken(r.stdout.toString()) : null;
  };
  let token = process.env.CLOUDFLARE_API_TOKEN || wranglerToken();
  if (!token) throw new Error("no Cloudflare token: run `bunx wrangler login`, or set CLOUDFLARE_API_TOKEN");
  const BASE = `https://api.cloudflare.com/client/v4/accounts/${account}`;

  /** Wrangler's OAuth token lasts about an hour, and a release can sit at a question longer: on a 401, get a fresh one. */
  async function authed(path: string, init: RequestInit = {}) {
    const go = () => fetch(BASE + path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(120_000) });
    const res = await go();
    if (res.status !== 401) return res;
    const fresh = wranglerToken();
    if (!fresh || fresh === token) return res;
    token = fresh;
    return go();
  }

  /** The call's whole body: `result`, and `result_info` for a page of a list. */
  async function call(path: string, init: RequestInit = {}, okMissing = false): Promise<any> {
    const res = await authed(path, { ...init, headers: { "content-type": "application/json", ...init.headers } });
    const body = await res.json().catch(() => ({ success: false, errors: [{ message: `HTTP ${res.status}` }] })) as any;
    if (!res.ok || !body.success) {
      if (okMissing && isMissing(res.status, body.errors)) return null;
      throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${JSON.stringify(body.errors)}`);
    }
    return body;
  }
  const api = async (path: string, init: RequestInit = {}, okMissing = false) => (await call(path, init, okMissing))?.result ?? null;

  /** Wrangler, with the same account and token. It looks a database up by name when its config lacks it. */
  function wrangler(...args: string[]) {
    const r = Bun.spawnSync(["bunx", "wrangler", ...args], {
      cwd: app, stdout: "inherit", stderr: "inherit",
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token!, NO_COLOR: "1" },
    });
    if (r.exitCode !== 0) throw new Error(`wrangler ${args.join(" ")} failed`);
  }

  const say = (s: string) => console.log(s);
  const todo = (s: string) => say(`  ${copy ? "→" : "would"} ${s}`);
  const problems: string[] = [];

  // Checked before anything is copied: the deploy needs the stack Alchemy made.
  const state = join(app, ".alchemy", "state");
  const stateFrom = join(state, OLD), stateTo = join(state, NEW);
  const step = stateStep(existsSync(stateFrom), existsSync(stateTo) && readdirSync(stateTo).length > 0);
  if (step === "none") problems.push(`no Alchemy state under ${stateFrom}: run this from the checkout you deploy from (#806)`);
  if (step === "both") problems.push(`Alchemy state under both ${stateFrom} and ${stateTo}: keep the one the live stack is in`);

  // ---- Vectorize ----
  say("Vectorize");
  if (await api(`/vectorize/v2/indexes/${INDEX}`, {}, true)) problems.push(`${INDEX} exists, and nothing moves its vectors or re-embeds into a new index: hold the move, or turn CODESPLITTER_VECTORS off and delete it`);
  else say(`  no ${INDEX}: nothing to move`);

  // ---- D1 ----
  say("D1");
  const dbByName = async (name: string) => ((await api(`/d1/database?name=${encodeURIComponent(name)}`)) as any[] ?? []).find((d) => d.name === name) ?? null;
  const query = async (id: string, sql: string) => ((await api(`/d1/database/${id}/query`, { method: "POST", body: JSON.stringify({ sql }) })) as any[])[0].results as any[];
  const tables = async (id: string) => (await query(id, TABLES_SQL)) as { name: string; sql: string }[];
  const schema = async (id: string) => ((await query(id, SCHEMA_SQL)) as { type: string; name: string }[]).map((r) => `${r.type} ${r.name}`);
  async function counts(id: string) {
    const out = new Map<string, number>();
    for (const t of await tables(id)) out.set(t.name, (await query(id, `SELECT COUNT(*) AS n FROM "${t.name.replace(/"/g, '""')}"`))[0].n);
    return out;
  }
  const dbFrom = await dbByName(DB.from);
  let dbTo = await dbByName(DB.to);
  // The database the live Worker reads. A copy it doesn't read yet is a snapshot from an earlier
  // run that stopped before deploying, so it's stale: --copy deletes it and copies again.
  const liveDb = liveDatabaseId((await api(`/workers/scripts/${NEW}/settings`, {}, true))?.bindings);
  if (!dbFrom) say(`  no ${DB.from}${dbTo ? `; ${DB.to} is there` : ""}: nothing to copy`);
  else if (dbTo && liveDb === dbTo.uuid) say(`  the live Worker already reads ${DB.to}: nothing to copy`);
  else if (liveDb !== dbFrom.uuid) problems.push(`the live Worker ${NEW} reads ${liveDb ? `database ${liveDb}` : "no database it could find"}, neither ${DB.from} nor ${DB.to}`);
  else {
    const fromTables = await tables(dbFrom.uuid);
    const virtual = virtualTables(fromTables);
    if (virtual.length) problems.push(`${DB.from} has virtual tables (${virtual.join(", ")}), which D1 can't export`);
    let toTables = dbTo ? await tables(dbTo.uuid) : [];
    if (toTables.length) {
      todo(`delete ${DB.to}: a copy from an earlier run that the live Worker doesn't read (it reads ${DB.from}), so it's stale; then copy again`);
      if (copy && !problems.length) { await api(`/d1/database/${dbTo!.uuid}`, { method: "DELETE" }); dbTo = null; toTables = []; }
    }
    if ((!toTables.length || !copy) && !problems.length) {
      const region = (await api(`/d1/database/${dbFrom.uuid}`)).running_in_region;
      const hint = locationHint(region);
      const file = join(app, ".rustybuns", "moved", `${DB.from}-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
      todo(`export ${DB.from} (${fromTables.length} tables) to ${file}; ${DB.from} doesn't answer queries while it exports`);
      todo(`${dbTo && !toTables.length ? "load it into the empty" : `create ${DB.to}${hint ? ` in ${hint}` : ` (region ${region ?? "not given"}: D1 picks)`} and load it into`} ${DB.to}`);
      if (copy) {
        mkdirSync(join(app, ".rustybuns", "moved"), { recursive: true });
        // --skip-confirmation: wrangler asks before a remote export when it has a terminal.
        wrangler("d1", "export", DB.from, "--remote", "--skip-confirmation", "--output", file);
        dbTo ??= await api("/d1/database", { method: "POST", body: JSON.stringify({ name: DB.to, ...(hint ? { primary_location_hint: hint } : {}) }) });
        wrangler("d1", "execute", DB.to, "--remote", "--yes", "--file", file);
        say(`  copied at ${new Date().toISOString()}: writes to ${DB.from} after the export aren't in it, so deploy now`);
      }
    }
    // Only a copy just made is compared: a stale one differs by whatever the site wrote since.
    if (dbTo && copy && !problems.length) {
      const [a, b] = [await counts(dbFrom.uuid), await counts(dbTo.uuid)];
      const off = differences(a, b, await schema(dbFrom.uuid), await schema(dbTo.uuid));
      if (off.length) problems.push(`${DB.to} differs from ${DB.from} in ${off.join(", ")}`);
      else say(`  ${DB.to} matches ${DB.from}: ${a.size} tables, ${[...a.values()].reduce((x, y) => x + y, 0)} rows, the same indexes and triggers`);
    }
  }

  // ---- R2 ----
  say("R2");
  const bucket = (name: string) => api(`/r2/buckets/${name}`, {}, true);
  async function keys(name: string) {
    const out: string[] = [];
    for (let cursor = ""; ;) {
      const page = await call(`/r2/buckets/${name}/objects?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      const items = (page.result ?? []) as { key: string }[];
      out.push(...items.map((o) => o.key));
      const next = items.length ? nextCursor(page.result_info, cursor) : null;
      if (!next) return out;
      cursor = next;
    }
  }
  const objectPath = (b: string, key: string) => `/r2/buckets/${b}/objects/${key.split("/").map(encodeURIComponent).join("/")}`;
  if (!(await bucket(BUCKET.from))) say(`  no ${BUCKET.from}: nothing to copy`);
  else {
    const from = await keys(BUCKET.from);
    const there = (await bucket(BUCKET.to)) ? new Set(await keys(BUCKET.to)) : new Set<string>();
    const missing = from.filter((k) => !there.has(k));
    if (!missing.length) say(`  ${from.length ? `all ${from.length} objects already in ${BUCKET.to}` : `${BUCKET.from} is empty: the deploy makes ${BUCKET.to}`}`);
    else {
      todo(`copy ${missing.length} of ${from.length} objects into ${BUCKET.to}`);
      if (copy) {
        if (!there.size && !(await bucket(BUCKET.to))) await api("/r2/buckets", { method: "POST", body: JSON.stringify({ name: BUCKET.to }) });
        for (const key of missing) {
          const got = await authed(objectPath(BUCKET.from, key));
          if (!got.ok) throw new Error(`R2 get ${key}: ${got.status}`);
          const put = await authed(objectPath(BUCKET.to, key), { method: "PUT", body: await got.arrayBuffer(), headers: { "content-type": got.headers.get("content-type") ?? "application/octet-stream" } });
          if (!put.ok) throw new Error(`R2 put ${key}: ${put.status}`);
        }
        say(`  copied ${missing.length} objects`);
      }
    }
  }

  // ---- Queues ----
  // Looked up one by one by name, as wrangler's getQueue does: GET /queues is paged (wrangler's
  // listQueues sends ?page=), so one call could miss a queue past the first page.
  say("Queues");
  const queueThere = async (name: string) => ((await api(`/queues?name=${encodeURIComponent(name)}`)) as { queue_name: string }[] ?? []).some((q) => q.queue_name === name);
  for (const q of QUEUES) {
    const [from, to] = [`${OLD}-${q}`, `${NEW}-${q}`];
    say(`  ${from}: ${(await queueThere(from)) ? "there; check its backlog is 0 before the deploy" : "gone"}, ${to}: ${(await queueThere(to)) ? "there" : "the deploy makes it"}`);
  }

  // ---- Alchemy state (last, once the copies are in) ----
  say("Alchemy state");
  if (step === "moved") say(`  already under ${NEW}`);
  else if (step === "move") {
    todo(`move ${stateFrom} to ${stateTo}`);
    if (copy && !problems.length) renameSync(stateFrom, stateTo);
  }

  say("");
  if (problems.length) {
    for (const p of problems) console.error(`stop: ${p}`);
    process.exit(1);
  }
  say(copy ? "Copied. Plan, then deploy with --allow-delete, now." : "Nothing in the way. Run it again with --copy, then plan and deploy straight after.");
}

if (import.meta.main) await main();
