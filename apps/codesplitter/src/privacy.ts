// Your data, yours to take and to bury (GDPR articles 15, 17 and 20). The policy
// itself is the #/privacy page in client.html; keep the two telling the same story.
//
//   GET    /api/me/export            everything here about you, as one JSON download
//   DELETE /api/me?confirm=<handle>  your account, your repos and everything of them
//
// Both are for the person, signed in on the site: never a token, an OAuth app or a
// hosted agent acting as you. Lines and branches you made in other people's repos
// stay there under your handle, the way commits stay in git; the handle is retired
// so no one can pick it up and pass as you. Asked to (?scrub=1, or an admin later:
// POST /api/admin/scrub {handle}), @ghost takes its place there instead (#514).
// The scrub finds repos by D1's authors, which each file DO fills the first time it
// wakes after #748; POST /api/admin/scrub/backfill wakes the ones nobody opens (#770).

import { evict, openToken } from "./github.ts";
import { fileStub, toFile } from "./archive.ts";
import { listFollows } from "./follows.ts";
import { settingsStub } from "./settings.ts";
import { json, readBody, type Env } from "./env.ts";
import type { RepoRef } from "./repos";

const all = async (env: Env, sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all()).results;

/** The Better Auth account behind a handle, or null in alias mode. */
async function authUser(env: Env, handle: string) {
  const row = await env.DB.prepare("SELECT auth_id FROM users WHERE name = ?").bind(handle).first();
  if (!row?.auth_id) return null;
  return env.DB.prepare(`SELECT id, name, email, "emailVerified", image, "createdAt", "updatedAt" FROM "user" WHERE id = ?`).bind(row.auth_id).first()
    .catch(() => null) as Promise<{ id: string; email: string } | null>;
}

/** Everything we hold about `handle`. Secrets go out as their last four, never hashes or tokens. */
export async function exportFor(env: Env, handle: string) {
  const u = await authUser(env, handle);
  const owned = await all(env, "SELECT owner, name, visibility, level, branch, upstream, created_at, expires_at FROM repos WHERE owner = ?", handle);
  const auth = u && {
    account: u,
    // How you sign in. The tokens behind them stay here, encrypted.
    sign_ins: await all(env, `SELECT "providerId" AS provider, "accountId" AS account, scope, "createdAt" FROM account WHERE "userId" = ?`, u.id),
    sessions: await all(env, `SELECT "createdAt", "expiresAt", "ipAddress", "userAgent" FROM session WHERE "userId" = ?`, u.id),
  };
  return {
    exported_at: new Date().toISOString(),
    handle,
    profile: await env.DB.prepare("SELECT name, bio, theme_html, avatar, github_account, agent_github, city_public FROM users WHERE name = ?").bind(handle).first(),
    ...(auth ?? {}),
    repos: owned,
    repo_code: "Your code is git: clone each repo (the Clone button on its page) to take every file and its history.",
    collaborating_on: await all(env, "SELECT owner, repo FROM collaborators WHERE name = ?", handle),
    collections: await Promise.all((await all(env, "SELECT id, title FROM playlists WHERE owner = ?", handle)).map(async (p: any) =>
      ({ ...p, tracks: await all(env, "SELECT owner, repo, path, from_line, to_line, note FROM tracks WHERE playlist = ?", p.id) }))),
    shares: await all(env, "SELECT * FROM shares WHERE by = ?", handle),
    beams: await all(env, "SELECT id, owner, repo, branch, to_user, title, sha, status, created_at FROM beams WHERE by = ?", handle),
    // Who and what you follow; a private repo's only while you're its crew, as in the app.
    following: await listFollows(env.DB, handle),
    invites_to_you: await all(env, "SELECT owner, repo, by, note, created_at, expires_at, claimed_at FROM invites WHERE target = ? OR claimed_by = ?", handle, handle),
    stamps: await all(env, "SELECT owner, repo, path, line, stamp, created_at FROM stamps WHERE by = ?", handle),
    branches: await all(env, "SELECT owner, repo, name, status, created_at, merged_at FROM branches WHERE by = ?", handle),
    cuts: await all(env, "SELECT * FROM cuts WHERE by = ?", handle),
    deploys: await all(env, "SELECT owner, repo, stage, trigger, status, commit_hash, url, at FROM deploys WHERE by = ?", handle),
    agent_runs: await all(env, "SELECT r.owner, r.repo, r.path, r.harness, r.task, r.model, r.status, r.started FROM agent_runs r JOIN repos o ON o.owner = r.owner AND o.name = r.repo WHERE o.owner = ?", handle),
    api_tokens: await all(env, "SELECT label, scope, last4, created_at, expires_at, last_used_at FROM api_tokens WHERE name = ? AND grant_id IS NULL", handle),
    connected_apps: await all(env, "SELECT client_name, scope, created_at, last_used_at FROM oauth_grants WHERE name = ?", handle),
    // The security audit log (audit.ts): what you did, and what was done in your repos.
    audit: await all(env, "SELECT at, actor, via, action, owner, repo, target, detail, country FROM audit WHERE actor = ? OR owner = ? ORDER BY id", handle, handle),
    // What the insights page counts (insights.ts): your requests per day, and the first and last time you did each step.
    usage: await all(env, "SELECT day, kind, via, hits, errors, first_at, last_at, ua FROM traffic WHERE who = ? ORDER BY day", `@${handle}`),
    steps: await all(env, "SELECT step, first_at, last_at, n FROM user_steps WHERE name = ?", handle),
    // What the home feed shows others of your edits (feed.ts), and your latest digest.
    line_events: await all(env, "SELECT owner, repo, path, sets, inserts, deletes, lines, first_at, last_at FROM line_events WHERE who = ?", handle),
    // The rev of each file you last saw (seen.ts).
    last_seen: await all(env, "SELECT key, rev, at FROM last_seen WHERE name = ? ORDER BY at DESC", handle),
    // What you agreed to share about how your merge conflicts go (usage.ts): no paths, no code.
    shared_usage: { opted_in: (await env.DB.prepare("SELECT share_usage FROM users WHERE name = ?").bind(handle).first())?.share_usage ?? null, conflicts: await all(env, "SELECT at, ext, round, who, harness, ok, tests FROM conflict_outcomes WHERE name = ?", handle) },
    // Your settings (settings.ts), from the Durable Object near you.
    settings: await settingsStub(env, handle).fetch(new Request("https://settings/")).then((r) => r.json()).catch(() => null),
    feed_digest: await env.DB.prepare("SELECT harness, status, since, through, text, at FROM feed_digests WHERE name = ?").bind(handle).first(),
  };
}

/**
 * Take back what GitHub and Google gave us, at their end (#515): otherwise codeSplitter
 * stays listed under the person's authorized apps there after the tokens here are gone.
 * Best effort and never in the way of the delete; returns the providers that didn't
 * take it, so the person can revoke those themselves.
 */
export async function revokeSignIns(env: Env, authId: string): Promise<string[]> {
  const rows = await all(env, `SELECT "providerId" AS provider, "accessToken" AS access, "refreshToken" AS refresh FROM account WHERE "userId" = ? AND "providerId" IN ('github', 'google')`, authId) as { provider: string; access: string | null; refresh: string | null }[];
  const failed = await Promise.all(rows.map(async (r) => {
    try {
      // Google drops the whole grant for either token; a refresh token outlives the access one.
      const sealed = r.provider === "google" ? r.refresh ?? r.access : r.access;
      if (!sealed) return null;
      // GitHub's needs our app's keys; without them it's the person's to revoke.
      if (r.provider === "github" && !(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)) return r.provider;
      const token = await openToken(env, sealed);
      const signal = AbortSignal.timeout(5000);
      const res = r.provider === "github"
        ? await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/grant`, {
          method: "DELETE", signal, body: JSON.stringify({ access_token: token }),
          headers: { accept: "application/vnd.github+json", "user-agent": "codesplitter", authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}` },
        })
        : await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", signal, body: new URLSearchParams({ token }) });
      // 404 (GitHub) and 400 invalid_token (Google): already revoked or expired, so gone all the same.
      if (res.ok || res.status === 404 || (r.provider === "google" && res.status === 400)) return null;
      console.error(`codeSplitter: revoking the ${r.provider} grant failed`, res.status);
    } catch (e) { console.error(`codeSplitter: revoking the ${r.provider} grant failed`, String((e as Error)?.message ?? e)); }
    return r.provider;
  }));
  return [...new Set(failed.filter((p): p is string => !!p))];
}

/** Who stands in for a deleted account in other people's repos, like GitHub's @ghost. Retired by migration 0056. */
export const GHOST = "ghost";

/** Other people's repos `handle` may be named in: crew of, edited, branched, merged, deployed, cut or invited in, or on lines copied there (#748). */
async function touched(env: Env, handle: string): Promise<[string, string][]> {
  const rows = await all(env, `SELECT owner, repo FROM collaborators WHERE name = ?1
    UNION SELECT owner, repo FROM line_events WHERE who = ?1
    UNION SELECT owner, repo FROM authors WHERE handle = ?1
    UNION SELECT owner, repo FROM branches WHERE by = ?1 OR merged_by = ?1
    UNION SELECT owner, repo FROM deploys WHERE by = ?1
    UNION SELECT owner, repo FROM cuts WHERE by = ?1
    UNION SELECT owner, repo FROM invites WHERE by = ?1 OR target = ?1 OR claimed_by = ?1`, handle) as RepoRef[];
  return rows.filter((r) => r.owner !== handle).map((r) => [r.owner, r.repo]);
}

/**
 * Put @ghost where retired `handle` is still named in other people's repos: each line's
 * author, op and commit in every file DO there (main's and each branch's), and branches,
 * deploys, cuts and invites in D1. Git commits keep their author, as clones do. Repos
 * come from what the delete noted (retired_handles) and the rows still naming it.
 */
export async function scrubHandle(env: Env, handle: string) {
  const noted = await env.DB.prepare("SELECT repos FROM retired_handles WHERE handle = ?").bind(handle).first();
  const repos = new Map<string, [string, string]>();
  for (const r of [...JSON.parse((noted?.repos as string) ?? "[]") as [string, string][], ...await touched(env, handle)]) repos.set(r.join("/"), r);
  let files = 0;
  for (const [owner, repo] of repos.values()) {
    const list = await all(env, "SELECT path, NULL AS branch FROM files WHERE owner = ?1 AND repo = ?2 UNION ALL SELECT path, branch FROM branch_files WHERE owner = ?1 AND repo = ?2", owner, repo) as { path: string; branch: string | null }[];
    const changed = await Promise.all(list.map(async (f) => {
      const res = await fileStub(env, owner, repo, f.path, f.branch ?? undefined).fetch(new Request("https://file/scrub", { method: "POST", body: JSON.stringify({ from: handle, to: GHOST }) }));
      return ((await res.json()) as { changed?: number }).changed ?? 0;
    }));
    files += changed.filter(Boolean).length;
  }
  const now = Date.now(), set = (table: string, col: string) => env.DB.prepare(`UPDATE ${table} SET ${col} = ?1 WHERE ${col} = ?2`).bind(GHOST, handle);
  await env.DB.batch([
    set("branches", "by"), set("branches", "merged_by"), set("deploys", "by"), set("cuts", "by"),
    set("invites", "by"), set("invites", "target"), set("invites", "claimed_by"),
    env.DB.prepare("INSERT OR IGNORE INTO authors (owner, repo, handle) SELECT owner, repo, ?1 FROM authors WHERE handle = ?2").bind(GHOST, handle),
    env.DB.prepare("DELETE FROM authors WHERE handle = ?").bind(handle),
    env.DB.prepare(`INSERT INTO retired_handles (handle, repos, retired_at, scrubbed_at) VALUES (?, '[]', ?, ?)
      ON CONFLICT (handle) DO UPDATE SET repos = '[]', scrubbed_at = excluded.scrubbed_at`).bind(handle, now, now),
  ]);
  return { handle, as: GHOST, repos: repos.size, files };
}

/**
 * Bury `handle`: its repos (rows, file DOs, git), its rows everywhere, and its sign-in,
 * GitHub's and Google's grants included; with `scrub`, @ghost takes its name in other
 * people's repos too. Returns the providers to revoke by hand.
 */
export async function eraseUser(env: Env, handle: string, { scrub = false } = {}): Promise<string[]> {
  const u = await authUser(env, handle);
  // Where it's named, before the rows that say so go: a scrub asked for later needs it.
  await env.DB.prepare("INSERT OR REPLACE INTO retired_handles (handle, repos, retired_at) VALUES (?, ?, ?)").bind(handle, JSON.stringify(await touched(env, handle)), Date.now()).run();
  // While the tokens are still here to revoke with.
  const revokeYourself = u ? await revokeSignIns(env, u.id) : [];
  for (const r of await all(env, "SELECT name FROM repos WHERE owner = ?", handle)) await evict(env, handle, (r as { name: string }).name);
  const by = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args);
  await env.DB.batch([
    by("DELETE FROM tracks WHERE playlist IN (SELECT id FROM playlists WHERE owner = ?)", handle),
    by("DELETE FROM playlists WHERE owner = ?", handle),
    by("DELETE FROM collaborators WHERE name = ?", handle),
    by("DELETE FROM shares WHERE by = ?", handle),
    by("DELETE FROM beams WHERE by = ?", handle),
    by("UPDATE beams SET to_user = NULL WHERE to_user = ?", handle),
    by("DELETE FROM follows WHERE follower = ? OR (kind IN ('user', 'agent') AND target = ?)", handle, handle),
    by("DELETE FROM invites WHERE target = ? AND claimed_by IS NULL", handle),
    by("DELETE FROM stamps WHERE by = ?", handle),
    by("DELETE FROM api_tokens WHERE name = ?", handle),
    by("DELETE FROM oauth_grants WHERE name = ?", handle),
    by("DELETE FROM oauth_requests WHERE name = ?", handle),
    by("DELETE FROM limit_jobs WHERE user = ?", handle),
    by("DELETE FROM traffic WHERE who = ?", `@${handle}`),
    by("DELETE FROM user_steps WHERE name = ?", handle),
    by("DELETE FROM line_events WHERE who = ?", handle),
    by("DELETE FROM audit WHERE actor = ? OR owner = ?", handle, handle),
    by("DELETE FROM feed_digests WHERE name = ?", handle),
    by("DELETE FROM conflict_outcomes WHERE name = ?", handle),
    by("DELETE FROM last_seen WHERE name = ?", handle),
    // evict leaves these: agent runs (the tasks you gave) and the limits counted against you.
    by("DELETE FROM agent_runs WHERE owner = ?", handle),
    by("DELETE FROM limit_hits WHERE who = ?", `@${handle}`),
    by("DELETE FROM limit_events WHERE who = ?", `@${handle}`),
    by("DELETE FROM users WHERE name = ?", handle),
    // Retired, not freed: the handle is still on lines in other people's repos.
    // handle_grants is what makes a handle unclaimable; no inbox is called this.
    by("INSERT OR REPLACE INTO handle_grants (handle, email) VALUES (?, ?)", handle, `retired:${handle}`),
  ]);
  await settingsStub(env, handle).fetch(new Request("https://settings/", { method: "DELETE" })).catch(() => {});
  if (scrub) await scrubHandle(env, handle);
  if (!u) return revokeYourself;
  await env.DB.batch([
    by(`DELETE FROM session WHERE "userId" = ?`, u.id),
    by(`DELETE FROM account WHERE "userId" = ?`, u.id),
    // Pending email links: a verification is keyed by the address, a reset carries the user's id.
    by(`DELETE FROM verification WHERE identifier = ? OR value = ?`, u.email, u.id),
    by("DELETE FROM handle_grants WHERE email = ?", u.email.toLowerCase()),
    by(`DELETE FROM "user" WHERE id = ?`, u.id),
  ]);
  return revokeYourself;
}

/** GET /api/me/export and DELETE /api/me. `person` is false for a token or a hosted agent. */
export async function privacyRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null, person: boolean): Promise<Response | null> {
  if (p[1] !== "me") return null;
  const exporting = p[2] === "export" && !p[3] && req.method === "GET";
  const erasing = !p[2] && req.method === "DELETE";
  if (!exporting && !erasing) return null;
  if (!user) return json({ error: "sign in first" }, 401);
  if (!person) return json({ error: "only you can do this, signed in on the site: not a token, an app or an agent" }, 403);
  if (exporting) {
    return json(await exportFor(env, user), 200, { "content-disposition": `attachment; filename="codesplitter-${user}.json"`, "cache-control": "no-store" });
  }
  if (url.searchParams.get("confirm") !== user) return json({ error: `to delete your account, confirm with your handle: ?confirm=${user}` }, 400);
  const revokeYourself = await eraseUser(env, user, { scrub: url.searchParams.get("scrub") === "1" });
  // Alias mode's cookie, and Better Auth's (its __Secure- twin is cleared the same way on https).
  const gone = ["cs_user", "better-auth.session_token", "better-auth.session_data", "__Secure-better-auth.session_token", "__Secure-better-auth.session_data"];
  const res = json({ deleted: user, ...(revokeYourself.length ? { revoke_yourself: revokeYourself } : {}) });
  for (const c of gone) res.headers.append("set-cookie", `${c}=; Path=/; Max-Age=0; SameSite=Lax${c.startsWith("__Secure-") ? "; Secure" : ""}`);
  return res;
}

/** Where the authors backfill stopped: the last file row it woke, main's (files) or a branch's (branch_files). */
export type BackfillCursor = { owner: string; repo: string; path: string; branch?: string };

/** How many file DOs one backfill call wakes. */
export const BACKFILL_PAGE = 50;

/**
 * Wake a page of file DOs, main's copies (files) then each branch's (branch_files), in
 * key order after `after`, so each puts its lines' authors into D1's authors (#770): a
 * file nobody has opened since #748 never noted them, and the scrub would miss its repo.
 * `next` is where to go on from, null when every file has been woken.
 */
export async function backfillAuthors(env: Env, after: BackfillCursor | null = null, page = BACKFILL_PAGE) {
  const rows: BackfillCursor[] = [];
  if (!after || after.branch === undefined) {
    const [o, r, p] = after ? [after.owner, after.repo, after.path] : ["", "", ""];
    rows.push(...await all(env, `SELECT owner, repo, path FROM files WHERE (owner, repo, path) > (?1, ?2, ?3)
      ORDER BY owner, repo, path LIMIT ?4`, o, r, p, page) as BackfillCursor[]);
  }
  if (rows.length < page) {
    const [o, r, b, p] = after?.branch !== undefined ? [after.owner, after.repo, after.branch, after.path] : ["", "", "", ""];
    rows.push(...await all(env, `SELECT owner, repo, branch, path FROM branch_files WHERE (owner, repo, branch, path) > (?1, ?2, ?3, ?4)
      ORDER BY owner, repo, branch, path LIMIT ?5`, o, r, b, p, page - rows.length) as BackfillCursor[]);
  }
  await Promise.all(rows.map((f) => toFile(env, f.owner, f.repo, f.path, "backfill", "authors", { method: "POST" }, "", f.branch).then((res) => res.body?.cancel())));
  return { woken: rows.length, next: rows.length < page ? null : rows.at(-1)! };
}

/**
 * POST /api/admin/scrub {handle}  put @ghost where a deleted account's handle still shows.
 * POST /api/admin/scrub/backfill {after?}  wake a page of file DOs to note their authors; call with `next` until it's null.
 * Admins only.
 */
export async function scrubRoutes(req: Request, env: Env, p: string[], admin: boolean): Promise<Response | null> {
  if (p[1] !== "admin" || p[2] !== "scrub" || (p[3] && p[3] !== "backfill") || p[4]) return null;
  if (!admin) return json({ error: "admins only" }, 403);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (p[3]) {
    // The cursor is a `next` this route handed out: strings all through, or none.
    const { after } = await readBody<"after">(req);
    const cursor = after == null ? null : Object(after) as Record<keyof BackfillCursor, unknown>;
    if (cursor && !(typeof cursor.owner === "string" && typeof cursor.repo === "string" && typeof cursor.path === "string" && (cursor.branch === undefined || typeof cursor.branch === "string"))) return json({ error: "after: the `next` the last page gave" }, 400);
    return json(await backfillAuthors(env, cursor as BackfillCursor | null));
  }
  const b = await readBody<"handle">(req), handle = typeof b.handle === "string" ? b.handle : "";
  const grant = await env.DB.prepare("SELECT email FROM handle_grants WHERE handle = ?").bind(handle).first();
  if (handle === GHOST || grant?.email !== `retired:${handle}`) return json({ error: `@${handle} isn't a deleted account's handle` }, 404);
  return json(await scrubHandle(env, handle));
}

/**
 * Hourly: sessions (and their IP and browser) and email links that have run out.
 * Better Auth keeps its dates as ISO text in D1 and as numbers elsewhere, so match either.
 */
export async function sweepSessions(env: Env, now = Date.now()) {
  const expired = `(typeof("expiresAt") IN ('integer', 'real') AND "expiresAt" < ?1) OR (typeof("expiresAt") = 'text' AND "expiresAt" < ?2)`;
  await env.DB.batch(["session", "verification"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE ${expired}`).bind(now, new Date(now).toISOString())))
    .catch((e: unknown) => console.error("codeSplitter: session sweep failed", String((e as Error)?.message ?? e)));
}

/**
 * The "we'll say so before it applies" promise on #/privacy: PRIVACY_NOTICE is
 * "YYYY-MM-DD what changes", the date the change applies. /api/session hands it to
 * the page as a banner people can dismiss; a new date brings it back. Unset, or
 * anything else, and there's no banner.
 */
export function privacyNotice(raw?: string): { date: string; text: string } | null {
  const m = raw?.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\S[\s\S]*)$/);
  return m && !Number.isNaN(Date.parse(m[1]!)) ? { date: m[1]!, text: m[2]!.trim() } : null;
}
