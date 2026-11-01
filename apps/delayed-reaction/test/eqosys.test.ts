// A player signs in through eqosys and comes back with their name. The game has no server of its own, so the
// name is all there is to carry; a return that didn't start in this tab is refused.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";

const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const ada = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: "delayed-reaction", source: "delayed-reaction", access: ["play"] };
let EQOSYS_URL = "";
let exchanged: unknown = null;
// Stands in for eqosys: only the exchange.
const fake: ReturnType<typeof Bun.serve> = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
  if (new URL(req.url).pathname === "/.well-known/jwks.json") return Response.json(await jwksOf(signer));
  exchanged = await req.json();
  return Response.json({ ...ada, token: await sign(signer, EQOSYS_URL, ada) });
} });
EQOSYS_URL = `http://127.0.0.1:${fake.port}`;
afterAll(() => fake.stop(true));

const SITE = "https://delayed-reaction.notryanquinn.workers.dev";
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g = globalThis as Record<string, unknown>;
let went = "", address = `${SITE}/`;
const loc = () => { const u = new URL(address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { went = to; } }; };
beforeAll(() => {
  g.localStorage = mem(); g.sessionStorage = mem(); g.location = loc();
  g.history = { replaceState: (_: unknown, __: string, to: string) => { address = new URL(to, address).href; g.location = loc(); } };
  localStorage.setItem("delayed-reaction.eqosys", EQOSYS_URL); // a local eqosys, as `bun run dev` there would be
});

test("sign in, come back with a code, and the player's name is kept", async () => {
  const { canSignIn, signIn, finishSignIn, login, signOut } = await import("../src/eqosys.ts");
  expect(canSignIn()).toBe(true);
  await signIn();
  const out = new URL(went);
  expect(out.origin + out.pathname).toBe(`${EQOSYS_URL}/login`);
  expect(out.searchParams.get("app")).toBe("delayed-reaction");

  address = `${SITE}/?level=2&code=eq_1&state=${out.searchParams.get("state")}`; g.location = loc();
  expect((await finishSignIn())?.login?.name).toBe("Ada");
  expect(exchanged).toMatchObject({ app: "delayed-reaction", code: "eq_1" });
  expect(address).toBe(`${SITE}/?level=2`);
  expect(login()?.name).toBe("Ada");

  // A return nobody here asked for is turned away, and signing out forgets the name.
  address = `${SITE}/?code=eq_2&state=forged`; g.location = loc();
  expect((await finishSignIn())?.login).toBeNull();
  signOut();
  expect(login()).toBeNull();
});
