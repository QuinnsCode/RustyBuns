import { describe, expect, test } from "bun:test";
import { handleReview, type ReviewEnv } from "../src/api.ts";
import { youtubeId } from "../src/guard.ts";

const features = { durationSec: 200, loudnessDb: -7, dynamicsDb: 4, bpm: 145, pulse: 0.6, bass: 0.6, brightness: 0.3, silence: 0 };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://x/api/review", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers });

describe("POST /api/review", () => {
  test("no key: a canned review, and nothing leaves the Worker", async () => {
    const res = await handleReview(post({ features, title: "t" }), {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { by: string }).by).toBe("canned");
  });

  test("a key without Turnstile still never spends", async () => {
    const env: ReviewEnv = { ANTHROPIC_API_KEY: "sk-test" };
    const res = await handleReview(post({ features }), env);
    expect(((await res.json()) as { by: string }).by).toBe("canned");
  });

  test("rate limited per address", async () => {
    const seen: string[] = [];
    const env: ReviewEnv = { REVIEW_LIMIT: { limit: async ({ key }) => (seen.push(key), { success: false }) } };
    const res = await handleReview(post({ features }, { "cf-connecting-ip": "1.2.3.4" }), env);
    expect(res.status).toBe(429);
    expect(seen).toEqual(["1.2.3.4"]);
  });

  test("live without a Turnstile token is refused before any model call", async () => {
    const env: ReviewEnv = { ANTHROPIC_API_KEY: "sk-test", TURNSTILE_SECRET: "s", TURNSTILE_SITE_KEY: "k" };
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => (calls++, Response.json({ success: false }))) as unknown as typeof fetch;
    try {
      expect((await handleReview(post({ features, turnstile: "" }), env)).status).toBe(403);
      expect(calls).toBe(0);
    } finally { globalThis.fetch = real; }
  });

  test("oversized and malformed bodies", async () => {
    expect((await handleReview(post("x".repeat(9000)), {})).status).toBe(413);
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
