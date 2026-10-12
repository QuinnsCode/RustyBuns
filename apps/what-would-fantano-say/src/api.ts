// POST /api/review. Rate limit, Turnstile, then one Claude call, with identical
// requests answered from the edge cache so a repeat costs nothing. With no key or
// no Turnstile the review is canned, so a half-configured deploy never spends.

import Anthropic from "@anthropic-ai/sdk";
import { pickBoxes } from "./boxes.ts";
import { cannedReview } from "./fake.ts";
import { turnstileOk, youtubeId, youtubeTitle } from "./guard.ts";
import { parseRequest, parseReview, REVIEW_SCHEMA, SYSTEM, userPrompt, type Review } from "./review.ts";

export interface ReviewEnv {
  ANTHROPIC_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  REVIEW_MODEL?: string;
  REVIEW_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

const MAX_BODY = 8 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handleReview(request: Request, env: ReviewEnv, cache?: Cache): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "too big" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: "too big" }, 413);

  let req;
  try { req = parseRequest(JSON.parse(raw)); } catch (e) { return json({ error: (e as Error).message }, 400); }

  const ip = request.headers.get("cf-connecting-ip") ?? "";
  if (env.REVIEW_LIMIT && !(await env.REVIEW_LIMIT.limit({ key: ip || "anon" })).success) {
    return json({ error: "slow down. even he only drops one review a day." }, 429);
  }

  const live = !!(env.ANTHROPIC_API_KEY && env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY);
  if (live && !(await turnstileOk(env.TURNSTILE_SECRET!, req.turnstile, ip))) return json({ error: "turnstile said no" }, 403);

  if (req.youtube) {
    const id = youtubeId(req.youtube);
    if (!id) return json({ error: "that's not a YouTube link" }, 400);
    req.title = (await youtubeTitle(id).catch(() => null)) ?? req.title;
  }

  const boxes = pickBoxes(req.features, `${req.hint} ${req.title}`);
  if (!live) return json(cannedReview(req, boxes));

  const prompt = userPrompt(req, boxes);
  const key = cache && new Request(`https://review.cache/${await sha256(prompt)}`);
  const hit = key && (await cache!.match(key));
  if (hit) return json(await hit.json());

  let review: Review;
  try {
    review = await askClaude(env, prompt);
  } catch (e) {
    console.error("review failed", e);
    return json({ ...cannedReview(req, boxes), note: "the critic is out of office; here's the canned take" });
  }
  if (key) await cache!.put(key, Response.json(review, { headers: { "Cache-Control": "max-age=86400" } }));
  return json(review);
}

async function askClaude(env: ReviewEnv, prompt: string): Promise<Review> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 30_000 });
  const res = await client.messages.create({
    model: env.REVIEW_MODEL || "claude-haiku-5-5",
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("refused");
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no text");
  return parseReview(block.text);
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
