// Layout: protect main (#1426): an owner setting that keeps crew and agents off main.
// With it on, crew (people and agents) edit on branches only, an agent's batch waits for a
// person instead of a timer, and a branch is merged by someone other than its author.
// The owner's own work on main is untouched.
//
//   GET|PUT /api/repos/:o/:r/protect   {on: boolean}  (PUT: owner only)
import { json, type Env } from "./env.ts";

export async function protectOn(env: Env, owner: string, repo: string): Promise<boolean> {
  const r = await env.DB.prepare("SELECT on_ FROM protect_main WHERE owner = ? AND repo = ?").bind(owner, repo).first();
  return !!r?.on_;
}

/** An error response when `user` may not write main directly here, else null. */
export async function mainClosed(env: Env, owner: string, repo: string, user: string | null | undefined): Promise<Response | null> {
  if (user === owner || !(await protectOn(env, owner, repo))) return null;
  return json({ error: "main is protected: edit on a branch, and the owner merges it", protected: true }, 403);
}

export async function protectRoute(req: Request, env: Env, owner: string, repo: string, user: string | null): Promise<Response> {
  if (req.method === "GET") return json({ on: await protectOn(env, owner, repo) });
  if (req.method !== "PUT") return json({ error: "GET or PUT" }, 405);
  if (user !== owner) return json({ error: "only the owner protects main" }, 403);
  const b = await req.json().catch(() => ({})) as { on?: unknown };
  if (typeof b.on !== "boolean") return json({ error: "{on: true|false}, please" }, 400);
  await env.DB.prepare("INSERT INTO protect_main (owner, repo, on_) VALUES (?, ?, ?) ON CONFLICT (owner, repo) DO UPDATE SET on_ = excluded.on_").bind(owner, repo, b.on ? 1 : 0).run();
  return json({ on: b.on });
}
