import { env } from "cloudflare:workers";
import { except, render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { ErrorPage, Home, Login } from "./app/pages.tsx";
import { Document } from "./app/Document.tsx";
import { authOn, isAdmin, meOf, providers } from "./auth.ts";
import { askOf, atHome, handle } from "./handle.ts";
import { hubAsk } from "./hub.ts";
import { link, members } from "./members.ts";
import { newKey } from "@rustybuns/util/token";
import type { Env as AppEnv } from "./env.ts";
import initSql from "../migrations/0001_init.sql?raw";

// vite dev gives the Worker the production BETTER_AUTH_URL and no secret: on the dev server the request's own
// origin is the trusted one, a throwaway secret signs sessions, a throwaway key signs tokens, loopback return
// URLs are allowed, and admin@eqosys.local is the super admin.
let devKey: string | undefined;
const e = (req?: Request): AppEnv => {
  const base = env as unknown as AppEnv;
  if (!import.meta.env.VITE_IS_DEV_SERVER || !req) return base;
  return {
    ...base, BETTER_AUTH_URL: new URL(req.url).origin, BETTER_AUTH_SECRET: base.BETTER_AUTH_SECRET ?? "dev-only-secret-never-in-production-0000",
    SUPER_ADMIN_EMAIL: base.SUPER_ADMIN_EMAIL ?? "admin@eqosys.local", EQOSYS_SIGNING_KEY: base.EQOSYS_SIGNING_KEY ?? devKey, LOOPBACK_RETURNS: base.LOOPBACK_RETURNS ?? "1",
  };
};

// vite dev's local D1 starts empty; the first request applies the migration itself. Deploys run it through Alchemy.
let migrated: Promise<unknown> | undefined;
const devMigrate = (db: AppEnv["DB"]) => (migrated ??= db.batch(
  initSql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").split(/;\s*\n/)
    .map((q) => q.trim()).filter(Boolean)
    .map((q) => q.replace(/^create (table|index|unique index) /i, "create $1 if not exists "))
    .map((q) => db.prepare(q)),
));

const see = (to: string) => new Response(null, { status: 302, headers: { location: to } });

const app = defineApp([
  ({ response }) => {
    response.headers.set("X-Content-Type-Options", "nosniff");
    // same-origin, not no-referrer: no-referrer makes a browser send Origin: null on our own form posts, which crossSite refuses.
    response.headers.set("Referrer-Policy", "same-origin");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Cache-Control", "no-store");
    // No form-action: Continue's 303 goes on to the app's own origin, and the social buttons to the provider.
    response.headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  },
  async ({ request }) => {
    if (import.meta.env.VITE_IS_DEV_SERVER) { await devMigrate(e().DB); devKey ??= await newKey(); }
    return (await handle(request, e(request))) ?? undefined;
  },
  except((error, { response }) => {
    console.error("eqosys:", String((error as Error)?.message ?? error));
    response.status = 500;
    return <ErrorPage status={500} />;
  }),
  render(Document, [
    route("/", async ({ request, response }) => {
      const conf = e(request);
      if (!authOn(conf)) { response.status = 503; return <ErrorPage status={503} />; }
      const me = await meOf(request, conf);
      if (!me) return see("/login");
      await link(conf, me.id, null);
      const [mine] = await members(conf, me.id);
      const hub = conf.HUB ? await hubAsk(conf.HUB, atHome(me), { op: "state" }) : null;
      return <Home me={me} mine={mine} hub={hub && !("error" in hub) ? hub : null} everyone={isAdmin(me, conf) ? await members(conf) : null}
        error={new URL(request.url).searchParams.get("e") ?? undefined} />;
    }),
    route("/login", async ({ request, response }) => {
      const conf = e(request);
      if (!authOn(conf)) { response.status = 503; return <ErrorPage status={503} />; }
      const q = new URL(request.url).searchParams;
      const ask = askOf((k) => q.get(k), conf);
      const me = await meOf(request, conf);
      if (me && !ask) return see("/");
      return <Login ask={ask === "bad" ? null : ask} me={me} social={providers(conf)} error={ask === "bad" ? "app" : q.get("e") ?? undefined} />;
    }),
    route("/*", ({ response }) => { response.status = 404; return <ErrorPage status={404} />; }),
  ]),
]);

export { Hub } from "./hub.ts";
export default { fetch: app.fetch };
