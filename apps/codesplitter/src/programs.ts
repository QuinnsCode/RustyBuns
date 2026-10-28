// Saved programs for code mode (codemode.ts): an agent names an `execute` program that worked and runs it
// again later, so a claim/edit/release loop is not written out each time. Kept per person; a program runs as
// whichever of their tokens asks for it, so it has no more reach than the agent that saved it.
//   GET    /api/me/programs          [{name, description, updated_at}]
//   PUT    /api/me/programs/:name    {code, description?}: save, or replace the one with that name
//   GET    /api/me/programs/:name    {name, description, code, updated_at}
//   DELETE /api/me/programs/:name
// `execute` takes { program: name, input? } in place of code; the program reads its `input`.

import { json, need, readBody, type Env } from "./env.ts";
import { obj, str } from "@rustybuns/util/guard";

export const MAX_PROGRAMS = 50;
const MAX_CODE = 64_000;
const NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export async function programRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] !== "me" || p[2] !== "programs" || p[4]) return null;
  if (!user) return json({ error: "sign in first" }, 401);
  const name = p[3];
  if (!name) {
    if (req.method !== "GET") return null;
    const { results } = await env.DB.prepare("SELECT name, description, updated_at FROM programs WHERE owner = ? ORDER BY name").bind(user).all();
    return json(results);
  }
  if (req.method === "GET") {
    const row = await env.DB.prepare("SELECT name, description, code, updated_at FROM programs WHERE owner = ? AND name = ?").bind(user, name).first();
    return row ? json(row) : json({ error: `no saved program ${name}` }, 404);
  }
  if (req.method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM programs WHERE owner = ? AND name = ?").bind(user, name).run();
    return r.meta?.changes ? json({ ok: true }) : json({ error: `no saved program ${name}` }, 404);
  }
  if (req.method !== "PUT") return null;
  if (!NAME.test(name)) return json({ error: "name: lower-case letters, digits, - and _, up to 48, starting with a letter or digit" }, 400);
  const b = need(await readBody(req), obj({ code: str(MAX_CODE, { re: /\S/ }), description: str(300, { min: 0, dflt: "" }) }),
    `code is required: the body of an async function, up to ${MAX_CODE.toLocaleString("en")} characters`);
  if (b instanceof Response) return b;
  const { description } = b;
  const had = await env.DB.prepare("SELECT 1 AS x FROM programs WHERE owner = ? AND name = ?").bind(user, name).first();
  if (!had) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM programs WHERE owner = ?").bind(user).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_PROGRAMS) return json({ error: `at most ${MAX_PROGRAMS} saved programs: delete one first` }, 409);
  }
  const at = Date.now();
  await env.DB.prepare("INSERT INTO programs (owner, name, description, code, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner, name) DO UPDATE SET description = excluded.description, code = excluded.code, updated_at = excluded.updated_at")
    .bind(user, name, description, b.code, at).run();
  return json({ name, description, updated_at: at }, had ? 200 : 201);
}
