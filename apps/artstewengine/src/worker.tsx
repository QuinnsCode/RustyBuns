import { env } from "cloudflare:workers";
import { except, render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { Admin, ErrorPage, Login } from "./app/pages.tsx";
import { Document } from "./app/Document.tsx";
import { adminOf, authOn, needsSetup } from "./auth.ts";
import { handle } from "./handle.ts";
import { listLicenses, metrics } from "./licenses.ts";
import type { Env as AppEnv } from "./env.ts";
import initSql from "../migrations/0001_init.sql?raw";

// vite dev gives the Worker the production BETTER_AUTH_URL and no secrets: on the dev server the request's
// own origin is the trusted one, and throwaway secrets let `bun run dev` sign in as admin@artstew.local.
const e = (req?: Request): AppEnv => {
  const base = env as unknown as AppEnv;
  if (!import.meta.env.VITE_IS_DEV_SERVER || !req) return base;
  return { ...base, BETTER_AUTH_URL: new URL(req.url).origin, BETTER_AUTH_SECRET: base.BETTER_AUTH_SECRET ?? "dev-only-secret-never-in-production-0000", ADMIN_EMAIL: base.ADMIN_EMAIL ?? "admin@artstew.local", ENGINE_KEY: base.ENGINE_KEY ?? btoa("dev-only-engine-key-32-bytes-long!") };
};

// vite dev's local D1 starts empty; the first request applies the migration itself. Deploys run it through Alchemy.
let migrated: Promise<unknown> | undefined;
const devMigrate = (db: AppEnv["DB"]) => (migrated ??= db.batch(
  initSql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").split(/;\s*\n/)
    .map((q) => q.trim()).filter(Boolean)
    .map((q) => q.replace(/^create (table|index|unique index) /i, "create $1 if not exists "))
    .map((q) => db.prepare(q)),
));

const app = defineApp([
  ({ response }) => {
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  },
  async ({ request }) => {
    if (import.meta.env.VITE_IS_DEV_SERVER) await devMigrate(e().DB);
    return (await handle(request, e(request))) ?? undefined;
  },
  except((error, { response }) => {
    console.error("artstewengine:", String((error as Error)?.message ?? error));
    response.status = 500;
    return <ErrorPage status={500} />;
  }),
  render(Document, [
    route("/", () => new Response(null, { status: 302, headers: { location: "/admin" } })),
    route("/login", async ({ request, response }) => {
      const conf = e(request);
      if (!authOn(conf)) { response.status = 503; return <ErrorPage status={503} />; }
      if (await adminOf(request, conf)) return new Response(null, { status: 302, headers: { location: "/admin" } });
      return <Login setup={await needsSetup(conf)} error={new URL(request.url).searchParams.get("e") ?? undefined} />;
    }),
    route("/admin", async ({ request, response }) => {
      const conf = e(request);
      if (!authOn(conf)) { response.status = 503; return <ErrorPage status={503} />; }
      const admin = await adminOf(request, conf);
      if (!admin) return new Response(null, { status: 302, headers: { location: "/login" } });
      const licenses = await listLicenses(conf), now = Date.now(), q = new URL(request.url).searchParams;
      return <Admin email={admin.email} licenses={licenses} m={await metrics(conf, licenses, now)} error={q.get("e") ?? undefined} made={q.has("made")} now={now} />;
    }),
    route("/*", ({ response }) => { response.status = 404; return <ErrorPage status={404} />; }),
  ]),
]);

export default { fetch: app.fetch };
