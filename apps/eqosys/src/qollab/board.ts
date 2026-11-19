// Qollab posts and reactions (QOLLAB.md "Posts and reactions"): an app's people put up short posts and press icons on things.
// Never live, so plain D1 and HTTP: GET /q/posts and GET /q/reactions read with no sign-in (30 seconds at the edge), and
// POST /q/posts, DELETE /q/posts/<id>, PUT and DELETE /q/reactions need the app's token. The token's app is the post's; an app
// takes part once APPS gives it a `board` (its kinds of post and its icons). What a `ref` points at is the app's, never read here.
import { Counts, Post, PostList, PostMade, POST_MAX, Pressed, REF, REFS_MAX } from "@rustybuns/util/board";
import { check, obj, opt, str } from "@rustybuns/util/guard";
import { TokenBucket } from "@rustybuns/util/limits";
import { publicId } from "@rustybuns/util/seats";
import { ourApp, type QApp } from "../apps.ts";
import { bearerOf, cors, tokenOf } from "../door.ts";
import { json, type Env } from "../env.ts";

/** Posts one person may put up in one app in an hour. */
export const POSTS_AN_HOUR = 10;
/** Presses a second, and the burst, one person may make (in memory, so per isolate: a speed bump). */
export const REACT_RATE = 2, REACT_BURST = 5;
const PAGE = 50, HOUR = 3_600_000;

const buckets = new Map<string, TokenBucket>();
function mayPress(who: string, now: number) {
  if (buckets.size > 10_000) buckets.clear();
  let b = buckets.get(who);
  if (!b) buckets.set(who, (b = new TokenBucket(REACT_RATE, REACT_BURST, now)));
  return b.take(now);
}

const NewPost = obj({ kind: str(24), text: str(POST_MAX * 2), ref: opt(str(80)) });
const Press = obj({ ref: str(80), icon: str(40) });
type Row = { id: string; app: string; user_id: string; name: string; kind: string; ref: string | null; text: string; at: number; reacts: number };

const toPost = async (r: Row): Promise<Post> => ({
  id: r.id, app: r.app, by: { id: await publicId(r.app, r.user_id), name: r.name }, kind: r.kind, ...(r.ref ? { ref: r.ref } : {}), text: r.text, at: r.at, reacts: r.reacts,
});
const SELECT = `SELECT p.id, p.app, p.user_id, u.name, p.kind, p.ref, p.text, p.at,
  (SELECT COUNT(*) FROM reactions r WHERE r.app = p.app AND r.ref = 'post:' || p.id) AS reacts FROM posts p JOIN "user" u ON u.id = p.user_id`;

/** Each ref's counts by icon, and the asker's own icons on them. */
async function countsOf(conf: Env, app: string, refs: string[], me: string | null): Promise<Counts> {
  const counts: Counts["counts"] = {}, mine: Counts["mine"] = {};
  for (const r of refs) { counts[r] = {}; mine[r] = []; }
  if (!refs.length) return { counts, mine };
  const marks = refs.map(() => "?").join(", ");
  const { results } = await conf.DB.prepare(`SELECT ref, icon, COUNT(*) AS n, MAX(user_id = ?) AS me FROM reactions WHERE app = ? AND ref IN (${marks}) GROUP BY ref, icon`)
    .bind(me ?? "", app, ...refs).all<{ ref: string; icon: string; n: number; me: number }>();
  for (const r of results) { counts[r.ref]![r.icon] = r.n; if (r.me) mine[r.ref]!.push(r.icon); }
  return { counts, mine };
}

/** The app a signed-out read names (`?app=`), when it has a board. */
const boardApp = (id: string | null): QApp | null => { const a = ourApp(id); return a?.board ? a : null; };

/** The paths this file answers. */
export const isBoard = (pathname: string) => /^\/q\/(?:posts(?:\/[^/]+)?|reactions)$/.test(pathname);

export async function board(req: Request, conf: Env): Promise<Response> {
  const url = new URL(req.url), { pathname } = url, now = Date.now();
  const head = { ...await cors(req, conf), "access-control-allow-methods": "GET, POST, PUT, DELETE" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
  const bearer = bearerOf(req);
  const t = bearer ? await tokenOf(req, conf, bearer) : null;
  if (bearer && !t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
  const signedIn = () => t?.app.board ? t : null;
  const refused = () => json({ error: t ? "this app has no posts or reactions" : "sign in with eqosys first" }, t ? 404 : 401, head);

  if (pathname === "/q/posts" && req.method === "GET") {
    const app = t?.app.board ? t.app : boardApp(url.searchParams.get("app"));
    const kind = url.searchParams.get("kind") ?? "";
    if (!app || !app.board!.kinds.includes(kind)) return json({ error: "name an app with posts (?app=) and one of its kinds (?kind=)" }, 400, head);
    const top = url.searchParams.get("sort") === "top", since = Number(url.searchParams.get("since")) || 0, before = Number(url.searchParams.get("before")) || Infinity;
    const { results } = await conf.DB.prepare(top
      ? `${SELECT} WHERE p.app = ? AND p.kind = ? AND p.at >= ? ORDER BY reacts DESC, p.at DESC LIMIT ${PAGE}`
      : `${SELECT} WHERE p.app = ? AND p.kind = ? AND p.at < ? ORDER BY p.at DESC LIMIT ${PAGE}`)
      .bind(app.id, kind, top ? since : Math.min(before, Number.MAX_SAFE_INTEGER)).all<Row>();
    const posts = await Promise.all(results.map(toPost));
    return json({ posts } satisfies PostList, 200, { ...head, ...(t ? {} : { "cache-control": "public, max-age=30" }) });
  }

  if (pathname === "/q/posts" && req.method === "POST") {
    const me = signedIn();
    if (!me) return refused();
    const asked = check(NewPost, await req.json().catch(() => null)), text = asked?.text.trim() ?? "";
    if (!asked || !me.app.board!.kinds.includes(asked.kind)) return json({ error: `send { kind: ${me.app.board!.kinds.join(" | ")}, text, ref? }` }, 400, head);
    if (!text || text.length > POST_MAX) return json({ error: `a post is 1-${POST_MAX} characters` }, 400, head);
    if (asked.ref && !REF.test(asked.ref)) return json({ error: "a ref is up to 80 letters, digits and :._-" }, 400, head);
    const lately = await conf.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND app = ? AND at > ?").bind(me.who.id, me.app.id, now - HOUR).first<number>("n");
    if ((lately ?? 0) >= POSTS_AN_HOUR) return json({ error: `that's ${POSTS_AN_HOUR} posts this hour; wait a while` }, 429, head);
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    await conf.DB.prepare("INSERT INTO posts (id, app, user_id, kind, ref, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, me.app.id, me.who.id, asked.kind, asked.ref ?? null, text, now).run();
    const row = await conf.DB.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<Row>();
    return json({ post: await toPost(row!) } satisfies PostMade, 200, head);
  }

  const one = /^\/q\/posts\/([^/]+)$/.exec(pathname);
  if (one && req.method === "DELETE") {
    const me = signedIn();
    if (!me) return refused();
    const id = one[1]!;
    const gone = await conf.DB.prepare("DELETE FROM posts WHERE id = ? AND app = ? AND user_id = ? RETURNING id").bind(id, me.app.id, me.who.id).first<string>("id");
    if (!gone) return json({ error: "no post of yours has that id" }, 404, head);
    await conf.DB.prepare("DELETE FROM reactions WHERE app = ? AND ref = ?").bind(me.app.id, `post:${id}`).run();
    return json({ ok: true }, 200, head);
  }

  if (pathname === "/q/reactions" && req.method === "GET") {
    const app = t?.app.board ? t.app : boardApp(url.searchParams.get("app"));
    const refs = [...new Set(url.searchParams.getAll("ref"))];
    if (!app || !refs.length || refs.length > REFS_MAX || !refs.every((r) => REF.test(r))) return json({ error: `name an app with reactions (?app=) and 1-${REFS_MAX} refs (?ref=)` }, 400, head);
    const c = await countsOf(conf, app.id, refs, t?.app.board ? t.who.id : null);
    return json(c satisfies Counts, 200, { ...head, ...(t ? {} : { "cache-control": "public, max-age=30" }) });
  }

  if (pathname === "/q/reactions" && (req.method === "PUT" || req.method === "DELETE")) {
    const me = signedIn();
    if (!me) return refused();
    const asked = check(Press, await req.json().catch(() => null));
    if (!asked || !REF.test(asked.ref) || !me.app.board!.icons.includes(asked.icon)) return json({ error: `send { ref, icon: ${me.app.board!.icons.join(" | ")} }` }, 400, head);
    if (!mayPress(me.who.id, now)) return json({ error: "slow down a little" }, 429, head);
    await (req.method === "PUT"
      ? conf.DB.prepare("INSERT INTO reactions (app, ref, user_id, icon, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(me.app.id, asked.ref, me.who.id, asked.icon, now)
      : conf.DB.prepare("DELETE FROM reactions WHERE app = ? AND ref = ? AND user_id = ? AND icon = ?").bind(me.app.id, asked.ref, me.who.id, asked.icon)).run();
    const c = await countsOf(conf, me.app.id, [asked.ref], me.who.id);
    return json({ ref: asked.ref, counts: c.counts[asked.ref]!, mine: c.mine[asked.ref]! } satisfies Pressed, 200, head);
  }
  return json({ error: "GET or POST /q/posts, DELETE /q/posts/<id>, GET, PUT or DELETE /q/reactions" }, 405, head);
}
