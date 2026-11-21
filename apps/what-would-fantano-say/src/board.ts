// Shared reviews and their reactions (apps/eqosys/QOLLAB.md, "Posts and reactions"). The review text lives here, in this
// app's own KV, by the hash of what was judged; Qollab keeps only the post (`kind: "review"`, `ref: "review:<id>"`) and the
// reactions on it (`post:<post id>`). A signed-in person gets one vote a track through Qollab; a signed-out visitor gets one
// vote in all, kept here by a hash of their address (owner, #5316).

import { Counts, PostList, REF, type Post } from "@rustybuns/util/board";
import { sha256 } from "@rustybuns/util/bytes";
import { bool, check, obj, oneOf, str } from "@rustybuns/util/guard";
import { privateJson as json } from "@rustybuns/util/http";
import { Review } from "./write.ts";

export const APP = "what-would-fantano-say";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The icons eqosys's APPS gives this app's board. */
export const ICONS = ["flame", "laugh", "skull"] as const;
export type Icon = (typeof ICONS)[number];
/** How many reviews the "most reacted this week" list shows. */
export const TOP = 10;
const WEEK = 7 * 24 * 3600 * 1000;
/** An unshared review is kept a day (long enough to share it from the card); a shared one is kept. */
const UNSHARED_TTL = 24 * 3600;

export interface Kv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, o?: { expirationTtl?: number }): Promise<void>;
}

export interface BoardEnv {
  REVIEWS?: Kv;
  REVIEW_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  /** Where eqosys is, for reading the board server side. Left out, the live one. */
  EQOSYS_URL?: string;
}

/** A review's id: the hash of what was judged (the clip, or the link), with the words that changed the review. */
export const reviewId = async (what: string, hint: string, title: string) => (await sha256(JSON.stringify([what, hint, title]))).slice(0, 32);
const ID = /^[0-9a-f]{32}$/;
const POST_ID = /^[\w-]{1,40}$/;

const Kept = obj({ review: Review, shared: bool() });

/** Keep a fresh review for a day, so its card can share it. */
export async function remember(kv: Kv, id: string, review: Review): Promise<void> {
  await kv.put(`review:${id}`, JSON.stringify({ review, shared: false }), { expirationTtl: UNSHARED_TTL });
}

export async function reviewOf(kv: Kv | undefined, id: string): Promise<Review | null> {
  if (!kv || !ID.test(id)) return null;
  return check(Kept, await kv.get(`review:${id}`, "json").catch(() => null))?.review ?? null;
}

type Tally = Partial<Record<Icon, number>>;
const Tally = (v: unknown): Tally => {
  const out: Tally = {};
  if (v && typeof v === "object") for (const i of ICONS) { const n = (v as Record<string, unknown>)[i]; if (typeof n === "number" && n > 0) out[i] = Math.floor(n); }
  return out;
};
const guestKey = async (ip: string) => `guest:${(await sha256(`wwfs-guest:${ip || "anon"}`)).slice(0, 32)}`;

/** One thing on the board: a shared review, its reactions in Qollab, and the signed-out votes kept here. */
export interface Item { ref: string; post: Post | null; review: Review | null; counts: Tally; guest: Tally }

const limited = async (env: BoardEnv, ip: string) => !!env.REVIEW_LIMIT && !(await env.REVIEW_LIMIT.limit({ key: ip || "anon" })).success;

/**
 * POST /api/keep `{ id }`: the review is being shared, so keep it past its day. Only a review this Worker wrote can be
 * kept, so nobody can put words of their own on the board's cards.
 */
export async function handleKeep(request: Request, env: BoardEnv): Promise<Response> {
  if (!env.REVIEWS) return json({ error: "this copy keeps no reviews" }, 503);
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  if (await limited(env, ip)) return json({ error: "slow down" }, 429);
  const id = check(obj({ id: str(40) }), await request.json().catch(() => null))?.id ?? "";
  if (!ID.test(id)) return json({ error: "that's not a review" }, 400);
  const kept = check(Kept, await env.REVIEWS.get(`review:${id}`, "json").catch(() => null));
  if (!kept) return json({ error: "that review is gone: reviews are kept a day unless shared" }, 404);
  if (!kept.shared) await env.REVIEWS.put(`review:${id}`, JSON.stringify({ review: kept.review, shared: true }));
  return json({ ok: true });
}

/** Qollab's counts for some refs, read signed out (no `mine`): an empty map when eqosys is away. */
async function qollabCounts(base: string, refs: string[], fetcher: typeof fetch): Promise<Counts["counts"]> {
  if (!refs.length) return {};
  const q = new URLSearchParams([["app", APP], ...refs.map((r): [string, string] => ["ref", r])]);
  const res = await fetcher(`${base}/q/reactions?${q}`).catch(() => null);
  return (res?.ok && check(Counts, await res.json().catch(() => null))?.counts) || {};
}

const total = (i: Pick<Item, "counts" | "guest">) => ICONS.reduce((n, k) => n + (i.counts[k] ?? 0) + (i.guest[k] ?? 0), 0);

/**
 * GET /api/board: the week's most reacted shared reviews, each with its text from KV and every vote on it.
 * GET /api/board?post=<id>&review=<id>: one shared review, as a shared link opens it.
 * `guestUsed` says whether this address has spent its one signed-out vote.
 */
export async function handleBoard(request: Request, env: BoardEnv, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const base = (env.EQOSYS_URL || EQOSYS).replace(/\/$/, "");
  const one = url.searchParams.get("post");
  let items: Item[];
  if (one !== null) {
    if (!POST_ID.test(one)) return json({ error: "that's not a post" }, 400);
    items = [{ ref: `post:${one}`, post: null, review: await reviewOf(env.REVIEWS, url.searchParams.get("review") ?? ""), counts: {}, guest: {} }];
  } else {
    const q = new URLSearchParams({ app: APP, kind: "review", sort: "top", since: String(now - WEEK) });
    const res = await fetcher(`${base}/q/posts?${q}`).catch(() => null);
    const posts = res?.ok ? check(PostList, await res.json().catch(() => null))?.posts : null;
    if (!posts) return json({ error: "eqosys can't be reached, so the board is empty for now" }, 502);
    items = await Promise.all(posts.slice(0, TOP).map(async (p) => ({
      ref: `post:${p.id}`, post: p, counts: {}, guest: {},
      review: p.ref?.startsWith("review:") ? await reviewOf(env.REVIEWS, p.ref.slice(7)) : null,
    })));
  }
  const counts = await qollabCounts(base, items.map((i) => i.ref), fetcher);
  await Promise.all(items.map(async (i) => {
    i.counts = Tally(counts[i.ref]);
    if (env.REVIEWS) i.guest = Tally(await env.REVIEWS.get(`votes:${i.ref}`, "json").catch(() => null));
  }));
  // Qollab sorts by its own reactions; the signed-out votes count too.
  if (one === null) items.sort((a, b) => total(b) - total(a));
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const guestUsed = env.REVIEWS ? !!(await env.REVIEWS.get(await guestKey(ip), "json").catch(() => null)) : true;
  return json({ items, guestUsed });
}

const Vote = obj({ ref: str(80), icon: oneOf(ICONS) });

/** POST /api/vote `{ ref, icon }`: a signed-out visitor's one vote, on a shared review (`post:<id>`). */
export async function handleVote(request: Request, env: BoardEnv): Promise<Response> {
  if (!env.REVIEWS) return json({ error: "this copy keeps no votes" }, 503);
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  if (await limited(env, ip)) return json({ error: "slow down" }, 429);
  const v = check(Vote, await request.json().catch(() => null));
  if (!v || !REF.test(v.ref) || !v.ref.startsWith("post:")) return json({ error: "that's not a vote" }, 400);
  const who = await guestKey(ip);
  if (await env.REVIEWS.get(who, "json").catch(() => null)) return json({ error: "That was your one vote. Sign in with eqosys to vote on every track." }, 409);
  await env.REVIEWS.put(who, JSON.stringify({ ref: v.ref, icon: v.icon, at: Date.now() }));
  const tally = Tally(await env.REVIEWS.get(`votes:${v.ref}`, "json").catch(() => null));
  tally[v.icon] = (tally[v.icon] ?? 0) + 1;
  await env.REVIEWS.put(`votes:${v.ref}`, JSON.stringify(tally));
  return json({ ref: v.ref, guest: tally });
}
