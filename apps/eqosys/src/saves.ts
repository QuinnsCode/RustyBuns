// Qollab cloud saves: PUT /q/save/<slot> keeps a game's opaque blob for the signed-in person, GET brings it back. Nothing here reads a body.
// A slot keeps its last VERSIONS; a person has up to SLOTS slots in an app and QUOTA bytes across all apps. Last write wins, and the reply
// to a PUT names the version it replaced, so a game can offer "keep the cloud one" (GET ?v=<id>) itself. Blobs live in D1; R2 when a game needs bigger.
import type { Env } from "./env.ts";

export const MAX_BODY = 256 * 1024, VERSIONS = 5, SLOTS = 20, QUOTA = 50 * 1024 * 1024;
export const slotOf = (s: string) => /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : null;

type Meta = { id: number; at: number; size: number };
export type Put = { ok: true; id: number; at: number; previous: { id: number; at: number } | null } | { ok: false; status: number; error: string };

export async function put(conf: Env, userId: string, app: string, slot: string, data: Uint8Array, now = Date.now()): Promise<Put> {
  if (data.byteLength > MAX_BODY) return { ok: false, status: 413, error: `a save is up to ${MAX_BODY / 1024} KB` };
  const mine = (await conf.DB.prepare(`SELECT id, at, size FROM saves WHERE user_id = ? AND app = ? AND slot = ? ORDER BY id DESC`).bind(userId, app, slot).all<Meta>()).results;
  if (!mine.length && ((await conf.DB.prepare(`SELECT COUNT(DISTINCT slot) AS n FROM saves WHERE user_id = ? AND app = ?`).bind(userId, app).first<number>("n")) ?? 0) >= SLOTS)
    return { ok: false, status: 409, error: `that's ${SLOTS} saves in this game: overwrite one` };
  // The versions this write pushes out give their bytes back before the quota is checked.
  const freed = mine.slice(VERSIONS - 1).reduce((n, v) => n + v.size, 0);
  const used = (await conf.DB.prepare(`SELECT COALESCE(SUM(size), 0) AS n FROM saves WHERE user_id = ?`).bind(userId).first<number>("n")) ?? 0;
  if (used - freed + data.byteLength > QUOTA) return { ok: false, status: 507, error: `that would pass ${QUOTA / 1024 / 1024} MB of saves: delete or overwrite some` };
  const id = await conf.DB.prepare(`INSERT INTO saves (user_id, app, slot, at, size, data) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`).bind(userId, app, slot, now, data.byteLength, data).first<number>("id");
  await conf.DB.prepare(`DELETE FROM saves WHERE user_id = ? AND app = ? AND slot = ? AND id NOT IN (SELECT id FROM saves WHERE user_id = ? AND app = ? AND slot = ? ORDER BY id DESC LIMIT ?)`)
    .bind(userId, app, slot, userId, app, slot, VERSIONS).run();
  const prev = mine[0];
  return { ok: true, id: id!, at: now, previous: prev ? { id: prev.id, at: prev.at } : null };
}

/** The newest version of a slot, or the one with this id. D1 hands a blob back as numbers, the local test database as bytes. */
export async function get(conf: Env, userId: string, app: string, slot: string, version?: number) {
  const row = await conf.DB.prepare(`SELECT id, at, data FROM saves WHERE user_id = ? AND app = ? AND slot = ?${version ? " AND id = ?" : ""} ORDER BY id DESC LIMIT 1`)
    .bind(...[userId, app, slot, ...(version ? [version] : [])]).first<{ id: number; at: number; data: ArrayLike<number> }>();
  return row && { id: row.id, at: row.at, data: Uint8Array.from(row.data) };
}
