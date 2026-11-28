// "Create your world" against a fake eqosys (its exchange route and keys): with no eqosys to reach the card says so,
// signed out it goes to eqosys's login from the site's root, back with a code it opens this browser's world, and
// signed in it goes straight to that world from any other room.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";

const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const ada = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: "agent-page", source: "agent-page", access: ["member"] };
let EQOSYS_URL = "";
let exchanged: unknown = null;
const fake: ReturnType<typeof Bun.serve> = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
  if (new URL(req.url).pathname === "/.well-known/jwks.json") return Response.json(await jwksOf(signer));
  exchanged = await req.json();
  return Response.json({ ...ada, token: await sign(signer, EQOSYS_URL, ada) });
} });
EQOSYS_URL = `http://127.0.0.1:${fake.port}`;
afterAll(() => fake.stop(true));

const SITE = "https://agent-page.notryanquinn.workers.dev";
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g: { localStorage?: unknown; sessionStorage?: unknown; location?: unknown; history?: unknown } = globalThis;
let went = "", address = "http://127.0.0.1:4799/r/room00000001";
const at = (to: string) => { address = new URL(to, address).href; g.location = loc(); };
const loc = () => { const u = new URL(address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { went = to; } }; };
beforeAll(() => {
  g.localStorage = mem(); g.sessionStorage = mem(); g.location = loc();
  g.history = { replaceState: (_: unknown, __: string, to: string) => at(to) };
});

test("Create your world: no eqosys here, then off to sign in, back to this browser's world, and straight there once signed in", async () => {
  const { backFromSignIn, createWorld, login } = await import("../src/account.ts");
  // Local dev, with no eqosys to send anyone back: the card says so and nothing leaves.
  expect(await createWorld("room00000001")).toBe("off");
  expect(went).toBe("");

  // The live site: off to eqosys's login, from the root it sends people back to.
  localStorage.setItem("agent-page.eqosys", EQOSYS_URL);
  at(`${SITE}/r/room00000001`);
  expect(await createWorld("room00000001")).toBe("away");
  for (let i = 0; !went && i < 100; i++) await Bun.sleep(5); // signIn makes its PKCE challenge first
  const out = new URL(went);
  expect([out.origin + out.pathname, out.searchParams.get("app"), out.searchParams.get("return")]).toEqual([`${EQOSYS_URL}/login`, "agent-page", `${SITE}/`]);

  // Back with a code: the code is traded in, and the room this browser was in is the world to open.
  at(`${SITE}/?code=eq_1&state=${out.searchParams.get("state")}`);
  expect(await backFromSignIn()).toBe("room00000001");
  expect(exchanged).toMatchObject({ app: "agent-page", code: "eq_1" });
  expect(login()?.name).toBe("Ada");

  // Signed in: from another room the card goes to that world; in it, it just opens.
  expect(await createWorld("room00000002")).toBe("away");
  expect(went).toBe("/r/room00000001");
  expect(await createWorld("room00000001")).toBe("here");
});
