import { env } from "cloudflare:workers";
import { except, render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { Deleted, DeletePage, ErrorPage, Home, tabOf } from "./app/pages.tsx";
import { Login } from "./app/Login.tsx";
import { phaseAt } from "./app/Sky.tsx";
import { THEME_SCRIPT } from "./app/Theme.tsx";
import { Document } from "./app/Document.tsx";
import { authOn, isAdmin, meOf, providers } from "./auth.ts";
import { askOf, atHome, handle } from "./handle.ts";
import { hubAsk } from "./hub.ts";
import { link, members } from "./members.ts";
import { newKey } from "@rustybuns/util/token";
import type { Env as AppEnv } from "./env.ts";
import initSql from "../migrations/0001_init.sql?raw";
import oauthSql from "../migrations/0002_oauth.sql?raw";

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

// vite dev's local D1 starts empty; the first request applies the migrations itself. Deploys run them through Alchemy.
// One statement at a time, so a column added on an earlier run ("duplicate column") doesn't stop the rest.
let migrated: Promise<unknown> | undefined;
const devMigrate = (db: AppEnv["DB"]) => (migrated ??= (async () => {
  for (const q of [initSql, oauthSql].join("\n").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").split(/;\s*\n/)
    .map((q) => q.trim().replace(/;$/, "")).filter(Boolean)
    .map((q) => q.replace(/^create (table|index|unique index) /i, "create $1 if not exists ")))
    await db.prepare(q).run().catch((err: unknown) => { if (!/duplicate column/i.test(String(err))) throw err; });
})());

// The sky switch's one inline script is allowed by its hash, so the CSP still lets nothing else run.
let scriptSrc: Promise<string> | undefined;
const themeHash = () => (scriptSrc ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(THEME_SCRIPT))
  .then((d) => `'sha256-${btoa(String.fromCharCode(...new Uint8Array(d)))}'`));

const see = (to: string) => new Response(null, { status: 302, headers: { location: to } });

const app = defineApp([
  async ({ response }) => {
    response.headers.set("X-Content-Type-Options", "nosniff");
    // same-origin, not no-referrer: no-referrer makes a browser send Origin: null on our own form posts, which crossSite refuses.
    response.headers.set("Referrer-Policy", "same-origin");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Cache-Control", "no-store");
    // No form-action: Continue's 303 goes on to the app's own origin, and the social buttons to the provider.
    // The two Google Fonts hosts are for the sign-in page's type (Login.tsx); nothing else leaves the page.
    response.headers.set("Content-Security-Policy", `default-src 'none'; img-src 'self'; script-src ${await themeHash()}; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'`);
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
      return <Home t0={phaseAt(new URL(request.url).searchParams.get("at"))} me={me} mine={mine} hub={hub && !("error" in hub) ? hub : null} everyone={isAdmin(me, conf) ? await members(conf) : null}
        error={new URL(request.url).searchParams.get("e") ?? undefined} tab={tabOf(new URL(request.url).searchParams.get("tab"))} />;
    }),
    route("/login", async ({ request, response }) => {
      const conf = e(request);
      if (!authOn(conf)) { response.status = 503; return <ErrorPage status={503} />; }
      const q = new URL(request.url).searchParams;
      const ask = askOf((k) => q.get(k), conf);
      const me = await meOf(request, conf);
      if (me && !ask) return see("/");
      return <Login ask={ask === "bad" ? null : ask} me={me} social={providers(conf)} error={ask === "bad" ? "app" : q.get("e") ?? undefined} t0={phaseAt(q.get("at"))} />;
    }),
    route("/delete", async ({ request, response }) => {
      const conf = e(request);
      if (!authOn(conf)) { response.status = 503; return <ErrorPage status={503} />; }
      const me = await meOf(request, conf), q = new URL(request.url).searchParams;
      if (!me) return see("/login?e=in");
      return <DeletePage me={me} app={q.get("app") ?? undefined} error={q.get("e") ?? undefined} step={q.get("step") ?? undefined} />;
    }),
    route("/deleted", ({ request }) => <Deleted app={new URL(request.url).searchParams.get("app") ?? undefined} />),
    route("/*", ({ response }) => { response.status = 404; return <ErrorPage status={404} />; }),
  ]),
]);

export { Hub } from "./hub.ts";
export default { fetch: app.fetch };
