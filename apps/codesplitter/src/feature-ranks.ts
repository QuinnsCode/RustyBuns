// Rank the features, and say why (the features page). Signed in only.
//   GET  /api/feature-ranks            every feature's crowd score, your tiers, the latest comments, when you may comment next
//   PUT  /api/me/feature-ranks {tiers} replace your ranking: {feature: S|A|B|C}, a feature left out is unranked
//   POST /api/feature-comments {text}  one comment, and then a 10 minute wait
// Scores are the average of the tiers people gave (S 4, A 3, B 2, C 1), unranked left out.

import { json, readBody, type Env } from "./env.ts";

export const TIERS = ["S", "A", "B", "C"] as const;
export const POINTS: Record<string, number> = { S: 4, A: 3, B: 2, C: 1 };
export const COMMENT_GAP_MS = 10 * 60_000;
const SHOWN = 20;

/** A posted ranking in, clean, or why not. Feature ids aren't checked against a list: the features change with each release. */
export function parseTiers(v: unknown): Record<string, string> | string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "tiers must be an object of feature to tier";
  const out: Record<string, string> = {};
  for (const [id, tier] of Object.entries(v)) {
    if (!/^[a-z0-9_-]{1,80}$/.test(id)) return "bad feature id";
    if (typeof tier !== "string" || !TIERS.includes(tier as never)) return `${id}: tier must be one of ${TIERS.join(", ")}`;
    out[id] = tier;
  }
  return Object.keys(out).length > 100 ? "too many features" : out;
}

async function lastComment(db: Env["DB"], user: string): Promise<number> {
  const r = await db.prepare("SELECT MAX(at) AS at FROM feature_comments WHERE user = ?").bind(user).first();
  return Number(r?.at ?? 0);
}

export async function featureRankRoutes(req: Request, env: Env, p: string[], user: string | null, now = Date.now()): Promise<Response | null> {
  const view = p[1] === "feature-ranks" && !p[2] && req.method === "GET";
  const rank = p[1] === "me" && p[2] === "feature-ranks" && !p[3] && req.method === "PUT";
  const comment = p[1] === "feature-comments" && !p[2] && req.method === "POST";
  if (!view && !rank && !comment) return null;
  if (view) {
    const { results: crowd } = await env.DB.prepare("SELECT feature, tier, COUNT(*) AS n FROM feature_ranks GROUP BY feature, tier").all();
    const scores: Record<string, { score: number; votes: number }> = {};
    for (const r of crowd as { feature: string; tier: string; n: number }[]) {
      const s = (scores[r.feature] ??= { score: 0, votes: 0 });
      s.score += POINTS[r.tier]! * r.n;
      s.votes += r.n;
    }
    for (const s of Object.values(scores)) s.score = Math.round((s.score / s.votes) * 100) / 100;
    const mine: Record<string, string> = {};
    if (user) for (const r of ((await env.DB.prepare("SELECT feature, tier FROM feature_ranks WHERE user = ?").bind(user).all<{ feature: string; tier: string }>()).results)) mine[r.feature] = r.tier;
    const { results: said } = await env.DB.prepare("SELECT user, text, at FROM feature_comments ORDER BY at DESC, id DESC LIMIT ?").bind(SHOWN).all();
    const next = user ? Math.max(0, (await lastComment(env.DB, user)) + COMMENT_GAP_MS) : 0;
    return json({ signed_in: !!user, scores, mine, comments: said, comment_after: next > now ? next : 0 });
  }
  if (!user) return json({ error: "sign in to rank the features" }, 401);
  const body = await readBody<"tiers" | "text">(req);
  if (rank) {
    const tiers = parseTiers(body.tiers);
    if (typeof tiers === "string") return json({ error: tiers }, 400);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM feature_ranks WHERE user = ?").bind(user),
      ...Object.entries(tiers).map(([f, t]) => env.DB.prepare("INSERT INTO feature_ranks (user, feature, tier, at) VALUES (?, ?, ?, ?)").bind(user, f, t, now)),
    ]);
    return json({ tiers });
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 280) : "";
  if (!text) return json({ error: "write something first" }, 400);
  const wait = (await lastComment(env.DB, user)) + COMMENT_GAP_MS - now;
  if (wait > 0) return json({ error: `thanks for the enthusiasm! Another comment in ${Math.ceil(wait / 60_000)} min.`, comment_after: now + wait }, 429, { "retry-after": String(Math.ceil(wait / 1000)) });
  await env.DB.prepare("INSERT INTO feature_comments (user, text, at) VALUES (?, ?, ?)").bind(user, text, now).run();
  return json({ user, text, at: now, comment_after: now + COMMENT_GAP_MS }, 201);
}
