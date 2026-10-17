import { env } from "cloudflare:workers";
import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { handleApi, handleQueue } from "./api.ts";
import { Document } from "./app/Document.tsx";
import { setCommonHeaders } from "./app/headers.ts";
import { App } from "./app/pages/App.tsx";
import { Demo } from "./app/pages/Demo.tsx";
import { Home } from "./app/pages/Home.tsx";
import { Privacy } from "./app/pages/Privacy.tsx";
import { hourly } from "./demo.ts";
import { VERSION, type Env as AppEnv } from "./env.ts";

// vite dev hands the Worker the production BETTER_AUTH_URL from wrangler.jsonc and no secret; on the
// dev server the request's own origin is the trusted one and a throwaway secret signs sessions.
const e = (req?: Request): AppEnv => {
  const base = env as unknown as AppEnv;
  if (!import.meta.env.VITE_IS_DEV_SERVER || !req) return base;
  return { ...base, BETTER_AUTH_URL: new URL(req.url).origin, BETTER_AUTH_SECRET: base.BETTER_AUTH_SECRET ?? "dev-only-secret-never-in-production-0000" };
};

// Pages are the same for everyone, so the edge keeps them: a visit costs no Worker time
// until the minute is up. Every /api answer is no-store (env.ts); rows never sit in a cache.
const cached = (body: string, type: string) =>
  new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=60, s-maxage=86400, stale-while-revalidate=86400" } });

const app = defineApp([
  setCommonHeaders(),
  route("/api/*", ({ request }) => handleApi(request, e(request))),
  route("/robots.txt", () => cached("User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api\nSitemap: /sitemap.xml\n", "text/plain")),
  route("/sitemap.xml", ({ request }) => {
    const o = new URL(request.url).origin;
    const urls = ["/", "/demo", "/privacy"].map((p) => `<url><loc>${o}${p}</loc></url>`).join("");
    return cached(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, "application/xml");
  }),
  route("/version", () => cached(`qCRM-v${VERSION.replaceAll(".", "")}\n`, "text/plain")),
  render(Document, [
    route("/", () => <Home />),
    route("/demo", () => <Demo />),
    route("/privacy", () => <Privacy />),
    route("/app", () => <App />),
    route("/app/*", () => <App />),
  ]),
]);

export default {
  fetch: app.fetch,
  queue: (batch) => handleQueue(batch as never, e()),
  // On the hour: demo orgs older than a day go, dead webhook deliveries are swept.
  scheduled: () => hourly(e()),
} satisfies ExportedHandler<Env>;
