// POST /api/review. In order: size cap, per-address rate limit, Turnstile, the edge
// cache, the daily budget, then one Clef-omni call (~$0.00005). Anything missing or
// failing falls back to the free estimate, so nothing here can run up a bill.

import { boxById, pickBoxes } from "./boxes.ts";
import { turnstileOk, youtubeId, youtubeTitle } from "./guard.ts";
import { clefRequest, estimate, MODEL, parseClef, type Verdict } from "./judge.ts";
import { MAX_CLIP, parseRequest } from "./review.ts";
import { cameo, writeReview } from "./write.ts";

export interface ReviewEnv {
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  BUDGET?: { take(cap: number): Promise<boolean> };
  DAILY_REVIEWS?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  REVIEW_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

const MAX_BODY = MAX_CLIP + 8 * 1024;
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

  const live = !!(env.AI && env.BUDGET && env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY && req.clip);
  if (live && !(await turnstileOk(env.TURNSTILE_SECRET!, req.turnstile, ip))) return json({ error: "turnstile said no" }, 403);

  if (req.youtube) {
    const id = youtubeId(req.youtube);
    if (!id) return json({ error: "that's not a YouTube link" }, 400);
    req.title = (await youtubeTitle(id).catch(() => null)) ?? req.title;
  }

  // The numbers narrow twelve boxes to six, so Clef reads (and bills) fewer options.
  const boxes = pickBoxes(req.features, `${req.hint} ${req.title}`, 6);
  let verdict: Verdict = estimate(req.features, boxes);

  if (live) {
    const input = clefRequest(req.clip, boxes, req.title, req.hint);
    const key = cache && new Request(`https://review.cache/${await sha256(JSON.stringify(input))}`);
    const hit = key && (await cache!.match(key));
    if (hit) verdict = (await hit.json()) as Verdict;
    else if (await env.BUDGET!.take(Number(env.DAILY_REVIEWS) || 0)) {
      try {
        verdict = parseClef(await env.AI!.run(MODEL, input), boxes);
        if (key) await cache!.put(key, Response.json(verdict, { headers: { "Cache-Control": "max-age=86400" } }));
      } catch (e) {
        console.error("clef failed", e);
      }
    }
  }

  return json(cameo(verdict, req.title, req.hint) ?? writeReview(verdict, boxById(verdict.box) ?? boxes[0]!, req.features, req.title));
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
