// The hidden games and rooms: find all of them and your profile wears a badge.
//   PUT /api/me/finds {key}        you found one (signed in; a key that isn't a hidden spot is a 400)
//   GET /api/users/:name/finds     {count, total, all, found?}: how many they found, and `all` when the badge is theirs;
//                                  `found` (which ones) is only for the person themselves
// The keys are what the client reports: the three backrooms modes, the unicycle on a file's history, the city,
// the bartender in it, and a profile page.

import { json, readBody, type Env } from "./env.ts";

export const SPOTS = ["horde", "wreck", "removed", "unicycle", "city", "bartender", "page"] as const;

export async function findRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] === "me" && p[2] === "finds" && !p[3] && req.method === "PUT") {
    if (!user) return json({ error: "sign in first" }, 401);
    const b = await readBody<"key">(req);
    if (!SPOTS.includes(b.key as (typeof SPOTS)[number])) return json({ error: `key: one of ${SPOTS.join(", ")}` }, 400);
    await env.DB.prepare("INSERT OR IGNORE INTO finds (name, key, at) VALUES (?, ?, ?)").bind(user, b.key, Date.now()).run();
    return json({ ok: true, ...(await findsOf(env, user, true)) });
  }
  if (p[1] === "users" && p[2] && p[3] === "finds" && !p[4] && req.method === "GET") return json(await findsOf(env, p[2], p[2] === user));
  return null;
}

async function findsOf(env: Env, name: string, self: boolean) {
  const { results } = await env.DB.prepare("SELECT key FROM finds WHERE name = ?").bind(name).all();
  const found = (results as { key: string }[]).map((r) => r.key).filter((k) => SPOTS.includes(k as (typeof SPOTS)[number]));
  return { count: found.length, total: SPOTS.length, all: found.length === SPOTS.length, ...(self && { found }) };
}
