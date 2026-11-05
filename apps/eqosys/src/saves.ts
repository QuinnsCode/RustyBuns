// Qollab cloud saves: PUT /q/save/<slot> keeps a game's opaque blob for the signed-in person, GET brings it back. Nothing here reads a body.
// A slot keeps its last VERSIONS; a person has up to SLOTS slots in an app and QUOTA bytes across all apps. Last write wins, and the reply
// to a PUT names the version it replaced, so a game can offer "keep the cloud one" (GET ?v=<id>) itself. Blobs live in D1; R2 when a game needs bigger.
// Each blob is sealed with the person's own key from their vault (vault.ts), bound to its user, app and slot: deleting the account shreds the
// key, so the blob is unreadable everywhere D1 still has it. `size` stays the save's own bytes, so quotas don't count the seal.
import { seal, unseal } from "@rustybuns/util/privacy";
import type { Env } from "./env.ts";
import { vaultFor } from "./vault.ts";

export const MAX_BODY = 256 * 1024, VERSIONS = 5, SLOTS = 20, QUOTA = 50 * 1024 * 1024;
export const slotOf = (s: string) => /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : null;

type Meta = { id: number; at: number; size: number };
const where = (userId: string, app: string, slot: string) => `${userId}/${app}/${slot}`;
const keyOf = async (conf: Env, userId: string) => (await vaultFor(conf, userId))?.key() ?? null;
export type Put = { ok: true; id: number; at: number; previous: { id: number; at: number } | null } | { ok: false; status: number; error: string };

export async function put(conf: Env, userId: string, app: string, slot: string, data: Uint8Array<ArrayBuffer>, now = Date.now()): Promise<Put> {
  if (data.byteLength > MAX_BODY) return { ok: false, status: 413, error: `a save is up to ${MAX_BODY / 1024} KB` };
  const mine = (await conf.DB.prepare(`SELECT id, at, size FROM saves WHERE user_id = ? AND app = ? AND slot = ? ORDER BY id DESC`).bind(userId, app, slot).all<Meta>()).results;
  if (!mine.length && ((await conf.DB.prepare(`SELECT COUNT(DISTINCT slot) AS n FROM saves WHERE user_id = ? AND app = ?`).bind(userId, app).first<number>("n")) ?? 0) >= SLOTS)
    return { ok: false, status: 409, error: `that's ${SLOTS} saves in this game: overwrite one` };
  // The versions this write pushes out give their bytes back before the quota is checked.
  const freed = mine.slice(VERSIONS - 1).reduce((n, v) => n + v.size, 0);
  const used = (await conf.DB.prepare(`SELECT COALESCE(SUM(size), 0) AS n FROM saves WHERE user_id = ?`).bind(userId).first<number>("n")) ?? 0;
  if (used - freed + data.byteLength > QUOTA) return { ok: false, status: 507, error: `that would pass ${QUOTA / 1024 / 1024} MB of saves: delete or overwrite some` };
  const key = await keyOf(conf, userId);
  const kept = key ? await seal(key, data, where(userId, app, slot)) : data;
  const id = await conf.DB.prepare(`INSERT INTO saves (user_id, app, slot, at, size, data, sealed) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(userId, app, slot, now, data.byteLength, kept, key ? 1 : 0).first<number>("id");
  await conf.DB.prepare(`DELETE FROM saves WHERE user_id = ? AND app = ? AND slot = ? AND id NOT IN (SELECT id FROM saves WHERE user_id = ? AND app = ? AND slot = ? ORDER BY id DESC LIMIT ?)`)
    .bind(userId, app, slot, userId, app, slot, VERSIONS).run();
  const prev = mine[0];
  return { ok: true, id: id!, at: now, previous: prev ? { id: prev.id, at: prev.at } : null };
}

/** The newest version of a slot, or the one with this id, unsealed. D1 hands a blob back as numbers, the local test database as bytes.
 * Null for no save, and for a sealed one whose key is gone. */
export async function get(conf: Env, userId: string, app: string, slot: string, version?: number) {
  const row = await conf.DB.prepare(`SELECT id, at, data, sealed FROM saves WHERE user_id = ? AND app = ? AND slot = ?${version ? " AND id = ?" : ""} ORDER BY id DESC LIMIT 1`)
    .bind(...[userId, app, slot, ...(version ? [version] : [])]).first<{ id: number; at: number; data: ArrayLike<number>; sealed: number }>();
  if (!row) return null;
  const bytes = Uint8Array.from(row.data);
  if (!row.sealed) return { id: row.id, at: row.at, data: bytes };
  const key = await keyOf(conf, userId);
  const data = key && await unseal(key, bytes, where(userId, app, slot));
  return data ? { id: row.id, at: row.at, data } : null;
}

/** A person's saves as slots: versions kept, bytes and last write, newest first (never the data). */
export async function slotsOf(conf: Env, userId: string, app?: string) {
  const { results } = await conf.DB.prepare(`SELECT app, slot, COUNT(*) AS versions, SUM(size) AS bytes, MAX(at) AS at FROM saves WHERE user_id = ?${app ? " AND app = ?" : ""} GROUP BY app, slot ORDER BY at DESC`)
    .bind(...[userId, ...(app ? [app] : [])]).all<{ app: string; slot: string; versions: number; bytes: number; at: number }>();
  return results;
}
