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
//                  and loaded into a new codesplitter-db in the same region; row counts compared
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

const app = join(import.meta.dir, "..");
const copy = process.argv.includes("--copy");
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) throw new Error("set CLOUDFLARE_ACCOUNT_ID (the codeSplitter account's id)");
const wranglerToken = () => Bun.spawnSync(["bunx", "wrangler", "auth", "token"], { cwd: app, stderr: "ignore" }).stdout.toString().trim().split("\n").at(-1);
let token = process.env.CLOUDFLARE_API_TOKEN || wranglerToken();
if (!token) throw new Error("no Cloudflare token: run `bunx wrangler login`, or set CLOUDFLARE_API_TOKEN");
const BASE = `https://api.cloudflare.com/client/v4/accounts/${account}`;

/** Wrangler's OAuth token lasts about an hour; a long copy outlives it. */
async function authed(path: string, init: RequestInit = {}) {
  const go = () => fetch(BASE + path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
  const res = await go();
  if (res.status !== 401 || process.env.CLOUDFLARE_API_TOKEN) return res;
  token = wranglerToken() ?? token;
  return go();
}

/** The call's whole body: `result`, and `result_info` for a page of a list. */
async function call(path: string, init: RequestInit = {}, ok404 = false): Promise<any> {
  const res = await authed(path, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  if (ok404 && res.status === 404) return null;
  const body = await res.json().catch(() => ({ success: false, errors: [{ message: `HTTP ${res.status}` }] })) as any;
  if (!body.success) {
    if (ok404 && body.errors?.some((e: any) => /not found|does not exist/i.test(e.message))) return null;
    throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${JSON.stringify(body.errors)}`);
  }
  return body;
}
const api = async (path: string, init: RequestInit = {}, ok404 = false) => (await call(path, init, ok404))?.result ?? null;

/** Wrangler, with the same account and token. It looks a database up by name when its config lacks it. */
function wrangler(...args: string[]) {
  const r = Bun.spawnSync(["bunx", "wrangler", ...args], {
    cwd: app, stdout: "inherit", stderr: "inherit",
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token },
  });
  if (r.exitCode !== 0) throw new Error(`wrangler ${args.join(" ")} failed`);
}

const say = (s: string) => console.log(s);
const todo = (s: string) => say(`  ${copy ? "→" : "would"} ${s}`);
const problems: string[] = [];

// Checked before anything is copied: the deploy needs the stack Alchemy made.
const state = join(app, ".alchemy", "state");
const stateFrom = join(state, OLD), stateTo = join(state, NEW);
const stateMoved = existsSync(stateTo) && readdirSync(stateTo).length > 0;
if (!stateMoved && !existsSync(stateFrom)) problems.push(`no Alchemy state under ${stateFrom}: run this from the checkout you deploy from (#806)`);

// ---- Vectorize ----
say("Vectorize");
if (await api(`/vectorize/v2/indexes/${INDEX}`, {}, true)) problems.push(`${INDEX} exists, and nothing moves its vectors or re-embeds into a new index: hold the move, or turn CODESPLITTER_VECTORS off and delete it`);
else say(`  no ${INDEX}: nothing to move`);

// ---- D1 ----
say("D1");
const dbByName = async (name: string) => ((await api(`/d1/database?name=${encodeURIComponent(name)}`)) as any[]).find((d) => d.name === name) ?? null;
const query = async (id: string, sql: string) => ((await api(`/d1/database/${id}/query`, { method: "POST", body: JSON.stringify({ sql }) })) as any[])[0].results as any[];
const tables = async (id: string) => (await query(id, "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name")) as { name: string; sql: string }[];
async function counts(id: string) {
  const out = new Map<string, number>();
  for (const t of await tables(id)) out.set(t.name, (await query(id, `SELECT COUNT(*) AS n FROM "${t.name.replace(/"/g, '""')}"`))[0].n);
  return out;
}
const dbFrom = await dbByName(DB.from);
let dbTo = await dbByName(DB.to);
if (!dbFrom) say(`  no ${DB.from}${dbTo ? `; ${DB.to} is there` : ""}: nothing to copy`);
else {
  const fromTables = await tables(dbFrom.uuid);
  const virtual = fromTables.filter((t) => /^CREATE VIRTUAL/i.test(t.sql)).map((t) => t.name);
  // wrangler d1 export refuses a database with virtual tables.
  if (virtual.length) problems.push(`${DB.from} has virtual tables (${virtual.join(", ")}), which D1 can't export`);
  const toTables = dbTo ? await tables(dbTo.uuid) : [];
  if (toTables.length) say(`  ${DB.to} already has ${toTables.length} tables: comparing, not copying`);
  else if (!problems.length) {
    const region = (await api(`/d1/database/${dbFrom.uuid}`)).running_in_region as string | undefined;
    const file = join(app, ".rustybuns", "moved", `${DB.from}-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
    todo(`export ${DB.from} (${fromTables.length} tables) to ${file}`);
    todo(`${dbTo ? "load it into the empty" : `create ${DB.to}${region ? ` in ${region}` : ""} and load it into`} ${DB.to}`);
    if (copy) {
      mkdirSync(join(app, ".rustybuns", "moved"), { recursive: true });
      wrangler("d1", "export", DB.from, "--remote", "--output", file);
      dbTo ??= await api("/d1/database", { method: "POST", body: JSON.stringify({ name: DB.to, ...(region ? { primary_location_hint: region.toLowerCase() } : {}) }) });
      wrangler("d1", "execute", DB.to, "--remote", "--yes", "--file", file);
      say(`  copied at ${new Date().toISOString()}: writes to ${DB.from} after the export aren't in it, so deploy now`);
    }
  }
  if (dbTo && (copy || toTables.length)) {
    const [a, b] = [await counts(dbFrom.uuid), await counts(dbTo.uuid)];
    const off = [...new Set([...a.keys(), ...b.keys()])].filter((t) => a.get(t) !== b.get(t));
    if (off.length) problems.push(`${DB.to} differs from ${DB.from} in ${off.map((t) => `${t} (${a.get(t) ?? "missing"} vs ${b.get(t) ?? "missing"})`).join(", ")}`);
    else say(`  ${DB.to} matches ${DB.from}: ${a.size} tables, ${[...a.values()].reduce((x, y) => x + y, 0)} rows`);
  }
}

// ---- R2 ----
say("R2");
const bucket = (name: string) => api(`/r2/buckets/${name}`, {}, true);
async function keys(name: string) {
  const out: string[] = [];
  for (let cursor = ""; ;) {
    const page = await call(`/r2/buckets/${name}/objects?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...(page.result as { key: string }[]).map((o) => o.key));
    cursor = page.result_info?.cursor ?? "";
    if (!page.result_info?.is_truncated || !cursor) return out;
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
say("Queues");
const queues = new Set(((await api("/queues")) as { queue_name: string }[]).map((q) => q.queue_name));
for (const q of QUEUES) {
  const [from, to] = [`${OLD}-${q}`, `${NEW}-${q}`];
  say(`  ${from}: ${queues.has(from) ? "there; check its backlog is 0 before the deploy" : "gone"}, ${to}: ${queues.has(to) ? "there" : "the deploy makes it"}`);
}

// ---- Alchemy state (last, once the copies are in) ----
say("Alchemy state");
if (stateMoved) say(`  already under ${NEW}`);
else if (existsSync(stateFrom)) {
  todo(`move ${stateFrom} to ${stateTo}`);
  if (copy && !problems.length) renameSync(stateFrom, stateTo);
}

say("");
if (problems.length) {
  for (const p of problems) console.error(`stop: ${p}`);
  process.exit(1);
}
say(copy ? "Copied. Plan, then deploy with --allow-delete, now." : "Nothing in the way. Run it again with --copy, then plan and deploy straight after.");
