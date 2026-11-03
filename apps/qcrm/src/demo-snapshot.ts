// The demo's dataset: 10,000 contacts with their companies, deals and activities, built once
// from seedRows and kept gzipped in R2 (the DEMO bucket), so making a demo org copies nothing
// into D1. Each isolate reads the object once and keeps it in memory.
//
// A demo org reads these rows with its own D1 rows on top. A row the visitor edits or deletes is
// copied into D1 first (`materialize`), and from then on D1's copy wins, so a visit writes only
// the rows it touches. Ids are a counter (demo-contacts-17), so every build of the snapshot
// agrees and a visitor's copied row always covers its original.
//
// Times are stored as built and moved forward a whole day at a time on load: the data never looks
// old, and a day's pages stay put.

import { arr, check, num, obj, raw, rec } from "@rustybuns/util/guard";
import type { Env, Row } from "./env.ts";
import { seedRows } from "./seed-data.ts";

export const DEMO_CONTACTS = 10_000;
const KEY = `demo/${DEMO_CONTACTS}-v1.json.gz`;
const SEED = 2026;
const DAY = 86_400_000;
const TIMES = ["created_at", "updated_at", "at", "close_at"];
export const TABLES = ["companies", "contacts", "deals", "activities"] as const;
export type Table = (typeof TABLES)[number];
export const isTable = (t: string): t is Table => (TABLES as readonly string[]).includes(t);
/** Columns seedRows leaves out, as D1 would hand them back. */
const BLANK: Record<Table, Row> = { companies: { deleted_at: null }, contacts: { owner_user_id: null, deleted_at: null }, deals: { deleted_at: null }, activities: { actor_user_id: null, deleted_at: null } };

const Rows = arr(rec(raw), Infinity);
const Snapshot = obj({ built_at: num(0, Infinity), companies: Rows, contacts: Rows, deals: Rows, activities: Rows });
export type Snapshot = { built_at: number } & Record<Table, Row[]>;

export function buildSnapshot(n = DEMO_CONTACTS): Snapshot {
  const next: Record<Table, number> = { companies: 0, contacts: 0, deals: 0, activities: 0 };
  const snap: Snapshot = { built_at: Date.now(), companies: [], contacts: [], deals: [], activities: [] };
  for (const b of seedRows(n, SEED, 500, (t) => `demo-${t}-${next[t]++}`)) for (const t of TABLES) for (const r of b[t]) snap[t].push(r);
  return snap;
}

const gzip = (s: string) => new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
const gunzip = (b: ArrayBuffer) => new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();

/** The stored snapshot, or a new one built and stored when the bucket has none (or no bucket: the desktop, the tests). */
async function fetchSnapshot(env: Env): Promise<Snapshot> {
  const got = await env.DEMO?.get(KEY);
  if (got) {
    try { const s = check(Snapshot, JSON.parse(await gunzip(await got.arrayBuffer()))); if (s) return s; } catch { /* a bad object is rebuilt below */ }
  }
  const snap = buildSnapshot();
  await env.DEMO?.put(KEY, await gzip(JSON.stringify(snap)), { httpMetadata: { contentType: "application/gzip" } });
  return snap;
}

/** The snapshot as one day sees it: each table newest first (the order lists page in), and by id. */
export interface View { rows: Record<Table, Row[]>; byId: Record<Table, Map<string, Row>> }

let stored: Promise<Snapshot> | null = null;
let shown: { day: number; view: View } | null = null;

export async function demoView(env: Env): Promise<View> {
  const snap = await (stored ??= fetchSnapshot(env).catch((e) => { stored = null; throw e; }));
  const day = Math.floor((Date.now() - snap.built_at) / DAY);
  if (shown?.day === day) return shown.view;
  const shift = day * DAY;
  const rows = {} as View["rows"], byId = {} as View["byId"];
  for (const t of TABLES) {
    rows[t] = snap[t].map((r) => {
      const o: Row = { ...r, ...BLANK[t] };
      for (const c of TIMES) if (typeof o[c] === "number") o[c] = (o[c] as number) + shift;
      return o;
    }).sort(newestFirst);
    byId[t] = new Map(rows[t].map((r) => [String(r.id), r]));
  }
  shown = { day, view: { rows, byId } };
  return shown.view;
}

/** Lists' order: updated_at, then id, both descending. */
export const newestFirst = (a: Row, b: Row) => Number(b.updated_at) - Number(a.updated_at) || (String(b.id) < String(a.id) ? -1 : String(b.id) > String(a.id) ? 1 : 0);

/** Loads the snapshot (building and storing it if the bucket has none). The hourly cron calls it so a first visitor never waits on a build. */
export const warmDemo = (env: Env) => demoView(env).then(() => {});

const plans = new Map<string, boolean>();
/** Whether `org` reads the snapshot: plan 'demo'. A plan never changes, so each isolate asks once per org. */
export async function isDemo(env: Env, org: string): Promise<boolean> {
  let d = plans.get(org);
  if (d === undefined) {
    d = (await env.DB.prepare("SELECT plan FROM orgs WHERE id = ?").bind(org).first<{ plan: string }>())?.plan === "demo";
    plans.set(org, d);
  }
  return d;
}

/** One snapshot row as `org`'s, or null. */
export async function snapshotRow(env: Env, org: string, table: string, id: string): Promise<Row | null> {
  if (!isTable(table) || !(await isDemo(env, org))) return null;
  const r = (await demoView(env)).byId[table].get(id);
  return r ? { ...r, org_id: org } : null;
}

/** Every live row of a demo org's table: the snapshot, with the org's own D1 rows (edited, added, deleted) on top. */
export async function demoRows(env: Env, org: string, table: Table): Promise<Row[]> {
  const [view, { results: own }] = await Promise.all([demoView(env), env.DB.prepare(`SELECT * FROM ${table} WHERE org_id = ?`).bind(org).all()]);
  if (!own.length) return view.rows[table];
  const mine = new Set(own.map((r) => String(r.id)));
  return [...view.rows[table].filter((r) => !mine.has(String(r.id))), ...own.filter((r) => r.deleted_at == null)].sort(newestFirst);
}

/** Before a demo org changes a snapshot row, the row is copied into D1 as the org's; after that D1's copy is the row. */
export async function materialize(env: Env, org: string, table: string, id: string): Promise<void> {
  const r = await snapshotRow(env, org, table, id);
  if (!r) return;
  const cols = Object.keys(r);
  await env.DB.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => r[c] ?? null)).run();
}
