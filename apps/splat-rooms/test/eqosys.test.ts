// A player signs in through eqosys: they come back with a code, trade it for a login, and the menu has their
// name. Splat Rooms has no server that knows players, so the token is only kept; it still checks out against
// eqosys's keys, which is what a Worker would do with it.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { jwksOf, newKey, sign, TokenChecker } from "@rustybuns/util/token";
import { APP, canSignIn, finishSignIn, login, signIn, signOut } from "../src/ui/eqosys.ts";

const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const ada = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: APP, source: APP, access: ["play"] };
let eqosysUrl = "";
const fake: ReturnType<typeof Bun.serve> = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/.well-known/jwks.json") return Response.json(await jwksOf(signer));
  if (path === "/api/exchange") return Response.json({ ...ada, token: await sign(signer, eqosysUrl, ada) });
  return new Response("", { status: 404 });
} });
eqosysUrl = `http://127.0.0.1:${fake.port}`;
afterAll(() => fake.stop(true));

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g = globalThis as Record<string, unknown>;
const SITE = "https://splat-rooms.notryanquinn.workers.dev";
let went = "", address = `${SITE}/`;
const loc = () => { const u = new URL(address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { went = to; } }; };
beforeAll(() => { g.localStorage = mem(); g.sessionStorage = mem(); g.location = loc(); g.history = { replaceState: (_: unknown, __: string, to: string) => { address = new URL(to, address).href; g.location = loc(); } }; });

test("sign in, come back, and the menu has the eqosys name and a token eqosys's keys vouch for", async () => {
  localStorage.setItem("splat-rooms.eqosys", eqosysUrl); // a local eqosys, as `bun run dev` there with loopback returns
  expect(canSignIn()).toBe(true);
  expect(login()).toBeNull();
  await signIn();
  expect(new URL(went).searchParams.get("app")).toBe("splat-rooms");
  address = `${SITE}/?code=eq_1&state=${new URL(went).searchParams.get("state")}`; g.location = loc();
  expect((await finishSignIn())?.login?.name).toBe("Ada");
  expect(login()?.name).toBe("Ada");
  expect(await new TokenChecker(eqosysUrl, APP).check(login()!.token)).toMatchObject({ sub: "u_ada", name: "Ada" });
  signOut();
  expect(login()).toBeNull();
});

test("a desktop or local page can't sign in unless a local eqosys is set", () => {
  g.localStorage = mem(); address = "http://localhost:5173/"; g.location = loc();
  expect(canSignIn()).toBe(false);
});
