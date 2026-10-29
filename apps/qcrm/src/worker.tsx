import { env } from "cloudflare:workers";
import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { handleApi, handleQueue } from "./api.ts";
import { Document } from "./app/Document.tsx";
import { setCommonHeaders } from "./app/headers.ts";
import { App } from "./app/pages/App.tsx";
import { Demo } from "./app/pages/Demo.tsx";
import { Home } from "./app/pages/Home.tsx";
import { NotFound } from "./app/pages/NotFound.tsx";
import { Privacy } from "./app/pages/Privacy.tsx";
import { hourly } from "./demo.ts";
import { VERSION, type Env as AppEnv } from "./env.ts";
const migrationFiles = import.meta.glob<string>("../migrations/*.sql", { eager: true, query: "?raw", import: "default" });

// vite dev hands the Worker the production BETTER_AUTH_URL from wrangler.jsonc and no secret; on the
// dev server the request's own origin is the trusted one and a throwaway secret signs sessions.
// The desktop app (a Bun twin on 127.0.0.1) gets the same URL and no secret: it also trusts the request's own
// origin (a loopback address never reaches the edge, and a launch token gates the port), and signs sessions with a
// random secret made on first run and kept in its own database, so org ids (hashed with it) survive restarts.
const loopback = (req: Request) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(req.url).hostname);
const deskSecret = (db: AppEnv["DB"]) => (secret ??= (async () => {
  const fresh = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  await db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('session_secret', ?)").bind(fresh).run();
  return (await db.prepare("SELECT value FROM meta WHERE key = 'session_secret'").first<{ value: string }>())!.value;
})());
let secret: Promise<string> | undefined;
const e = async (req?: Request): Promise<AppEnv> => {
  const base = env as unknown as AppEnv;
  if (!req) return base;
  if (import.meta.env.VITE_IS_DEV_SERVER) return { ...base, BETTER_AUTH_URL: new URL(req.url).origin, BETTER_AUTH_SECRET: base.BETTER_AUTH_SECRET ?? "dev-only-secret-never-in-production-0000" };
  if (!loopback(req)) return base;
  return { ...base, BETTER_AUTH_URL: new URL(req.url).origin, BETTER_AUTH_SECRET: base.BETTER_AUTH_SECRET || await deskSecret(base.DB) };
};

// vite dev's local D1 starts empty; the first API call applies every migration itself, so `bun run dev`
// needs no wrangler step. Deploys run migrations through Alchemy (rustybuns.config.ts).
let migrated: Promise<unknown> | undefined;
const devMigrate = (db: AppEnv["DB"]) => (migrated ??= (async () => {
  for (const file of Object.keys(migrationFiles).sort()) {
    const queries = migrationFiles[file]!.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").split(/;\s*\n/)
      .map((q) => q.trim()).filter(Boolean)
      // Idempotent, so a half-applied local database (a dev server stopped mid-way) heals on the next call.
      .map((q) => q.replace(/^create (table|index|unique index) /i, "create $1 if not exists "));
    for (const q of queries) {
      try { await db.prepare(q).run(); } catch (err) { if (!/duplicate column/i.test(String(err))) throw err; }
    }
  }
})());

// Pages are the same for everyone, so the edge keeps them: a visit costs no Worker time
// until the minute is up. Every /api answer is no-store (env.ts); rows never sit in a cache.
const cached = (body: string, type: string) =>
  new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=60, s-maxage=86400, stale-while-revalidate=86400" } });

const app = defineApp([
  setCommonHeaders(),
  route("/api/*", async ({ request, cf }) => {
    if (import.meta.env.VITE_IS_DEV_SERVER) await devMigrate((await e()).DB);
    return handleApi(request, await e(request), (work) => cf.waitUntil(work));
  }),
  route("/.well-known/*", async ({ request }) => handleApi(request, await e(request))),
  route("/robots.txt", ({ request }) => cached(`User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api\nSitemap: ${new URL(request.url).origin}/sitemap.xml\n`, "text/plain")),
  route("/sitemap.xml", ({ request }) => {
    const o = new URL(request.url).origin;
    const urls = ["/", "/demo", "/privacy"].map((p) => `<url><loc>${o}${p}</loc></url>`).join("");
    return cached(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, "application/xml");
  }),
  route("/version", () => cached(`${VERSION}\n`, "text/plain")),
  render(Document, [
    route("/", () => <Home />),
    route("/demo", () => <Demo />),
    route("/privacy", () => <Privacy />),
    route("/app", () => <App />),
    route("/app/*", () => <App />),
    route("/*", ({ response }) => { response.status = 404; return <NotFound />; }),
  ]),
]);

export default {
  fetch: app.fetch,
  queue: async (batch: unknown) => handleQueue(batch as never, await e()),
  // On the hour: demo orgs older than a day go, dead webhook deliveries are swept.
  scheduled: async () => hourly(await e()),
};
