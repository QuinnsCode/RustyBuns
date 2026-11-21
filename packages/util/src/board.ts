// Qollab's posts and reactions (apps/eqosys/QOLLAB.md, "Posts and reactions"): one person puts up a short line in an app, others
// press an icon on it or on any thing the app names. Never live: plain HTTP, no socket. The guards below are what the routes answer
// (apps/eqosys/src/qollab/board.ts writes `x satisfies ...`), and `board()` is the page's side, reached as `eqosys().board()`.
import { arr, bool, check, int, obj, opt, rec, str, type Guard, type Of } from "./guard.ts";

/** A post's text: up to 280 characters, as a chat line. */
export const POST_MAX = 280;
/** How many refs one `counts` call may ask about. */
export const REFS_MAX = 50;
/** A ref the app names a thing by (`fight:K3X9`, `review:<clip hash>`, `post:<id>`): letters, digits and `:._-`. */
export const REF = /^[\w:.-]{1,80}$/;

/** One post. `by.id` is the author's id in this app (the same one a seat uses), so a page can tell its own; `reacts` is every
 *  reaction on `post:<id>` added up, for sorting. Qollab never reads what `ref` points at: the app draws the post. */
export const Post = obj({
  id: str(40), app: str(64), by: obj({ id: str(64), name: str(100) }), kind: str(24), ref: opt(str(80)), text: str(POST_MAX), at: int(0, Number.MAX_SAFE_INTEGER), reacts: int(0, Number.MAX_SAFE_INTEGER),
});
export type Post = Of<typeof Post>;
export const PostList = obj({ posts: arr(Post, 50) });
export type PostList = Of<typeof PostList>;
export const PostMade = obj({ post: Post });
export type PostMade = Of<typeof PostMade>;
export const Gone = obj({ ok: bool() });

/** Reactions on some refs: each one's counts by icon, and which of them are the asker's own (empty signed out). */
export const Counts = obj({ counts: rec(rec(int(0, Number.MAX_SAFE_INTEGER), 6), REFS_MAX), mine: rec(arr(str(40), 6), REFS_MAX) });
export type Counts = Of<typeof Counts>;
/** After a press: that ref's counts and the asker's icons on it. */
export const Pressed = obj({ ref: str(80), counts: rec(int(0, Number.MAX_SAFE_INTEGER), 6), mine: arr(str(40), 6) });
export type Pressed = Of<typeof Pressed>;
/** How many people one account may block. */
export const BLOCKS_MAX = 500;
/** The people the asker blocked: each by their id in this app (as a post's `by.id`) and name, newest first. */
export const Blocked = obj({ blocked: arr(obj({ id: str(64), name: str(100), at: int(0, Number.MAX_SAFE_INTEGER) }), BLOCKS_MAX) });
export type Blocked = Of<typeof Blocked>;

const Refused = obj({ error: str(500) });

export interface BoardConfig {
  /** Where eqosys is. */
  url: () => string;
  /** A fresh token for this app, or null when signed out. */
  token: () => string | null;
  /** The app's id in eqosys's APPS, for reading signed out. */
  app: string;
}

/** What one call answers: the value, or why not in words a person can read. */
export type Said<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The page's side of Qollab's posts and reactions. Reading needs no sign-in; posting and pressing need the app's token.
 * `list` pages newest first (`before` the last one's `at`), or the most reacted since a time with `{ top: since }`.
 */
export function board({ url, token, app }: BoardConfig) {
  async function ask<T>(path: string, guard: Guard<T>, method = "GET", body?: unknown, needs = true): Promise<Said<T>> {
    const t = token();
    if (needs && !t) return { ok: false, error: "Sign in with eqosys first." };
    const headers: Record<string, string> = t ? { authorization: `Bearer ${t}` } : {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${url()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
    if (!res) return { ok: false, error: "eqosys can't be reached." };
    const v: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: check(Refused, v)?.error ?? "eqosys said no." };
    const value = check(guard, v);
    return value === null ? { ok: false, error: "eqosys answered something odd." } : { ok: true, value };
  }
  return {
    /** Put up a post: `kind` is one the app lists (`prompt`, `review`), `ref` the thing it is about, if any. */
    post: async (kind: string, text: string, ref?: string): Promise<Said<Post>> => {
      const r = await ask("/q/posts", PostMade, "POST", { kind, text, ...(ref ? { ref } : {}) });
      return r.ok ? { ok: true, value: r.value.post } : r;
    },
    /** A page of posts of one kind: newest first, or with `top` the most reacted since that time (ms). */
    list: async (kind: string, o: { before?: number; top?: number } = {}): Promise<Said<Post[]>> => {
      const q = new URLSearchParams({ app, kind, ...(o.top !== undefined ? { sort: "top", since: String(o.top) } : {}), ...(o.before !== undefined ? { before: String(o.before) } : {}) });
      const r = await ask(`/q/posts?${q}`, PostList, "GET", undefined, false);
      return r.ok ? { ok: true, value: r.value.posts } : r;
    },
    /** Take your own post down (the app's studio may take down anyone's). */
    remove: async (id: string): Promise<Said<true>> => {
      const r = await ask(`/q/posts/${encodeURIComponent(id)}`, Gone, "DELETE");
      return r.ok ? { ok: true, value: true } : r;
    },
    /** Report a post that shouldn't be there: it goes to the app's studio through the game-report path. Not your own. */
    report: async (id: string): Promise<Said<true>> => {
      const r = await ask(`/q/posts/${encodeURIComponent(id)}/report`, Gone, "POST");
      return r.ok ? { ok: true, value: true } : r;
    },
    /** The app's studio (an owner or admin) hides a post from every feed, or brings it back (`on: false`). */
    hide: async (id: string, on = true): Promise<Said<true>> => {
      const r = await ask(`/q/posts/${encodeURIComponent(id)}/hidden`, Gone, on ? "PUT" : "DELETE");
      return r.ok ? { ok: true, value: true } : r;
    },
    /** Block a post's author, account-wide: their posts leave every feed you read, in every app. Not yourself. */
    block: async (postId: string): Promise<Said<true>> => {
      const r = await ask(`/q/posts/${encodeURIComponent(postId)}/block`, Gone, "PUT");
      return r.ok ? { ok: true, value: true } : r;
    },
    /** The people you blocked, with their ids in this app. */
    blocked: async (): Promise<Said<Blocked["blocked"]>> => {
      const r = await ask("/q/blocks", Blocked);
      return r.ok ? { ok: true, value: r.value.blocked } : r;
    },
    /** Unblock someone by their id in this app (a post's `by.id`, or one from `blocked()`). */
    unblock: async (id: string): Promise<Said<true>> => {
      const r = await ask(`/q/blocks/${encodeURIComponent(id)}`, Gone, "DELETE");
      return r.ok ? { ok: true, value: true } : r;
    },
    /** Press an icon on a thing (`on`), or take it back (`on: false`). */
    react: (ref: string, icon: string, on = true): Promise<Said<Pressed>> => ask("/q/reactions", Pressed, on ? "PUT" : "DELETE", { ref, icon }),
    /** The counts on up to REFS_MAX things, and which are yours. */
    counts: (refs: string[]): Promise<Said<Counts>> => {
      const q = new URLSearchParams([["app", app], ...refs.slice(0, REFS_MAX).map((r): [string, string] => ["ref", r])]);
      return ask(`/q/reactions?${q}`, Counts, "GET", undefined, false);
    },
  };
}
