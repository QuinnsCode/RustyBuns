import { expect, setDefaultTimeout, test } from "bun:test";
import { members } from "../src/members.ts";
import { ADMIN, asks, boot, codeIn, ORIGIN, PARK, PASSWORD, QCRM } from "./kit.ts";
import { Jwks, newKey, verify } from "@rustybuns/util/token";
import { check } from "@rustybuns/util/guard";

setDefaultTimeout(30_000);

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

test("the token an app's server checks on its own: signed, for that app, from eqosys", async () => {
  const { call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
  const park = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...park.form, name: "Ada", email: "ada@example.com", password: PASSWORD } });
  const traded = await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: park.verifier } })).res.json() as { token: string };

  // What the game's server does: fetch the JWKS once, check the token with it. No call back per player.
  const jwks = check(Jwks, await (await call("/.well-known/jwks.json")).res.json())!;
  expect(jwks.keys).toHaveLength(1);
  const want = { iss: ORIGIN, aud: "park-hide-seek" };
  expect(await verify(traded.token, jwks, want)).toMatchObject({ sub: expect.any(String), email: "ada@example.com", name: "Ada", source: "park-hide-seek", access: ["play"] });

  // Another app's, a late one, one with its claims changed, or one checked against some other key: refused.
  const [h, , s] = traded.token.split(".");
  const forged = `${h}.${btoa(JSON.stringify({ ...await verify(traded.token, jwks, want), access: ["admin"] })).replace(/=+$/, "")}.${s}`;
  const other = check(Jwks, await (await (await boot({ EQOSYS_SIGNING_KEY: await newKey() })).call("/.well-known/jwks.json")).res.json())!;
  for (const [token, keys, w, at] of [
    [traded.token, jwks, { ...want, aud: "qcrm" }, Date.now()],
    [traded.token, jwks, want, Date.now() + 11 * 60_000],
    [forged, jwks, want, Date.now()],
    [traded.token, other, want, Date.now()],
  ] as const) expect(await verify(token, keys, w, at)).toBeNull();
});

test("loopback returns, for running an app locally, only with the flag on; no signing key means no token", async () => {
  const { call } = await boot({ LOOPBACK_RETURNS: "1" });
  const local = await asks("qcrm", "http://localhost:5173");
  const up = await call("/do/signup", { form: { ...local.form, email: "dev@example.com", password: PASSWORD } });
  expect(up.to.startsWith("http://localhost:5173/signed-in?")).toBe(true);
  const traded = await call("/api/exchange", { json: { app: "qcrm", code: codeIn(up.to), verifier: local.verifier }, origin: "http://localhost:5173" });
  expect(traded.res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  expect(await traded.res.json()).toMatchObject({ app: "qcrm", token: null });
  expect(await (await call("/.well-known/jwks.json")).res.json()).toEqual({ keys: [] });
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
  // A page on this machine isn't the app's own either, unless the loopback flag is on.
  const local = { ...park.form, return: "http://localhost:5173/signed-in" };
  expect((await call("/do/continue", { form: local, cookie: up.cookie })).to).toBe("/login?e=app");
  // A wrong password goes back to the login page with the ask still on it.
  const bad = await call("/do/signin", { form: { ...park.form, email: "eve@example.com", password: "wrong wrong wrong" } });
  expect(bad.to.startsWith("/login?e=bad&app=park-hide-seek&")).toBe(true);
});
