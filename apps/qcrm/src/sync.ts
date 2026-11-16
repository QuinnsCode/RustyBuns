// Sync: the `changes` table is the engine. A client keeps the last seq it saw, pulls what came
// after, and pushes its own edits with the seq it based them on.
//
//   GET  /api/orgs/:org/sync?since=<seq>&limit=   {changes, next, done}
//   POST /api/orgs/:org/sync {ops: [{entity, id, op: "upsert" | "delete", data?, baseSeq?}]}
//        → {applied, conflicts: [{id, server}]}
//
// Last write wins on updated_at. A conflict is an op whose row changed on the server after
// baseSeq: the server's copy comes back so the client can show it, and the op still lands when
// the client's updated_at is newer. Each op is checked against the caller's role like the
// matching HTTP call would be.

import { createAction, createRow, deleteRow, getRow, isEntity, shape, updateRow, type Entity } from "./crm.ts";
import { arr, Bad, check, int, isRecord, maybe, obj, oneOf, raw, said, str, type Guard } from "@rustybuns/util/guard";
import { json, need, parseJson, type Row } from "./env.ts";
import type { Ctx } from "./orgs.ts";
import { can } from "./rbac.ts";

const MAX_OPS = 500;

const EntityName: Guard<Entity> = (v) => { if (!isEntity(v)) throw new Bad("an entity"); return v; };
/** One pushed op. `data` that isn't an object is no fields; a `baseSeq` that isn't a whole number is none. */
export const SyncOp = obj({
  entity: EntityName, id: str(200), op: oneOf(["upsert", "delete"]),
  baseSeq: maybe(int(0, Number.MAX_SAFE_INTEGER)), data: (v: unknown): Row => (isRecord(v) ? v : {}),
});

/** POST /api/orgs/:org/sync: the ops, each checked on its own so one bad op is rejected, not the push. */
const SyncBody = obj({ ops: said(arr(raw, MAX_OPS, { min: 0 }), `a list of at most ${MAX_OPS}`) });

export async function syncRoutes({ req, env, url, user, org, role, p }: Ctx): Promise<Response | null> {
  if (p[0] !== "sync" || p[1]) return null;
  if (req.method === "GET") {
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 200));
    const { results } = await env.DB.prepare("SELECT seq, entity, entity_id AS id, op, actor_user_id, at, data FROM changes WHERE org_id = ? AND seq > ? ORDER BY seq LIMIT ?").bind(org, since, limit + 1).all();
    const page: Row[] = results.slice(0, limit).map((c) => ({ ...c, data: parseJson(c.data, null) }));
    return json({ changes: page, next: page.length ? page[page.length - 1]!.seq : since, done: results.length <= limit });
  }
  if (req.method !== "POST") return null;
  const b = await need(req, SyncBody);
  if (b instanceof Response) return b;
  let applied = 0;
  const conflicts: { id: string; server: Row | null; reason?: string }[] = [];
  const rejected: { id: string; error: string }[] = [];
  for (const sent of b.ops) {
    const o = check(SyncOp, sent);
    if (!o) { rejected.push({ id: String(isRecord(sent) ? sent.id : undefined), error: "entity, id and op (upsert or delete) are required" }); continue; }
    const { entity, id, op, baseSeq, data } = o;
    const server = await getRow(env, org, entity, id, true);
    const need = op === "delete" ? "delete" : server ? "update" : createAction(entity);
    if (!can(role, need)) { rejected.push({ id, error: `a ${role} can't ${need.replace(":", " ")}` }); continue; }
    if (server && baseSeq !== undefined) {
      const last = await env.DB.prepare("SELECT MAX(seq) AS seq FROM changes WHERE org_id = ? AND entity = ? AND entity_id = ?").bind(org, entity, id).first<{ seq: number | null }>();
      if ((last?.seq ?? 0) > baseSeq) {
        const shown = shape(entity, server);
        conflicts.push({ id, server: shown });
        // The server moved on and is at least as fresh: the client takes the server's copy.
        if (!(Number(data.updated_at) > Number(server.updated_at))) continue;
      }
    }
    const { updated_at, id: _id, org_id: _o, created_at: _c, deleted_at: _d, ...fields } = data;
    const stamp = Number.isInteger(updated_at) ? { updated_at: updated_at as number } : {};
    const r = op === "delete"
      ? (server?.deleted_at ? {} : await deleteRow(env, org, entity, id, user.id))
      : server
        ? (server.deleted_at ? "it was deleted; make it again with a new id" : await updateRow(env, org, entity, id, fields, user.id, stamp))
        : await createRow(env, org, entity, fields, user.id, { id, ...stamp });
    if (typeof r === "string") rejected.push({ id, error: r });
    else applied++;
  }
  return json({ applied, conflicts, rejected });
}
