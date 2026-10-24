// Thick borg, story 1: a small notes API on Postgres, written the way a Node app on Neon would
// be (postgres.js over a connection string). The same file runs on the edge through Hyperdrive,
// on the desktop against PGlite, and on a box against the real URL. src/suite.ts checks it.
import postgres from "postgres";

interface Env { HYPERDRIVE: { connectionString: string } }

const json = (v: unknown, status = 200) => Response.json(v, { status });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return new Response("borg-postgres");
    // One client per request, as Hyperdrive wants; it pools on its side.
    const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
    try {
      return await route(sql, req, url);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    } finally {
      await sql.end({ timeout: 1 });
    }
  },
};

async function route(sql: postgres.Sql, req: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  // The database is the app's own, so it makes its tables. Idempotent: safe on every deploy.
  if (path === "/api/setup" && req.method === "POST") {
    await sql`create table if not exists notes (
      id serial primary key, owner text not null, body text not null,
      tags text[] not null default '{}', meta jsonb not null default '{}', created_at timestamptz not null default now())`;
    await sql`create table if not exists counters (name text primary key, n integer not null)`;
    return json({ ok: true });
  }
  if (path === "/api/notes" && req.method === "POST") {
    const b: { owner?: unknown; body?: unknown; tags?: unknown; meta?: unknown } = await req.json().catch(() => null) ?? {};
    const { owner, body, tags = [], meta = {} } = b;
    if (typeof owner !== "string" || typeof body !== "string") return json({ error: "send { owner, body } as strings" }, 400);
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) return json({ error: "tags is a list of strings" }, 400);
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return json({ error: "meta is an object" }, 400);
    const [row] = await sql`insert into notes (owner, body, tags, meta) values (${owner}, ${body}, ${pgArray(tags as string[])}::text[], ${sql.json(meta as Parameters<typeof sql.json>[0])}) returning id, to_json(tags) as tags, meta`;
    return json(row, 201);
  }
  if (path === "/api/notes" && req.method === "GET") {
    const rows = await sql`select id, body, to_json(tags) as tags, meta from notes where owner = ${url.searchParams.get("owner") ?? ""} order by id`;
    return json(rows);
  }
  // Both inserts in one transaction; the second fails, so neither stays.
  if (path === "/api/rollback" && req.method === "POST") {
    const owner = url.searchParams.get("owner") ?? "";
    try {
      await sql.begin(async (tx) => {
        await tx`insert into notes (owner, body) values (${owner}, 'first')`;
        await tx`insert into notes (owner, body) values (${owner}, ${null})`;   // not null: fails
      });
    } catch { /* expected */ }
    const [{ n }] = await sql`select count(*)::int as n from notes where owner = ${owner}`;
    return json({ left: n });
  }
  // An upsert that counts, so concurrent requests must add up.
  if (path === "/api/count" && req.method === "POST") {
    const [row] = await sql`insert into counters (name, n) values (${url.searchParams.get("name") ?? ""}, 1)
      on conflict (name) do update set n = counters.n + 1 returning n`;
    return json(row);
  }
  return json({ error: "not found" }, 404);
}

// text[] as a Postgres array literal. With no type lookup the client can't serialize an array itself,
// and the cast says what it is; to_json reads it back as an array too.
const pgArray = (xs: string[]) => `{${xs.map((x) => `"${x.replace(/[\\"]/g, "\\$&")}"`).join(",")}}`;
