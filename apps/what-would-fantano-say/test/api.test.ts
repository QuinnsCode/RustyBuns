import { describe, expect, test } from "bun:test";
import { handleReview, type ReviewEnv } from "../src/api.ts";
import { pickBoxes } from "../src/boxes.ts";
import { youtubeId } from "../src/guard.ts";

const features = { durationSec: 200, loudnessDb: -7, dynamicsDb: 4, bpm: 145, pulse: 0.6, bass: 0.6, brightness: 0.3, silence: 0 };
const clip = "data:audio/wav;base64,UklGRiQAAABXQVZF";
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://x/api/review", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers });

/** A full live setup with a fake Clef that counts its calls. */
function liveEnv(cap = 10) {
  const calls: unknown[] = [];
  const box = pickBoxes(features, "", 6)[1]!.id;
  const env: ReviewEnv = {
    AI: { run: async (_m, input) => (calls.push(input), { answers: { box: { choice: box }, craft: { score: 4 }, originality: { score: 4 } } }) },
    BUDGET: { take: async () => calls.length < cap },
    DAILY_REVIEWS: String(cap),
    TURNSTILE_SECRET: "s",
    TURNSTILE_SITE_KEY: "k",
  };
  return { env, calls };
}

async function withTurnstile<T>(ok: boolean, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ success: ok })) as unknown as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

describe("POST /api/review", () => {
  test("nothing configured: the free estimate", async () => {
    const res = await handleReview(post({ features, clip, title: "t" }), {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { by: string }).by).toBe("estimate");
  });

  test("AI without Turnstile never calls it", async () => {
    const { env, calls } = liveEnv();
    delete env.TURNSTILE_SECRET;
    expect(((await (await handleReview(post({ features, clip }), env)).json()) as { by: string }).by).toBe("estimate");
    expect(calls.length).toBe(0);
  });

  test("live: Clef judges, and the review says so", async () => {
    const { env, calls } = liveEnv();
    const body = await withTurnstile(true, async () => (await handleReview(post({ features, clip, turnstile: "t" }), env)).json()) as { by: string; verdict: string };
    expect(body.by).toBe("clef");
    expect(body.verdict).toBe("STRONG");
    expect(calls.length).toBe(1);
  });

  test("a failed Turnstile is refused before Clef", async () => {
    const { env, calls } = liveEnv();
    const res = await withTurnstile(false, () => handleReview(post({ features, clip, turnstile: "t" }), env));
    expect(res.status).toBe(403);
    expect(calls.length).toBe(0);
  });

  test("past the daily budget, reviews are estimates", async () => {
    const { env, calls } = liveEnv(0);
    const body = await withTurnstile(true, async () => (await handleReview(post({ features, clip, turnstile: "t" }), env)).json()) as { by: string };
    expect(body.by).toBe("estimate");
    expect(calls.length).toBe(0);
  });

  test("rate limited per address", async () => {
    const seen: string[] = [];
    const env: ReviewEnv = { REVIEW_LIMIT: { limit: async ({ key }) => (seen.push(key), { success: false }) } };
    const res = await handleReview(post({ features }, { "cf-connecting-ip": "1.2.3.4" }), env);
    expect(res.status).toBe(429);
    expect(seen).toEqual(["1.2.3.4"]);
  });

  test("oversized and malformed bodies", async () => {
    expect((await handleReview(post("x".repeat(2_000_000)), {})).status).toBe(413);
    expect((await handleReview(post("{not json"), {})).status).toBe(400);
    expect((await handleReview(post({ youtube: "https://evil.example/watch?v=dQw4w9WgXcQ" }), {})).status).toBe(400);
  });
});

test("youtubeId only accepts YouTube", () => {
  expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(youtubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(youtubeId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
  expect(youtubeId("javascript:alert(1)")).toBeNull();
});
