// A player signs in through eqosys: they come back with a code, trade it for a login, and the Worker lets them
// into a room as the account's id and name, whatever name or identity header the page sent beside it.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { eqosys } from "@rustybuns/util/eqosys";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";
import worker from "../src/edge/worker.ts";

const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const ada = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: "git-recon", source: "git-recon", access: ["play"] };
// Stands in for eqosys: its JWKS and the exchange.
let EQOSYS_URL = "";
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
const SITE = "https://git-recon.notryanquinn.workers.dev";
let went = "", address = `${SITE}/`;
const loc = () => { const u = new URL(address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { went = to; } }; };
beforeAll(() => { g.localStorage = mem(); g.sessionStorage = mem(); g.location = loc(); g.history = { replaceState: (_: unknown, __: string, to: string) => { address = new URL(to, address).href; g.location = loc(); } }; });

const env = { EQOSYS_URL, ASSETS: { fetch: async () => new Response("page") }, WORLD: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => Response.json({ id: r.headers.get("X-User-Id"), name: r.headers.get("X-User-Name"), principal: r.headers.get("X-RB-Principal") }) }) } };
const ws = (q: Record<string, string>) => worker.fetch(new Request(`${SITE}/ws?${new URLSearchParams({ room: "ABCD", ...q })}`, { headers: { Upgrade: "websocket", "X-User-Id": "forged" } }), env);

test("sign in, come back, and the Worker seats the player under their eqosys name", async () => {
  const client = eqosys({ app: "git-recon", url: EQOSYS_URL, from: [SITE], prefix: "git-recon" });
  expect(client.canSignIn()).toBe(true);
  await client.signIn();
  address = `${SITE}/?code=eq_1&state=${new URL(went).searchParams.get("state")}`; g.location = loc();
  expect((await client.finishSignIn())?.login?.name).toBe("Ada");

  const { token } = client.login()!;
  expect(await (await ws({ token, name: "Mallory" })).json()).toEqual({ id: "eq:u_ada", name: "Ada", principal: "guest" });
  // Guests still play on the id their tab made; nobody can spell an eqosys id there.
  expect(await (await ws({ uid: "abcdefgh1234", name: "Scout" })).json()).toEqual({ id: "abcdefgh1234", name: "Scout", principal: "guest" });
  expect((await ws({ uid: "eq:u_ada" })).status).toBe(400);
  // A token eqosys didn't sign, or one for another game: sign in again.
  const other = { EQOSYS_SIGNING_KEY: await newKey() };
  for (const bad of [await sign(other, EQOSYS_URL, ada), await sign(signer, EQOSYS_URL, { ...ada, app: "qcrm" })]) expect((await ws({ token: bad! })).status).toBe(401);
});
