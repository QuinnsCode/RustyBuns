import { expect, setDefaultTimeout, test } from "bun:test";
import { applyD1Migrations, d1 } from "@rustybuns/shell-bun";
import { join } from "node:path";
import type { Env } from "../src/env.ts";
import { handle } from "../src/handle.ts";
import { challengeOf, members } from "../src/members.ts";

setDefaultTimeout(30_000);

const ORIGIN = "http://eqosys.local";
const ADMIN = "boss@example.com", PASSWORD = "correct horse battery";
const QCRM = "https://qcrm.qntbr.com", PARK = "https://park-hide-seek.notryanquinn.workers.dev";

async function boot() {
  const conf: Env = { DB: d1(":memory:") as never, BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: ORIGIN, SUPER_ADMIN_EMAIL: ADMIN };
  await applyD1Migrations(conf.DB as never, join(import.meta.dir, "../migrations"));
  const call = async (path: string, init: { form?: Record<string, string>; json?: unknown; cookie?: string; origin?: string } = {}) => {
    const headers = new Headers({ origin: init.origin ?? ORIGIN });
    if (init.cookie) headers.set("cookie", init.cookie);
    let body: BodyInit | undefined;
    if (init.form) body = new URLSearchParams(init.form);
    if (init.json !== undefined) { body = JSON.stringify(init.json); headers.set("content-type", "application/json"); }
    const res = (await handle(new Request(ORIGIN + path, { method: body ? "POST" : "GET", headers, body }), conf))!;
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return { res, cookie, to: res.headers.get("location") ?? "" };
  };
  return { conf, call };
}

/** What an app does: a verifier it keeps, and the ask it sends people to /login with. */
async function asks(app: string, origin: string) {
  const verifier = "v".repeat(20) + crypto.randomUUID().replaceAll("-", "");
  return { verifier, form: { app, return: `${origin}/signed-in`, challenge: await challengeOf(verifier), state: "s1" } };
}
const codeIn = (to: string) => new URL(to).searchParams.get("code")!;

test("one account across apps: sign up in a game, carry on into the suite, source and access follow", async () => {
  const { conf, call } = await boot();

  // Signs up through the game: back to the game's own page with a code and its state.
  const park = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...park.form, name: "Ada", email: "ada@example.com", password: PASSWORD } });
  expect(up.to.startsWith(`${PARK}/signed-in?`)).toBe(true);
  expect(new URL(up.to).searchParams.get("state")).toBe("s1");

  // The game trades it in, from its own page: who, where they came from, what they may do.
  const traded = await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: park.verifier }, origin: PARK });
  expect(traded.res.headers.get("access-control-allow-origin")).toBe(PARK);
  const who = await traded.res.json() as { user: { email: string; name: string }; source: string; access: string[] };
  expect(who).toMatchObject({ user: { email: "ada@example.com", name: "Ada" }, app: "park-hide-seek", source: "park-hide-seek", access: ["play"] });
  // A code is good once.
  expect((await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: park.verifier } })).res.status).toBe(400);

  // Later, qCRM sends her over; already signed in, she presses Continue. Her source stays the game.
  const crm = await asks("qcrm", QCRM);
  const on = await call("/do/continue", { form: crm.form, cookie: up.cookie });
  expect(on.to.startsWith(`${QCRM}/signed-in?`)).toBe(true);
  const second = await (await call("/api/exchange", { json: { app: "qcrm", code: codeIn(on.to), verifier: crm.verifier } })).res.json();
  expect(second).toMatchObject({ app: "qcrm", source: "park-hide-seek", access: ["member"] });

  // The super admin gives her beta in the game and takes play away; signing in again doesn't hand play back.
  const admin = await call("/do/signup", { form: { name: "Boss", email: ADMIN, password: PASSWORD } });
  expect(admin.to).toBe("/");
  expect((await call("/do/grant", { form: { email: "ada@example.com", for_app: "park-hide-seek", role: "beta" }, cookie: admin.cookie })).to).toBe("/");
  expect((await call("/do/revoke", { form: { email: "ada@example.com", for_app: "park-hide-seek", role: "play" }, cookie: admin.cookie })).to).toBe("/");
  const again = await asks("park-hide-seek", PARK);
  const back = await call("/do/signin", { form: { ...again.form, email: "ada@example.com", password: PASSWORD } });
  expect(await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(back.to), verifier: again.verifier } })).res.json())
    .toMatchObject({ access: ["beta"] });
  // Someone else can't grant.
  expect((await call("/do/grant", { form: { email: ADMIN, for_app: "qcrm", role: "admin" }, cookie: up.cookie })).res.status).toBe(403);

  const everyone = await members(conf);
  expect(everyone.map((m) => [m.email, m.source]).sort()).toEqual([["ada@example.com", "park-hide-seek"], ["boss@example.com", "eqosys"]]);
  expect(everyone.find((m) => m.email === "ada@example.com")!.apps.map((a) => a.app).sort()).toEqual(["park-hide-seek", "qcrm"]);
});

test("a handoff that isn't the app's own goes nowhere", async () => {
  const { call } = await boot();
  const park = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...park.form, email: "eve@example.com", password: PASSWORD } });
  const code = codeIn(up.to);

  // A return URL on someone else's origin, or an app that isn't ours: no code minted, back to the login page.
  for (const form of [{ ...park.form, return: "https://evil.example/steal" }, { ...park.form, app: "nope" }, { ...park.form, challenge: "short" }])
    expect((await call("/do/continue", { form, cookie: up.cookie })).to).toBe("/login?e=app");
  // A cookie-carrying form from another site is refused.
  expect((await call("/do/continue", { form: park.form, cookie: up.cookie, origin: "https://evil.example" })).res.status).toBe(403);

  // Trading in for another app, with a wrong verifier, or with no body: refused, and the code is spent by the try.
  expect((await call("/api/exchange", { json: { app: "qcrm", code, verifier: park.verifier } })).res.status).toBe(400);
  expect((await call("/api/exchange", { json: { app: "park-hide-seek", code, verifier: park.verifier } })).res.status).toBe(400);
  for (const json of [null, [], { app: "park-hide-seek" }]) expect((await call("/api/exchange", { json })).res.status).toBe(400);
  // A wrong password goes back to the login page with the ask still on it.
  const bad = await call("/do/signin", { form: { ...park.form, email: "eve@example.com", password: "wrong wrong wrong" } });
  expect(bad.to.startsWith("/login?e=bad&app=park-hide-seek&")).toBe(true);
});
