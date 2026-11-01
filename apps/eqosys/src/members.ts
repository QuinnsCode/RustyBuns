// The user base across apps: where each person came from, which apps they use, what they may do there,
// and the one-minute codes that hand a signed-in person to an app.
import { appOf, HOME, type QApp } from "./apps.ts";
import type { Handoff } from "@rustybuns/util/token";
import { hubErase } from "./hub.ts";
import { partyOf } from "./party.ts";
import { b64url, digest, sha256, type Env } from "./env.ts";

/** What an app learns about a person at handoff: what its token says (@rustybuns/util/token). */
export type { Handoff };

export interface Member { id: string; email: string; name: string; source: string; created_at: number; apps: { app: string; last_at: number; access: string[] }[] }

const CODE_MS = 60_000;

/** Note that `userId` came in through `app` (or here, with none): the first time sets their source and grants the app's starts. */
export async function link(conf: Env, userId: string, app: QApp | null, now = Date.now()) {
  const db = conf.DB;
  const steps = [db.prepare("INSERT OR IGNORE INTO members (user_id, source, created_at) VALUES (?, ?, ?)").bind(userId, app?.id ?? HOME, now)];
  if (app) {
    // The starts go in before the link does, so they are granted once: taking one away sticks.
    for (const role of app.starts) steps.push(db.prepare(`INSERT OR IGNORE INTO access (user_id, app, role, granted_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM links WHERE user_id = ? AND app = ?)`).bind(userId, app.id, role, now, userId, app.id));
    steps.push(db.prepare(`INSERT INTO links (user_id, app, first_at, last_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, app) DO UPDATE SET last_at = excluded.last_at`).bind(userId, app.id, now, now));
  }
  await db.batch(steps);
}

/** A one-use code for `app`, good for a minute, that only the holder of the PKCE verifier can trade in. */
export async function mint(conf: Env, userId: string, app: QApp, challenge: string, nonce?: string, now = Date.now()) {
  const code = "eq_" + b64url(crypto.getRandomValues(new Uint8Array(24)));
  await conf.DB.prepare("DELETE FROM codes WHERE expires_at < ?").bind(now).run();
  await conf.DB.prepare("INSERT INTO codes (hash, user_id, app, challenge, expires_at, nonce) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256(code), userId, app.id, challenge, now + CODE_MS, nonce ?? null).run();
  return code;
}

/** The PKCE S256 challenge of a verifier. */
export const challengeOf = async (verifier: string) => b64url(await digest(verifier));

/** Trade a code in: the person behind it and the nonce it was asked with, or null for a code that is used, late, for another app or a wrong verifier. */
export async function exchange(conf: Env, app: string, code: string, verifier: string, now = Date.now()): Promise<{ who: Handoff; nonce: string | null } | null> {
  // Deleted on the first try, right or wrong: a code is never worth a second guess.
  const row = await conf.DB.prepare("DELETE FROM codes WHERE hash = ? RETURNING user_id, app, challenge, expires_at, nonce")
    .bind(await sha256(code)).first<{ user_id: string; app: string; challenge: string; expires_at: number; nonce: string | null }>();
  if (!row || row.app !== app || row.expires_at < now || row.challenge !== await challengeOf(verifier)) return null;
  const who = await handoff(conf, row.user_id, app);
  return who && { who, nonce: row.nonce };
}

const REFRESH_MS = 30 * 86_400_000;

/** A refresh token for a native app (OpenID's offline_access): a month long, one use, kept as its hash. Each use hands out the next. */
export async function mintRefresh(conf: Env, userId: string, app: string, now = Date.now()) {
  const token = "eqr_" + b64url(crypto.getRandomValues(new Uint8Array(32)));
  await conf.DB.batch([
    conf.DB.prepare("DELETE FROM refresh WHERE expires_at < ?").bind(now),
    conf.DB.prepare("INSERT INTO refresh (hash, user_id, app, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(token), userId, app, now + REFRESH_MS),
  ]);
  return token;
}

/** Spend a refresh token: who it was for, now, or null for one that is spent, late, revoked or another app's. */
export async function spendRefresh(conf: Env, app: string, token: string, now = Date.now()): Promise<Handoff | null> {
  const row = await conf.DB.prepare("DELETE FROM refresh WHERE hash = ? RETURNING user_id, app, expires_at")
    .bind(await sha256(token)).first<{ user_id: string; app: string; expires_at: number }>();
  return row && row.app === app && row.expires_at >= now ? handoff(conf, row.user_id, app) : null;
}

/** Throw a refresh token away (signing out of a native app). Quietly does nothing for one that isn't there. */
export const revokeRefresh = async (conf: Env, token: string) => { await conf.DB.prepare("DELETE FROM refresh WHERE hash = ?").bind(await sha256(token)).run(); };

/** Whether eqosys has seen proof the person holds their email (a provider that said so). Email and password sign-ups haven't. */
export const emailVerified = async (conf: Env, userId: string) =>
  !!(await conf.DB.prepare(`SELECT "emailVerified" AS v FROM "user" WHERE id = ?`).bind(userId).first<{ v: number }>())?.v;

async function handoff(conf: Env, userId: string, app: string): Promise<Handoff | null> {
  const u = await conf.DB.prepare(`SELECT u.id, u.email, u.name, m.source FROM "user" u LEFT JOIN members m ON m.user_id = u.id WHERE u.id = ?`)
    .bind(userId).first<{ id: string; email: string; name: string; source: string | null }>();
  if (!u) return null;
  const { results } = await conf.DB.prepare("SELECT role FROM access WHERE user_id = ? AND app = ? ORDER BY role").bind(userId, app).all<{ role: string }>();
  return { user: { id: u.id, email: u.email, name: u.name }, app, source: u.source ?? HOME, access: results.map((r) => r.role) };
}

/** Everyone, or the one person `userId`, with their apps and access. */
export async function members(conf: Env, userId?: string): Promise<Member[]> {
  const where = userId ? "WHERE u.id = ?" : "";
  const people = await conf.DB.prepare(`SELECT u.id, u.email, u.name, COALESCE(m.source, '${HOME}') AS source, COALESCE(m.created_at, 0) AS created_at
    FROM "user" u LEFT JOIN members m ON m.user_id = u.id ${where} ORDER BY m.created_at DESC LIMIT 500`).bind(...(userId ? [userId] : []))
    .all<Omit<Member, "apps">>();
  const ids = people.results.map((p) => p.id);
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(", ");
  const links = await conf.DB.prepare(`SELECT user_id, app, last_at FROM links WHERE user_id IN (${marks}) ORDER BY last_at DESC`).bind(...ids)
    .all<{ user_id: string; app: string; last_at: number }>();
  const access = await conf.DB.prepare(`SELECT user_id, app, role FROM access WHERE user_id IN (${marks}) ORDER BY role`).bind(...ids)
    .all<{ user_id: string; app: string; role: string }>();
  return people.results.map((p) => {
    const roles = access.results.filter((a) => a.user_id === p.id);
    const apps = links.results.filter((l) => l.user_id === p.id).map((l) => ({ app: l.app, last_at: l.last_at, access: roles.filter((r) => r.app === l.app).map((r) => r.role) }));
    // Access granted to an app they haven't opened yet still shows.
    for (const r of roles) if (!apps.some((a) => a.app === r.app)) apps.push({ app: r.app, last_at: 0, access: roles.filter((x) => x.app === r.app).map((x) => x.role) });
    return { ...p, apps };
  });
}

/** Give or take away one role in one app. False for an unknown app or person. */
export async function setAccess(conf: Env, email: string, app: string, role: string, on: boolean, by: string, now = Date.now()) {
  if (!appOf(app)) return false;
  const u = await conf.DB.prepare(`SELECT id FROM "user" WHERE lower(email) = lower(?)`).bind(email.trim()).first<{ id: string }>();
  if (!u) return false;
  await (on
    ? conf.DB.prepare("INSERT OR IGNORE INTO access (user_id, app, role, granted_at, granted_by) VALUES (?, ?, ?, ?, ?)").bind(u.id, app, role, now, by)
    : conf.DB.prepare("DELETE FROM access WHERE user_id = ? AND app = ? AND role = ?").bind(u.id, app, role)).run();
  return true;
}

/** Delete a person and everything eqosys holds about them: sessions, sign-in methods, links, access, codes, and their hub (friends hear they are gone). */
export async function deleteAccount(conf: Env, userId: string) {
  const u = await conf.DB.prepare(`SELECT email FROM "user" WHERE id = ?`).bind(userId).first<{ email: string }>();
  if (!u) return false;
  if (conf.HUB) await hubErase(conf.HUB, userId);
  // Every party they sat in forgets them: their sockets close and their ready flag, mute and messages go (and a party they hosted ends).
  const seats = await conf.DB.prepare("SELECT code FROM party_seats WHERE user_id = ?").bind(userId).all<{ code: string }>();
  if (conf.PARTY) for (const s of seats.results) await partyOf(conf.PARTY, s.code).fetch(new Request(`https://party/erase?${new URLSearchParams({ id: userId })}`)).catch(() => null);
  const gone = (table: string, col = "user_id") => conf.DB.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).bind(userId);
  await conf.DB.batch([
    gone("codes"), gone("party_seats"), gone("saves"), gone("refresh"), gone("reports"), gone("access"), gone("links"), gone("members"),
    gone('"session"', '"userId"'), gone('"account"', '"userId"'),
    conf.DB.prepare(`DELETE FROM "verification" WHERE identifier = ?`).bind(u.email),
    gone('"user"', "id"),
  ]);
  return true;
}
