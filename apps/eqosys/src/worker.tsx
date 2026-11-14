import { env } from "cloudflare:workers";
import { except, render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { AppPage, Deleted, DeletePage, ErrorPage, Home, Privacy, SpacesPage, tabOf } from "./app/pages.tsx";
import { Login } from "./app/Login.tsx";
import { phaseAt } from "./app/Sky.tsx";
import { THEME_SCRIPT } from "./app/Theme.tsx";
import { appOf, appsOf, mayUse } from "./listings.ts";
import { Document } from "./app/Document.tsx";
import { authOn, isAdmin, meOf, onApple, providers, waysOf } from "./auth.ts";
import { askOf, atHome, handle, invitedBy } from "./handle.ts";
import { edge } from "./codemode.ts";
import { bridgeCall } from "./tools.ts";
import { hubAsk } from "./qollab/hub.ts";
import { sideOf } from "./qollab/side.ts";
import { link, members } from "./members.ts";
import { countsOf, unlocksOf } from "./achievements.ts";
import { newKey } from "@rustybuns/util/token";
import type { Env as AppEnv } from "./env.ts";
import initSql from "../migrations/0001_init.sql?raw";
import oauthSql from "../migrations/0002_oauth.sql?raw";
import reportsSql from "../migrations/0003_reports.sql?raw";
import savesSql from "../migrations/0004_saves.sql?raw";
import seatsSql from "../migrations/0004_party_seats.sql?raw";
import unlocksSql from "../migrations/0006_achievements.sql?raw";
import spacesSql from "../migrations/0007_spaces.sql?raw";
import privacySql from "../migrations/0008_privacy.sql?raw";
import visitsSql from "../migrations/0009_visits.sql?raw";
import studiosSql from "../migrations/20261106000000_studios.sql?raw";
import deploysSql from "../migrations/20261107000000_deploys.sql?raw";
import listingsSql from "../migrations/20261109000000_listings.sql?raw";
import studioReportsSql from "../migrations/20261111000000_studio_reports.sql?raw";
import studioSpacesSql from "../migrations/20261113000000_studio_spaces.sql?raw";
import { house, studiosOf } from "./studios.ts";
import { markStaff, tally, visitorsOf } from "./visitors.ts";
import { loadOf } from "./scale.ts";
import { regionAt } from "@rustybuns/util/privacy";
import { pageCsp, spacesConnect } from "./csp.ts";

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
  for (const q of [initSql, oauthSql, reportsSql, savesSql, seatsSql, unlocksSql, spacesSql, privacySql, visitsSql, studiosSql, deploysSql, listingsSql, studioReportsSql, studioSpacesSql].join("\n").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").split(/;\s*\n/)
    .map((q) => q.trim().replace(/;$/, "")).filter(Boolean)
    .map((q) => q.replace(/^create (table|index|unique index) /i, "create $1 if not exists ")))
    await db.prepare(q).run().catch((err: unknown) => { if (!/duplicate column/i.test(String(err))) throw err; });
})());

// The sky switch's inline script is allowed by its hash, and the commands' module script (app/commands.client.ts,
// with the palette and the WebMCP tools) by the nonce rwsdk puts on it, so the CSP still lets nothing else run.
let scriptSrc: Promise<string> | undefined;
const hashOf = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((d) => `'sha256-${btoa(String.fromCharCode(...new Uint8Array(d)))}'`);
const themeHash = () => (scriptSrc ??= hashOf(THEME_SCRIPT));

const see = (to: string) => new Response(null, { status: 302, headers: { location: to } });

const app = defineApp([
  async ({ request, response, rw }) => {
    response.headers.set("X-Content-Type-Options", "nosniff");
    // same-origin, not no-referrer: no-referrer makes a browser send Origin: null on our own form posts, which crossSite refuses.
    response.headers.set("Referrer-Policy", "same-origin");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Cache-Control", "no-store");
    // No form-action: Continue's 303 goes on to the app's own origin, and the social buttons to the provider.
    // Nothing leaves the page but the sign-in page's fonts, and /spaces' voice (csp.ts).
    response.headers.set("Content-Security-Policy", pageCsp(`${await themeHash()} 'nonce-${rw.nonce}'`, new URL(request.url).pathname === "/spaces" ? spacesConnect(e(request)) : undefined));
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
      const tab = tabOf(new URL(request.url).searchParams.get("tab"));
      // Everything the page shows, read at once. Your spaces and party sit beside the library alone.
      const [, [mine], hub, unlocks, everyone, , side] = await Promise.all([
        link(conf, me.id, null, regionAt(request)), members(conf, me.id), conf.HUB ? hubAsk(conf.HUB, atHome(me), { op: "state" }) : null,
        unlocksOf(conf, me.id), isAdmin(me, conf) ? members(conf) : null, isAdmin(me, conf) ? house(conf, me.id) : null,
        tab === "library" ? sideOf(conf, me.id).catch(() => null) : null,
      ]);
      const invite = tab === "friends" ? await invitedBy(request, conf) : null;
      const ways = tab === "account" ? await waysOf(request, conf) : null;
      const shown = hub && !("error" in hub) ? hub : null;
      // The super admin's own visits stay out of the counts; the Visitors tab is theirs alone.
      const [counts, visitors, studios, apps] = await Promise.all([countsOf(conf, shown?.friends.map((f) => f.id) ?? []),
        everyone ? markStaff(conf, request).then(() => tab === "visitors" ? visitorsOf(conf, Number(new URL(request.url).searchParams.get("days")) || 7) : null) : null,
        tab === "studio" ? studiosOf(conf, me.id) : null, appsOf(conf)]);
      return <Home ways={ways} social={providers(conf)} invite={invite} origin={new URL(request.url).origin} apps={apps} visitors={visitors} counts={counts} t0={phaseAt(new URL(request.url).searchParams.get("at"))} me={me} mine={mine} hub={shown} side={side} everyone={everyone} unlocks={unlocks}
        error={new URL(request.url).searchParams.get("e") ?? undefined} tab={tab} studios={studios}
        scale={everyone && tab === "scale" ? loadOf(new URL(request.url).searchParams) : null} />;
    }),
    route("/spaces", async ({ request, response }) => {
      const conf = e(request);
      if (!authOn(conf)) { response.status = 503; return <ErrorPage status={503} />; }
      if (!await meOf(request, conf)) return see("/login");
      return <SpacesPage t0={phaseAt(new URL(request.url).searchParams.get("at"))} />;
    }),
    route("/app/:id", async ({ request, params, response }) => {
      const conf = e(request);
      if (!authOn(conf)) { response.status = 503; return <ErrorPage status={503} />; }
      const me = await meOf(request, conf), found = await appOf(conf, params.id), app = found && me && await mayUse(conf, found, me.id) ? found : undefined;
      if (!me) return see("/login");
      if (!app) { response.status = 404; return <ErrorPage status={404} />; }
      const [[mine], unlocks] = await Promise.all([members(conf, me.id), unlocksOf(conf, me.id)]);
      return <AppPage app={app} mine={mine?.apps.find((a) => a.app === app.id)} unlocks={unlocks} t0={phaseAt(new URL(request.url).searchParams.get("at"))} />;
    }),
    route("/login", async ({ request, response }) => {
      const conf = e(request);
      if (!authOn(conf)) { response.status = 503; return <ErrorPage status={503} />; }
      const q = new URL(request.url).searchParams;
      const ask = await askOf((k) => q.get(k), conf);
      const me = await meOf(request, conf);
      if (me && !ask) return see("/");
      const apple = onApple(request.headers.get("user-agent"));
      // Someone who opened a friend link (handle.ts /add) is told whose, and a new person is shown the new-account form first.
      const friend = ask ? null : (await invitedBy(request, conf))?.name;
      return <Login friend={friend ?? undefined} ask={ask === "bad" ? null : ask} me={me} social={providers(conf, apple)} appleTop={apple} error={ask === "bad" ? "app" : q.get("e") ?? undefined} t0={phaseAt(q.get("at"))} />;
    }),
    route("/delete", async ({ request, response }) => {
      const conf = e(request);
      if (!authOn(conf)) { response.status = 503; return <ErrorPage status={503} />; }
      const me = await meOf(request, conf), q = new URL(request.url).searchParams;
      if (!me) return see("/login?e=in");
      return <DeletePage me={me} app={q.get("app") ?? undefined} error={q.get("e") ?? undefined} step={q.get("step") ?? undefined} />;
    }),
    route("/privacy", () => <Privacy />),
    route("/deleted", ({ request }) => <Deleted app={new URL(request.url).searchParams.get("app") ?? undefined} />),
    route("/*", ({ response }) => { response.status = 404; return <ErrorPage status={404} />; }),
  ]),
]);

// Hub, Party and Space live in Qollab's Worker (apps/qollab, #3816); this one binds them there. The Vault stays: privacy is eqosys's.
export { Vault } from "./vault.ts";
// The EQ binding of an eq_execute program (codemode.ts): a stub of this class, made for the caller, runs each tool call as them.
const cf = await import("cloudflare:workers").then((m) => m as unknown as { WorkerEntrypoint: new (ctx: unknown, env: unknown) => { env: unknown; ctx: { props: unknown } }; exports: Record<string, ((o: { props: unknown }) => unknown) | undefined> });
export class EQBridge extends cf.WorkerEntrypoint {
  call(name: string, json: string) { return bridgeCall(this.env as AppEnv, this.ctx.props, name, json); }
}
edge.stub = (props) => cf.exports.EQBridge?.({ props });
// Every answered request is counted for the Visitors tab (visitors.ts), written a second later off the answer's path.
type Ctx = { waitUntil(p: Promise<unknown>): void };
export default {
  async fetch(req: Request, env: unknown, ctx: Ctx) {
    const res = await (app.fetch as (r: Request, e: unknown, c: Ctx) => Promise<Response>)(req, env, ctx);
    ctx.waitUntil(Promise.resolve(tally(e(req), req, res.status, (p) => ctx.waitUntil(p))).catch(() => undefined));
    return res;
  },
};
