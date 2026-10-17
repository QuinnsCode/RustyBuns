// The four entities, one generic path: a whitelist of tables, a whitelist of columns per table
// with how each is checked, and the same list/get/create/update/delete for all. Every query
// carries `org_id = ?`; every write appends to `changes` (the sync log) and emits a webhook.
//
//   GET    /api/orgs/:org/<entity>?q=&cursor=&limit=&company_id=&stage=…
//   POST   /api/orgs/:org/<entity> {…}
//   GET    /api/orgs/:org/<entity>/:id
//   PUT    /api/orgs/:org/<entity>/:id {…}      only the fields sent change
//   DELETE /api/orgs/:org/<entity>/:id          soft: deleted_at is set, the row stays for sync
//
// Lists are keyset-paginated on (updated_at, id) descending: `next` is the cursor for the page after.

import { b64url, error, json, parseJson, readBody, type Env, type Row } from "./env.ts";
import type { Ctx } from "./orgs.ts";
import { can, type Action } from "./rbac.ts";
import { emit, type Event } from "./webhooks.ts";

type Field = { kind: "str" | "email" | "int" | "enum" | "tags" | "ts"; values?: readonly string[]; required?: boolean };
const str = (required = false): Field => ({ kind: "str", required });
const int: Field = { kind: "int" }, ts: Field = { kind: "ts" };
export const STAGES = ["lead", "qualified", "proposal", "won", "lost"] as const;
export const ACTIVITY_TYPES = ["call", "email", "meeting", "note"] as const;

interface Spec { event: "contact" | "company" | "deal" | "activity"; fields: Record<string, Field>; search: string[]; filters: string[] }
export const ENTITIES: Record<string, Spec> = {
  contacts: {
    event: "contact", search: ["first_name", "last_name", "email"], filters: ["company_id", "owner_user_id"],
    fields: { first_name: str(), last_name: str(), email: { kind: "email" }, phone: str(), title: str(), company_id: str(), owner_user_id: str(), tags: { kind: "tags" }, notes: str() },
  },
  companies: { event: "company", search: ["name", "domain"], filters: ["industry"], fields: { name: str(true), domain: str(), industry: str(), size: str() } },
  deals: {
    event: "deal", search: ["name"], filters: ["company_id", "contact_id", "stage"],
    fields: { name: str(true), contact_id: str(), company_id: str(), stage: { kind: "enum", values: STAGES }, amount_cents: int, currency: str(), close_at: ts },
  },
  activities: {
    event: "activity", search: ["body"], filters: ["contact_id", "deal_id", "type"],
    fields: { type: { kind: "enum", values: ACTIVITY_TYPES, required: true }, contact_id: str(), deal_id: str(), body: str(), at: ts, actor_user_id: str() },
  },
};
export type Entity = keyof typeof ENTITIES;
export const isEntity = (e: unknown): e is Entity => typeof e === "string" && Object.hasOwn(ENTITIES, e);
const MAX_STR = 2000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `data` cut to the entity's columns and checked; `partial` for an update. A string says what is wrong. */
export function validate(entity: Entity, data: Record<string, unknown>, partial: boolean): Row | string {
  const out: Row = {};
  for (const [col, f] of Object.entries(ENTITIES[entity]!.fields)) {
    const v = data[col];
    if (v === undefined) { if (f.required && !partial) return `${col} is required`; continue; }
    if (v === null) { if (f.required) return `${col} is required`; out[col] = f.kind === "tags" ? "[]" : null; continue; }
    switch (f.kind) {
      case "str": if (typeof v !== "string" || v.length > MAX_STR) return `${col}: a string of at most ${MAX_STR} characters`; if (f.required && !v.trim()) return `${col} is required`; out[col] = v; break;
      case "email": if (typeof v !== "string" || v.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return `${col}: an email address`; out[col] = v.toLowerCase(); break;
      case "int": if (!Number.isInteger(v) || (v as number) < 0) return `${col}: a whole number, 0 or more`; out[col] = v; break;
      case "ts": if (!Number.isInteger(v)) return `${col}: a time in ms since the epoch`; out[col] = v; break;
      case "enum": if (!f.values!.includes(v as string)) return `${col}: one of ${f.values!.join(", ")}`; out[col] = v; break;
      case "tags": if (!Array.isArray(v) || v.length > 50 || v.some((t) => typeof t !== "string" || t.length > 100)) return `${col}: a list of short strings`; out[col] = JSON.stringify(v); break;
    }
  }
  return out;
}

/** A stored row as the API shows it. */
export const shape = (entity: Entity, r: Row) => ("tags" in ENTITIES[entity]!.fields ? { ...r, tags: parseJson(r.tags, []) } : r);

export const getRow = (env: Env, org: string, entity: Entity, id: string, includeDeleted = false) =>
  env.DB.prepare(`SELECT * FROM ${entity} WHERE org_id = ? AND id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`).bind(org, id).first();

const cursorOf = (r: Row) => b64url(new TextEncoder().encode(JSON.stringify([r.updated_at, r.id])));
const parseCursor = (c: string | null): [number, string] | null => {
  if (!c) return null;
  try { const v = JSON.parse(atob(c.replace(/-/g, "+").replace(/_/g, "/"))); return Number.isInteger(v[0]) && typeof v[1] === "string" ? [v[0], v[1]] : null; } catch { return null; }
};

export async function listRows(env: Env, org: string, entity: Entity, q: URLSearchParams) {
  const spec = ENTITIES[entity]!;
  const where = ["org_id = ?", "deleted_at IS NULL"], args: unknown[] = [org];
  const text = q.get("q")?.trim().toLowerCase();
  if (text) {
    // Prefix match, case-insensitive; a user's % or _ is a character, not a wildcard.
    const like = text.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    const cols = [...spec.search, ...(entity === "contacts" ? ["first_name || ' ' || last_name"] : [])];
    where.push(`(${cols.map((c) => `lower(${c}) LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    args.push(...cols.map(() => like));
  }
  for (const f of spec.filters) { const v = q.get(f); if (v !== null) { where.push(`${f} = ?`); args.push(v); } }
  const cur = parseCursor(q.get("cursor"));
  if (cur) { where.push("(updated_at < ? OR (updated_at = ? AND id < ?))"); args.push(cur[0], cur[0], cur[1]); }
  const limit = Math.min(200, Math.max(1, Number(q.get("limit")) || 50));
  const { results } = await env.DB.prepare(`SELECT * FROM ${entity} WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`).bind(...args, limit + 1).all();
  const page = results.slice(0, limit);
  return { items: page.map((r) => shape(entity, r)), next: results.length > limit ? cursorOf(page[limit - 1]!) : null };
}

/** The change log entry and the webhook for one write. */
export async function record(env: Env, org: string, entity: Entity, id: string, op: "upsert" | "delete", data: Row, actor: string | null, at = Date.now()) {
  await env.DB.prepare("INSERT INTO changes (org_id, entity, entity_id, op, actor_user_id, at, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(org, entity, id, op, actor, at, JSON.stringify(data)).run();
}

type WriteOpts = { id?: string; updated_at?: number };

export async function createRow(env: Env, org: string, entity: Entity, data: Record<string, unknown>, actor: string | null, opts: WriteOpts = {}) {
  const v = validate(entity, data, false);
  if (typeof v === "string") return v;
  if (opts.id !== undefined && !ID.test(opts.id)) return "id: up to 64 letters, digits, - or _";
  const now = Date.now();
  if (entity === "activities") { v.at ??= now; v.actor_user_id ??= actor; }
  const row: Row = { ...v, id: opts.id ?? crypto.randomUUID(), org_id: org, created_at: now, updated_at: opts.updated_at ?? now, deleted_at: null };
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT INTO ${entity} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => row[c])).run();
  const out = shape(entity, row);
  await record(env, org, entity, row.id as string, "upsert", out, actor);
  await emit(env, org, `${ENTITIES[entity]!.event}.created` as Event, out);
  return out;
}

export async function updateRow(env: Env, org: string, entity: Entity, id: string, data: Record<string, unknown>, actor: string | null, opts: WriteOpts = {}) {
  const v = validate(entity, data, true);
  if (typeof v === "string") return v;
  const before = await getRow(env, org, entity, id);
  if (!before) return null;
  const row: Row = { ...before, ...v, updated_at: opts.updated_at ?? Date.now() };
  const cols = Object.keys(row).filter((c) => c !== "id" && c !== "org_id");
  await env.DB.prepare(`UPDATE ${entity} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE org_id = ? AND id = ?`).bind(...cols.map((c) => row[c]), org, id).run();
  const out = shape(entity, row);
  await record(env, org, entity, id, "upsert", out, actor);
  await emit(env, org, `${ENTITIES[entity]!.event}.updated` as Event, out);
  return out;
}

export async function deleteRow(env: Env, org: string, entity: Entity, id: string, actor: string | null) {
  const now = Date.now();
  const r = await env.DB.prepare(`UPDATE ${entity} SET deleted_at = ?, updated_at = ? WHERE org_id = ? AND id = ? AND deleted_at IS NULL`).bind(now, now, org, id).run();
  if (!r.meta.changes) return null;
  await record(env, org, entity, id, "delete", { id, deleted_at: now, updated_at: now }, actor, now);
  await emit(env, org, `${ENTITIES[entity]!.event}.deleted` as Event, { id, deleted_at: now });
  return { id, deleted_at: now };
}

export const createAction = (entity: Entity): Action => `create:${ENTITIES[entity]!.event}` as Action;

export async function crmRoutes({ req, env, url, user, org, role, p }: Ctx): Promise<Response | null> {
  const entity = p[0];
  if (!isEntity(entity) || p[2]) return null;
  const id = p[1];
  if (!id && req.method === "GET") return json(await listRows(env, org, entity, url.searchParams));
  if (!id && req.method === "POST") {
    if (!can(role, createAction(entity))) return error(403, `a ${role} can't add ${entity}`);
    const b = await readBody(req);
    if (!b) return error(400, "send a JSON object");
    const r = await createRow(env, org, entity, b, user.id);
    return typeof r === "string" ? error(400, r) : json(r, 201);
  }
  if (!id) return null;
  if (req.method === "GET") { const r = await getRow(env, org, entity, id); return r ? json(shape(entity, r)) : error(404, "not found"); }
  if (req.method === "PUT") {
    if (!can(role, "update")) return error(403, `a ${role} can't edit ${entity}`);
    const b = await readBody(req);
    if (!b) return error(400, "send a JSON object");
    const r = await updateRow(env, org, entity, id, b, user.id);
    return typeof r === "string" ? error(400, r) : r ? json(r) : error(404, "not found");
  }
  if (req.method === "DELETE") {
    if (!can(role, "delete")) return error(403, `a ${role} can't delete ${entity}`);
    const r = await deleteRow(env, org, entity, id, user.id);
    return r ? json(r) : error(404, "not found");
  }
  return null;
}
