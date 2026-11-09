// The Library's second list (LIBRARY.md): a studio's own game, kept in D1 as a listing, beside APPS, which stays ours and in code.
// A listing has the fields of a row in APPS plus its studio and a state:
//
//   draft --send--> in review --list--> listed --pull--> pulled
//                       \--refuse--> refused (with the reviewer's note; fix and send again)
//
// `appOf(conf, id)` is the one answer to "which app is this": APPS, or a listing that is a draft, in review or listed. A draft or a
// game in review answers only for its own studio's members (`mayUse`): the maker signs in from their real site before anyone else
// can. A refused or pulled game answers nobody, so its sign-ins and tokens stop at the door. `appsOf` is what shows: APPS and the
// listed games. Listings are read once a minute per isolate (per database, so tests' databases never mix), and dropped at once
// by a change in the same isolate (`forget`).
//
// A studio's game starts experimental with `play` only: `member`, a native scheme and `featured` come only from APPS, in a PR.
import { arr, check, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { APPS, GENRES, type QApp } from "./apps.ts";
import type { Env } from "./env.ts";
import { roleIn } from "./studios.ts";

export const STATES = ["draft", "in review", "listed", "refused", "pulled"] as const;
export type State = (typeof STATES)[number];
/** How long a pulled game's saves are kept before they are erased. */
export const PULLED_KEEP_MS = 30 * 86_400_000;
/** How long an isolate keeps the listings it read. */
export const FRESH_MS = 60_000;

/** A studio's game as the rest of eqosys sees it: a QApp that says whose it is and where its review stands. */
export interface Listing extends QApp { studio: { id: string; name: string }; state: State; note: string }

const HTTPS = str(200, { re: /^https:\/\/[^\s/?#]+$/ });
const RETURN = str(500, { re: /^https:\/\/[^\s#]+$/ });
/** What a studio fills in. The id is the game's own slug, unique across the Library (APPS too); first come, first kept. */
export const Draft = obj({
  studio: str(64),
  id: str(40, { min: 3, re: /^[a-z0-9]+(-[a-z0-9]+)*$/ }),
  name: str(40, { min: 1 }),
  kind: opt(oneOf(["game", "suite"])),
  genre: oneOf(GENRES),
  origins: arr(HTTPS, 4, { min: 1 }),
  returns: opt(arr(RETURN, 8, { min: 1 })),
  erase: opt(RETURN),
  blurb: opt(str(120, { min: 0 })),
});
export type Draft = Of<typeof Draft>;

type Row = { id: string; studio_id: string; studio: string; name: string; kind: "game" | "suite"; genre: string; origins: string; returns: string | null; erase: string | null; blurb: string; state: string; note: string; at: number; erased: number };
const urls = (s: string | null) => { if (!s) return undefined; try { return check(arr(str(500), 8, { drop: true }), JSON.parse(s)) ?? undefined; } catch { return undefined; } };

const listingOf = (r: Row): Listing => ({
  id: r.id, name: r.name, kind: r.kind, genre: check(oneOf(GENRES), r.genre) ?? "Action & Adventure",
  origins: urls(r.origins) ?? [], ...(r.returns ? { returns: urls(r.returns) ?? [] } : {}), ...(r.erase ? { erase: r.erase } : {}),
  starts: ["play"], maturity: "experimental", ...(r.blurb ? { blurb: r.blurb } : {}),
  studio: { id: r.studio_id, name: r.studio }, state: check(oneOf(STATES), r.state) ?? "draft", note: r.note,
});

const SELECT = `SELECT l.*, COALESCE(s.name, '') AS studio FROM listings l LEFT JOIN studios s ON s.id = l.studio_id`;
const kept = new WeakMap<object, { at: number; rows: Listing[] }>();

/** Drop this isolate's copy, after a change, so the next ask reads D1. */
export const forget = (conf: Env) => { kept.delete(conf.DB); };

/** Every listing that answers someone (draft, in review, listed), read at most once a minute. A pulled game's saves past their
 * 30 days are erased on the way. A database without the table yet (or a read that fails) is no listings: ours keep working. */
async function live(conf: Env, now = Date.now()): Promise<Listing[]> {
  const had = kept.get(conf.DB);
  if (had && now - had.at < FRESH_MS) return had.rows;
  try {
    const { results } = await conf.DB.prepare(`${SELECT} WHERE l.state IN ('draft', 'in review', 'listed') OR (l.state = 'pulled' AND l.erased = 0 AND l.at < ?)`)
      .bind(now - PULLED_KEEP_MS).all<Row>();
    const done = results.filter((r) => r.state === "pulled").map((r) => r.id);
    if (done.length) await conf.DB.batch(done.flatMap((id) => [conf.DB.prepare("DELETE FROM saves WHERE app = ?").bind(id), conf.DB.prepare("UPDATE listings SET erased = 1 WHERE id = ?").bind(id)]));
    const rows = results.filter((r) => r.state !== "pulled").map(listingOf);
    kept.set(conf.DB, { at: now, rows });
    return rows;
  } catch (e) {
    console.error("eqosys listings: couldn't read them", e);
    return [];
  }
}

/** What the Library shows: APPS, then each listed game. */
export async function appsOf(conf: Env): Promise<QApp[]> {
  return [...APPS, ...(await live(conf)).filter((l) => l.state === "listed")];
}

/** The app with this id: one of ours, or a studio's game that is a draft, in review or listed. Whether a person may use a draft is `mayUse`. */
export async function appOf(conf: Env, id: unknown): Promise<QApp | Listing | undefined> {
  if (typeof id !== "string") return undefined;
  return APPS.find((a) => a.id === id) ?? (await live(conf)).find((l) => l.id === id);
}

export const isListing = (app: QApp): app is Listing => "studio" in app && "state" in app;

/** Whether `userId` may sign in to `app` or use its token: anyone for ours and a listed game; a draft or one in review, only its studio's members. */
export async function mayUse(conf: Env, app: QApp, userId: string) {
  return !isListing(app) || app.state === "listed" || !!(await roleIn(conf, app.studio.id, userId));
}

/** Every origin a page may call eqosys from: ours, and each live listing's (a draft's too, so its maker can test from the real site). */
export async function originsOf(conf: Env): Promise<Set<string>> {
  return new Set([...APPS, ...(await live(conf))].flatMap((a) => a.origins));
}

/** One listing in any state, read fresh. */
export async function listing(conf: Env, id: string): Promise<Listing | null> {
  const r = await conf.DB.prepare(`${SELECT} WHERE l.id = ?`).bind(id).first<Row>();
  return r ? listingOf(r) : null;
}

/** Listings in these states, oldest change first (the review queue), or a studio's own in every state. */
export async function listings(conf: Env, by: { states?: State[]; studio?: string }): Promise<Listing[]> {
  const where: string[] = [], binds: string[] = [];
  if (by.states?.length) { where.push(`l.state IN (${by.states.map(() => "?").join(", ")})`); binds.push(...by.states); }
  if (by.studio) { where.push("l.studio_id = ?"); binds.push(by.studio); }
  const { results } = await conf.DB.prepare(`${SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY l.at`).bind(...binds).all<Row>();
  return results.map(listingOf);
}

export type Done = { ok: true; listing: Listing } | { ok: false; status: number; error: string };
const no = (status: number, error: string): Done => ({ ok: false, status, error });
const owns = async (conf: Env, studio: string, who: string) => { const r = await roleIn(conf, studio, who); return r === "owner" || r === "admin"; };
const same = (a: string[] | undefined, b: string[] | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Save a studio's game (its owner or admin): new as a draft, or a change. Changing the origins, returns or erase URL of a game in
 * review or listed sends it back to a draft, since those are where codes and accounts go; the name, genre and card text change freely.
 */
export async function save(conf: Env, who: string, d: Draft, now = Date.now()): Promise<Done> {
  if (!(await owns(conf, d.studio, who))) return no(403, "only a studio's owner or admin saves its games");
  if (APPS.some((a) => a.id === d.id)) return no(409, `"${d.id}" is taken`);
  const was = await listing(conf, d.id);
  if (was && was.studio.id !== d.studio) return no(409, `"${d.id}" is taken`);
  if (!was && await conf.DB.prepare("SELECT 1 FROM studio_apps WHERE app = ?").bind(d.id).first()) return no(409, `"${d.id}" is taken`);
  if (was?.state === "pulled") return no(409, `"${d.id}" was pulled: pick another id`);
  const moved = was && (!same(was.origins, d.origins) || !same(was.returns, d.returns) || (was.erase ?? null) !== (d.erase ?? null));
  const state: State = !was || moved || was.state === "refused" ? "draft" : was.state;
  const kind = d.kind ?? "game", returns = d.returns ? JSON.stringify(d.returns) : null;
  await conf.DB.batch([
    conf.DB.prepare(`INSERT INTO listings (id, studio_id, name, kind, genre, origins, returns, erase, blurb, state, note, made_at, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '', ?11, ?11)
      ON CONFLICT (id) DO UPDATE SET name = ?3, kind = ?4, genre = ?5, origins = ?6, returns = ?7, erase = ?8, blurb = ?9, state = ?10, at = ?11`)
      .bind(d.id, d.studio, d.name.trim(), kind, d.genre, JSON.stringify(d.origins), returns, d.erase ?? null, d.blurb ?? "", state, now),
    conf.DB.prepare("INSERT INTO studio_apps (app, studio_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(d.id, d.studio, now),
  ]);
  forget(conf);
  return { ok: true, listing: (await listing(conf, d.id))! };
}

async function move(conf: Env, id: string, to: State, note: string | null, now: number): Promise<Done> {
  await conf.DB.prepare(`UPDATE listings SET state = ?, note = COALESCE(?, note), at = ? WHERE id = ?`).bind(to, note, now, id).run();
  forget(conf);
  return { ok: true, listing: (await listing(conf, id))! };
}

/** A draft (or a refused game, fixed) goes to the review queue: its studio's owner or admin sends it. */
export async function send(conf: Env, who: string, id: string, now = Date.now()): Promise<Done> {
  const l = await listing(conf, id);
  if (!l || !(await owns(conf, l.studio.id, who))) return no(404, `no game "${id}" in a studio you run`);
  if (l.state !== "draft" && l.state !== "refused") return no(409, `"${id}" is ${l.state}: only a draft or a refused game is sent`);
  return move(conf, id, "in review", "", now);
}

/** The super admin's verdict on a game in review: listed, or refused with a note the studio reads. */
export async function review(conf: Env, id: string, verdict: "list" | "refuse", note: string, now = Date.now()): Promise<Done> {
  const l = await listing(conf, id);
  if (!l) return no(404, `no game "${id}"`);
  if (l.state !== "in review") return no(409, `"${id}" is ${l.state}, not in review`);
  if (verdict === "refuse" && !note.trim()) return no(400, "a refusal says why, in `note`");
  return move(conf, id, verdict === "list" ? "listed" : "refused", verdict === "refuse" ? note.trim() : "", now);
}

/** Take a game down: the super admin, or its own studio's owner or admin. Its tile goes and its sign-ins and tokens stop; its saves go in 30 days. */
export async function pull(conf: Env, who: string, admin: boolean, id: string, now = Date.now()): Promise<Done> {
  const l = await listing(conf, id);
  if (!l || (!admin && !(await owns(conf, l.studio.id, who)))) return no(404, `no game "${id}" in a studio you run`);
  if (l.state === "pulled") return no(409, `"${id}" is pulled already`);
  return move(conf, id, "pulled", null, now);
}
