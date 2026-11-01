// A player signs in through eqosys from the war room: off to eqosys, back with a code, the code traded for a
// login, and the account's name kept for the panel. Campaigns have no player accounts, so nothing else listens.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";

const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const ada = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: "two-fronts", source: "two-fronts", access: ["play"] };
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

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g = globalThis as Record<string, unknown>;
let went = "", address = "https://two-fronts.notryanquinn.workers.dev/";
const loc = () => { const u = new URL(address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { went = to; } }; };
beforeAll(() => { g.localStorage = mem(); g.sessionStorage = mem(); g.location = loc(); g.history = { replaceState: (_: unknown, __: string, to: string) => { address = new URL(to, address).href; g.location = loc(); } }; });

test("sign in, come back, and the account's name is kept; a forged return is refused", async () => {
  const { eqosys } = await import("@rustybuns/util/eqosys");
  const { APP, SIGN_IN_FROM } = await import("../src/eqosys.ts");
  const client = eqosys({ app: APP, url: EQOSYS_URL, from: SIGN_IN_FROM, prefix: "tf" });
  expect(client.canSignIn()).toBe(true);
  await client.signIn();
  expect(new URL(went).searchParams.get("app")).toBe("two-fronts");

  address = `https://two-fronts.notryanquinn.workers.dev/?code=eq_1&state=forged`; g.location = loc();
  expect((await client.finishSignIn())?.login).toBeNull();

  await client.signIn();
  address = `https://two-fronts.notryanquinn.workers.dev/?code=eq_1&state=${new URL(went).searchParams.get("state")}`; g.location = loc();
  expect((await client.finishSignIn())?.login?.name).toBe("Ada");
  expect(client.login()?.name).toBe("Ada");
  client.signOut();
  expect(client.login()).toBeNull();
});
