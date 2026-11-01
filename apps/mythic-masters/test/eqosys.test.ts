// A player signs in through eqosys: the title sends them off, they come back with a code, trade it for a login and
// see their eqosys name. Mythic Masters has no server, so there is no Worker check to walk (see src/account.ts).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";
import { accountHtml, finishSignIn, login, signIn, signOut } from "../src/account.ts";

const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const ada = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: "mythic-masters", source: "mythic-masters", access: ["play"] };
let EQOSYS_URL = "";
// Stands in for eqosys: its JWKS and the exchange.
const fake: ReturnType<typeof Bun.serve> = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/.well-known/jwks.json") return Response.json(await jwksOf(signer));
  if (path === "/api/exchange") return Response.json({ ...ada, token: await sign(signer, EQOSYS_URL, ada) });
  return new Response("", { status: 404 });
} });
EQOSYS_URL = `http://127.0.0.1:${fake.port}`;
afterAll(() => fake.stop(true));

const mem = (seed: Record<string, string> = {}) => { const m = new Map(Object.entries(seed)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g = globalThis as Record<string, unknown>;
let went = "", address = "http://localhost:5173/";
const loc = () => { const u = new URL(address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { went = to; } }; };
// Not deployed yet, so only a page told about a local eqosys can sign in.
beforeAll(() => { g.localStorage = mem({ "mm.eqosys": EQOSYS_URL }); g.sessionStorage = mem(); g.location = loc(); g.history = { replaceState: (_: unknown, __: string, to: string) => { address = new URL(to, address).href; g.location = loc(); } }; });

test("sign in from the title, come back, and the name shows; sign out clears it", async () => {
  expect(accountHtml(null, false)).toBe("");
  expect(accountHtml(null, true)).toContain('id="signIn"');
  await signIn();
  expect(went.startsWith(`${EQOSYS_URL}/login?`)).toBe(true);
  address = `http://localhost:5173/?code=eq_1&state=${new URL(went).searchParams.get("state")}`; g.location = loc();
  const back = await finishSignIn();
  expect(back?.login?.name).toBe("Ada");
  expect(address).toBe("http://localhost:5173/");
  expect(accountHtml(login(), true)).toContain("Ada");
  expect(accountHtml({ ...login()!, name: "<b>x</b>" }, true)).not.toContain("<b>x");
  signOut();
  expect(login()).toBeNull();
});

test("a return that didn't start here is refused with a note", async () => {
  address = "http://localhost:5173/?code=eq_1&state=forged"; g.location = loc();
  const back = await finishSignIn();
  expect(back?.login).toBeNull();
  expect(accountHtml(null, true, back?.error)).toContain("start here");
});
