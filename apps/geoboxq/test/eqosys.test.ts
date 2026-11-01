// Signing in through eqosys: they go off to eqosys, come back with a code, trade it for a login (the name the
// page shows), and a return that didn't start in this tab is refused. GeoBoxQ's Worker has no notion of who is
// asking, so there is no token check to make: the name is all a sign-in changes.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";
import { APP, canSignIn, finishSignIn, login, signIn, signOut } from "../src/account.ts";

const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const ada = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: APP, source: APP, access: ["play"] };
let eqosysUrl = "";
// Stands in for eqosys: only the exchange (and its JWKS, which nothing here needs).
const fake: ReturnType<typeof Bun.serve> = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/api/exchange") return Response.json({ ...ada, token: await sign(signer, eqosysUrl, ada) });
  return path === "/.well-known/jwks.json" ? Response.json(await jwksOf(signer)) : new Response("", { status: 404 });
} });
eqosysUrl = `http://127.0.0.1:${fake.port}`;
afterAll(() => fake.stop(true));

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g = globalThis as Record<string, unknown>;
const SITE = "https://geoboxq.qntbr.com";
let went = "", address = `${SITE}/`;
const loc = () => { const u = new URL(address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { went = to; } }; };
beforeAll(() => {
  g.localStorage = mem(); g.sessionStorage = mem(); g.location = loc();
  g.history = { replaceState: (_: unknown, __: string, to: string) => { address = new URL(to, address).href; g.location = loc(); } };
  // A local eqosys, the way a developer points the page at one.
  localStorage.setItem("geoboxq.eqosys", eqosysUrl);
});

test("sign in, come back with a code, and the person's eqosys name is kept; sign out clears it", async () => {
  expect(canSignIn()).toBe(true);
  expect(login()).toBeNull();
  await signIn();
  const out = new URL(went);
  expect(out.origin).toBe(eqosysUrl);
  expect(out.searchParams.get("app")).toBe("geoboxq");

  address = `${SITE}/?code=eq_1&state=${out.searchParams.get("state")}`; g.location = loc();
  expect((await finishSignIn())?.login?.name).toBe("Ada");
  expect(address).toBe(`${SITE}/`);
  expect(login()?.name).toBe("Ada");

  signOut();
  expect(login()).toBeNull();

  // A return nobody here asked for is refused.
  address = `${SITE}/?code=eq_2&state=forged`; g.location = loc();
  expect((await finishSignIn())?.login).toBeNull();
});
