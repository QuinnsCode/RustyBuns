// Qollab posts and reactions (QOLLAB.md "Posts and reactions"): an app's people put up short posts and press icons on things.
// Never live, so plain D1 and HTTP: GET /q/posts and GET /q/reactions read with no sign-in (30 seconds at the edge), and
// POST /q/posts, DELETE /q/posts/<id>, PUT and DELETE /q/reactions need the app's token. The token's app is the post's; an app
// takes part once APPS gives it a `board` (its kinds of post and its icons). What a `ref` points at is the app's, never read here.
// Keeping it clean: anyone signed in reports a post (POST /q/posts/<id>/report, through the game-report path in reports.ts), and
// an owner or admin of the app's studio hides one (PUT /q/posts/<id>/hidden, DELETE to bring it back) or deletes it.
// Blocking is the account's, in every app: PUT /q/posts/<id>/block blocks the post's author, GET /q/blocks lists them by their id in
// this app, DELETE /q/blocks/<id> unblocks. A signed-in feed leaves out everyone the reader blocked; the signed-out one can't.
import { Blocked, BLOCKS_MAX, Counts, Post, PostList, PostMade, POST_MAX, Pressed, REF, REFS_MAX } from "@rustybuns/util/board";
import { check, obj, opt, str } from "@rustybuns/util/guard";
import { TokenBucket } from "@rustybuns/util/limits";
import { publicId } from "@rustybuns/util/seats";
import { ourApp, type QApp } from "../apps.ts";
import { bearerOf, cors, tokenOf } from "../door.ts";
import { json, type Env } from "../env.ts";
import { file, reporterId } from "../reports.ts";

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
// A name is clipped as the pages' guard takes it (packages/util board.ts): one longer would fail the whole feed.
const SELECT = `SELECT p.id, p.app, p.user_id, substr(u.name, 1, 100) AS name, p.kind, p.ref, p.text, p.at,
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

/** Whether this person is an owner or admin of the studio that holds the app: the ones who hide and delete its posts. */
const runsApp = async (conf: Env, app: string, who: string) => !!(await conf.DB.prepare(
  "SELECT 1 FROM studio_apps a JOIN studio_members m ON m.studio_id = a.studio_id WHERE a.app = ? AND m.user_id = ? AND m.role IN ('owner', 'admin')").bind(app, who).first());

/** The paths this file answers. */
export const isBoard = (pathname: string) => /^\/q\/(?:posts(?:\/[^/]+(?:\/(?:report|hidden|block))?)?|reactions|blocks(?:\/[^/]+)?)$/.test(pathname);

/** The people this person blocked, newest first. */
const blocksOf = async (conf: Env, who: string) => (await conf.DB.prepare(
  `SELECT b.blocked_id, substr(u.name, 1, 100) AS name, b.at FROM blocks b JOIN "user" u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.at DESC LIMIT ${BLOCKS_MAX}`)
  .bind(who).all<{ blocked_id: string; name: string; at: number }>()).results;

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
    // Signed in, the reader's blocks are left out (a signed-out reader has none: "" is nobody's id).
    const unblocked = "AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?)", reader = t?.who.id ?? "";
    const top = url.searchParams.get("sort") === "top", since = Number(url.searchParams.get("since")) || 0, before = Number(url.searchParams.get("before")) || Infinity;
    const { results } = await conf.DB.prepare(top
      ? `${SELECT} WHERE p.app = ? AND p.kind = ? AND p.hidden = 0 ${unblocked} AND p.at >= ? ORDER BY reacts DESC, p.at DESC LIMIT ${PAGE}`
      : `${SELECT} WHERE p.app = ? AND p.kind = ? AND p.hidden = 0 ${unblocked} AND p.at < ? ORDER BY p.at DESC LIMIT ${PAGE}`)
      .bind(app.id, kind, reader, top ? since : Math.min(before, Number.MAX_SAFE_INTEGER)).all<Row>();
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
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    // The hour's count and the insert are one statement, so posts sent together can't all see room.
    const put = await conf.DB.prepare(`INSERT INTO posts (id, app, user_id, kind, ref, text, at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
      WHERE (SELECT COUNT(*) FROM posts WHERE user_id = ?3 AND app = ?2 AND at > ?8) < ?9 RETURNING id`)
      .bind(id, me.app.id, me.who.id, asked.kind, asked.ref ?? null, text, now, now - HOUR, POSTS_AN_HOUR).first<string>("id");
    if (!put) return json({ error: `that's ${POSTS_AN_HOUR} posts this hour; wait a while` }, 429, head);
    const row = await conf.DB.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<Row>();
    return json({ post: await toPost(row!) } satisfies PostMade, 200, head);
  }

  const one = /^\/q\/posts\/([^/]+)$/.exec(pathname);
  if (one && req.method === "DELETE") {
    const me = signedIn();
    if (!me) return refused();
    const id = one[1]!;
    const gone = await conf.DB.prepare("DELETE FROM posts WHERE id = ?1 AND app = ?2 AND (user_id = ?3 OR ?4) RETURNING id")
      .bind(id, me.app.id, me.who.id, await runsApp(conf, me.app.id, me.who.id) ? 1 : 0).first<string>("id");
    if (!gone) return json({ error: "no post of yours has that id" }, 404, head);
    await conf.DB.prepare("DELETE FROM reactions WHERE app = ? AND ref = ?").bind(me.app.id, `post:${id}`).run();
    return json({ ok: true }, 200, head);
  }

  // A report: a row through the game-report path, under the reporter's limits there. The issue may be public, so it carries the
  // post's id and its author's opaque id, never the words.
  const reported = /^\/q\/posts\/([^/]+)\/report$/.exec(pathname);
  if (reported && req.method === "POST") {
    const me = signedIn();
    if (!me) return refused();
    const post = await conf.DB.prepare("SELECT id, user_id, kind FROM posts WHERE id = ? AND app = ? AND hidden = 0").bind(reported[1]!, me.app.id).first<{ id: string; user_id: string; kind: string }>();
    if (!post) return json({ error: "no post has that id" }, 404, head);
    if (post.user_id === me.who.id) return json({ error: "that post is yours: take it down instead" }, 400, head);
    const filed = await file(conf, me.app, me.who.id, "", { kind: "bug", title: "Post report", body: `A post was reported.\n\nPost: ${post.id} (${post.kind})\nBy: ${await reporterId(post.user_id)}` }, now);
    return filed.ok ? json({ ok: true }, 200, head) : json({ error: filed.error }, filed.status, head);
  }

  const hide = /^\/q\/posts\/([^/]+)\/hidden$/.exec(pathname);
  if (hide && (req.method === "PUT" || req.method === "DELETE")) {
    const me = signedIn();
    if (!me) return refused();
    if (!await runsApp(conf, me.app.id, me.who.id)) return json({ error: "only the app's studio hides a post" }, 403, head);
    const done = await conf.DB.prepare("UPDATE posts SET hidden = ? WHERE id = ? AND app = ? RETURNING id").bind(req.method === "PUT" ? 1 : 0, hide[1]!, me.app.id).first<string>("id");
    return done ? json({ ok: true }, 200, head) : json({ error: "no post has that id" }, 404, head);
  }

  const block = /^\/q\/posts\/([^/]+)\/block$/.exec(pathname);
  if (block && req.method === "PUT") {
    const me = signedIn();
    if (!me) return refused();
    const author = await conf.DB.prepare("SELECT user_id FROM posts WHERE id = ? AND app = ?").bind(block[1]!, me.app.id).first<string>("user_id");
    if (!author) return json({ error: "no post has that id" }, 404, head);
    if (author === me.who.id) return json({ error: "that post is yours" }, 400, head);
    const n = await conf.DB.prepare("SELECT COUNT(*) AS n FROM blocks WHERE user_id = ?").bind(me.who.id).first<number>("n");
    if ((n ?? 0) >= BLOCKS_MAX) return json({ error: `that's ${BLOCKS_MAX} blocked; unblock someone first` }, 429, head);
    await conf.DB.prepare("INSERT INTO blocks (user_id, blocked_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(me.who.id, author, now).run();
    return json({ ok: true }, 200, head);
  }

  if (pathname === "/q/blocks" && req.method === "GET") {
    const me = signedIn();
    if (!me) return refused();
    const blocked = await Promise.all((await blocksOf(conf, me.who.id)).map(async (b) => ({ id: await publicId(me.app.id, b.blocked_id), name: b.name, at: b.at })));
    return json({ blocked } satisfies Blocked, 200, head);
  }

  // Unblocking names the person by their id in this app, which only runs one way: it is matched against the asker's own list.
  const unblock = /^\/q\/blocks\/([^/]+)$/.exec(pathname);
  if (unblock && req.method === "DELETE") {
    const me = signedIn();
    if (!me) return refused();
    let who: string | null = null;
    for (const b of await blocksOf(conf, me.who.id)) if (await publicId(me.app.id, b.blocked_id) === unblock[1]) { who = b.blocked_id; break; }
    if (!who) return json({ error: "you haven't blocked anyone with that id" }, 404, head);
    await conf.DB.prepare("DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?").bind(me.who.id, who).run();
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
  return json({ error: "GET or POST /q/posts, DELETE /q/posts/<id>, POST /q/posts/<id>/report, PUT or DELETE /q/posts/<id>/hidden, PUT /q/posts/<id>/block, GET /q/blocks, DELETE /q/blocks/<id>, GET, PUT or DELETE /q/reactions" }, 405, head);
}
