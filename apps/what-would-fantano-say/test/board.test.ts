// Shared reviews and their reactions, from the review to the week's board: one journey through the Worker's routes with a
// fake KV and a fake eqosys (Qollab's posts and counts).
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { handleReview } from "../src/api.ts";
import { handleBoard, handleKeep, handleVote, type Item, type Kv } from "../src/board.ts";

setDefaultTimeout(10_000);

const features = { durationSec: 200, loudnessDb: -7, dynamicsDb: 4, bpm: 145, pulse: 0.6, bass: 0.6, brightness: 0.3, silence: 0 };
const clip = "data:audio/wav;base64,UklGRiQAAABXQVZF";

function fakeKv() {
  const m = new Map<string, { v: string; ttl?: number }>();
  const kv: Kv = {
    get: async (k) => (m.has(k) ? JSON.parse(m.get(k)!.v) : null),
    put: async (k, v, o) => { m.set(k, { v, ttl: o?.expirationTtl }); },
  };
  return { kv, m };
}

const req = (path: string, body?: unknown, ip = "1.2.3.4") =>
  new Request(`https://wwfs.test${path}`, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "cf-connecting-ip": ip, "content-type": "application/json" } });

describe("shared reviews", () => {
  test("a review, shared, posted, voted on by a guest and a signed-in person, tops the week", async () => {
    const { kv, m } = fakeKv();
    const env = { REVIEWS: kv };

    // 1. The review comes back with the id it's kept under, for a day.
    const review = (await (await handleReview(req("/api/review", { features, clip, title: "Song" }), env)).json()) as { id: string; headline: string };
    expect(review.id).toMatch(/^[0-9a-f]{32}$/);
    expect(m.get(`review:${review.id}`)?.ttl).toBe(86400);
    // The same clip, hint and title is the same review, under the same id.
    expect(((await (await handleReview(req("/api/review", { features, clip, title: "Song" }), env)).json()) as { id: string }).id).toBe(review.id);

    // 2. Sharing keeps it for good. A made-up id can't be kept.
    expect((await handleKeep(req("/api/keep", { id: review.id }), env)).status).toBe(200);
    expect(m.get(`review:${review.id}`)?.ttl).toBeUndefined();
    expect((await handleKeep(req("/api/keep", { id: "0".repeat(32) }), env)).status).toBe(404);
    expect((await handleKeep(req("/api/keep", { id: "../x" }), env)).status).toBe(400);

    // 3. The page posted it to Qollab as post P1; Qollab has one signed-in flame on it.
    const post = { id: "P1", app: "what-would-fantano-say", by: { id: "u1", name: "Ada" }, kind: "review", ref: `review:${review.id}`, text: "x", at: 1, reacts: 1 };
    const other = { ...post, id: "P2", ref: "review:ffffffffffffffffffffffffffffffff", reacts: 0 };
    const asked: string[] = [];
    const eqosys = (async (u: string) => {
      asked.push(String(u));
      const url = new URL(String(u));
      if (url.pathname === "/q/posts") return Response.json({ posts: [other, post] });
      return Response.json({ counts: { "post:P1": { flame: 1 } }, mine: {} });
    }) as unknown as typeof fetch;

    // 4. A signed-out visitor gets one vote, on any track; a second is refused, even on another track.
    expect((await handleVote(req("/api/vote", { ref: "post:P1", icon: "laugh" }), env)).status).toBe(200);
    const again = await handleVote(req("/api/vote", { ref: "post:P2", icon: "flame" }), env);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain("Sign in");
    // Someone else (another address) still has theirs. Icons are only the board's three.
    expect((await handleVote(req("/api/vote", { ref: "post:P1", icon: "laugh" }, "5.6.7.8"), env)).status).toBe(200);
    expect((await handleVote(req("/api/vote", { ref: "post:P1", icon: "heart" }, "9.9.9.9"), env)).status).toBe(400);
    expect((await handleVote(req("/api/vote", { ref: "review:abc", icon: "flame" }, "9.9.9.9"), env)).status).toBe(400);

    // 5. The week's board: the review's text from KV, Qollab's flame and the two guest laughs, sorted by every vote.
    const board = (await (await handleBoard(req("/api/board"), env, eqosys, 8 * 86400_000)).json()) as { items: Item[]; guestUsed: boolean };
    expect(asked[0]).toContain("sort=top");
    expect(asked[0]).toContain(`since=${86400_000}`);
    expect(board.items.map((i) => i.ref)).toEqual(["post:P1", "post:P2"]);
    expect(board.items[0]!.review?.headline).toBe(review.headline);
    expect(board.items[0]!.counts).toEqual({ flame: 1 });
    expect(board.items[0]!.guest).toEqual({ laugh: 2 });
    expect(board.items[1]!.review).toBeNull();
    expect(board.guestUsed).toBe(true);
    expect(((await (await handleBoard(req("/api/board", undefined, "7.7.7.7"), env, eqosys)).json()) as { guestUsed: boolean }).guestUsed).toBe(false);

    // 6. The shared link opens one review with its votes.
    const one = (await (await handleBoard(req(`/api/board?post=P1&review=${review.id}`), env, eqosys)).json()) as { items: Item[] };
    expect(one.items).toHaveLength(1);
    expect(one.items[0]!.review?.headline).toBe(review.headline);
    expect(one.items[0]!.guest).toEqual({ laugh: 2 });
  });

  test("no KV: reviews carry no id, and keep and vote say so", async () => {
    const r = (await (await handleReview(req("/api/review", { features, clip }), {})).json()) as { id?: string };
    expect(r.id).toBeUndefined();
    expect((await handleKeep(req("/api/keep", { id: "a" }), {})).status).toBe(503);
    expect((await handleVote(req("/api/vote", { ref: "post:P1", icon: "flame" }), {})).status).toBe(503);
  });

  test("eqosys away: the board says so", async () => {
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect((await handleBoard(req("/api/board"), { REVIEWS: fakeKv().kv }, down)).status).toBe(502);
  });
});
