// A player signed in through eqosys, as the edge Worker sees them: the token in the query names them, the
// Worker checks it against eqosys's JWKS once, and the World and the Matchmaker get the account's id and name.
import { afterAll, expect, test } from "bun:test";
import { JWKS_RETRY_MS } from "@rustybuns/util/token";
import { jwksOf, newKey, sign } from "../../eqosys/src/token.ts";
import worker from "../src/edge/worker.ts";
import { checkerFor } from "../src/edge/eqosys.ts";

// Stands in for eqosys: only its JWKS, counting how often the Worker comes for it.
let signer = { EQOSYS_SIGNING_KEY: await newKey() };
let fetched = 0;
const eqosys = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => { fetched++; return new URL(req.url).pathname === "/.well-known/jwks.json" ? Response.json(await jwksOf(signer)) : new Response("", { status: 404 }); } });
afterAll(() => eqosys.stop(true));
const EQOSYS_URL = `http://127.0.0.1:${eqosys.port}`;
const ada = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: "park-hide-seek", source: "park-hide-seek", access: ["play"] };

// Just enough Durable Objects: each answers with what the Worker vouched for.
const ns = (reply: (req: Request) => Response) => ({ idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => reply(r) }) });
const env = {
  ASSETS: { fetch: async () => new Response("page") },
  WORLD: ns((r) => Response.json({ id: r.headers.get("X-User-Id"), name: r.headers.get("X-User-Name"), principal: r.headers.get("X-RB-Principal") })),
  MATCH: ns((r) => Response.json({ uid: new URL(r.url).searchParams.get("uid") })),
  PARKS: ns((r) => Response.json({ voter: new URL(r.url).searchParams.get("voter") })),
  EQOSYS_URL,
};
const SITE = "https://park-hide-seek.notryanquinn.workers.dev";
const ws = (q: Record<string, string>) => worker.fetch(new Request(`${SITE}/ws?${new URLSearchParams({ room: "PIKA", ...q })}`, { headers: { Upgrade: "websocket", Origin: SITE, "X-User-Id": "forged" } }), env);
const match = (q: Record<string, string>) => worker.fetch(new Request(`${SITE}/api/match?${new URLSearchParams(q)}`), env);

test("a token from eqosys names the player: the account's id and name, checked against the JWKS fetched once", async () => {
  const token = (await sign(signer, EQOSYS_URL, ada))!;
  expect(await (await match({ token })).json()).toEqual({ uid: "eq:u_ada" });
  // The name typed beside it doesn't count, nor the identity header the client sent.
  expect(await (await ws({ token, name: "Mallory" })).json()).toEqual({ id: "eq:u_ada", name: "Ada", principal: "guest" });
  expect(fetched).toBe(1);

  // Anyone else plays as the id their browser made; one can't spell an eqosys id.
  expect(await (await ws({ uid: "tab-0001", name: "Scout" })).json()).toEqual({ id: "tab-0001", name: "Scout", principal: "guest" });
  expect((await ws({ uid: "eq:u_ada" })).status).toBe(400);

  // A token eqosys didn't sign, one for another app, or one that ran out: sign in again.
  const other = { EQOSYS_SIGNING_KEY: await newKey() };
  for (const bad of [
    await sign(other, EQOSYS_URL, ada),
    await sign(signer, EQOSYS_URL, { ...ada, app: "qcrm" }),
    await sign(signer, EQOSYS_URL, ada, Date.now() - 11 * 60_000),
    token.slice(0, -4) + "AAAA",
    "not.a.token",
  ]) expect((await match({ token: bad! })).status).toBe(401);
  expect(fetched).toBe(1);
});

test("eqosys rotates its key: a key id the Worker doesn't know fetches the JWKS again, but not for every bad token", async () => {
  const checker = checkerFor(env);
  const before = fetched;
  signer = { EQOSYS_SIGNING_KEY: await newKey() };
  const now = Date.now() + JWKS_RETRY_MS + 1;
  const fresh = (await sign(signer, EQOSYS_URL, ada, now))!;
  expect(await checker.check(fresh, now)).toMatchObject({ sub: "u_ada", name: "Ada" });
  expect(fetched).toBe(before + 1);
  // Right after, a token with a made-up key id gets no second trip.
  const [, p, s] = fresh.split(".");
  const h = btoa(JSON.stringify({ alg: "ES256", kid: "nobody-knows-me" })).replace(/=+$/, "");
  expect(await checker.check(`${h}.${p}.${s}`, now + 1000)).toBeNull();
  expect(fetched).toBe(before + 1);
});
