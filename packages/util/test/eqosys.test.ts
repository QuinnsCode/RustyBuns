// A player goes to eqosys and comes back: the handoff's secrets stay in the tab, the code is traded for a login, and a return that didn't start here is refused.
import { afterAll, beforeEach, expect, test } from "bun:test";
import { newKey, sign } from "../src/token.ts";
import { eqosys } from "../src/eqosys.ts";

const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g = globalThis as Record<string, unknown>;
let went = "", address = "https://game.example/play";
const loc = () => { const u = new URL(address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { went = to; } }; };
const key = { EQOSYS_SIGNING_KEY: await newKey() };
let exchanged: unknown = null;
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
  exchanged = await req.json();
  const who = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: "game", source: "game", access: ["play"] };
  return Response.json({ ...who, token: await sign(key, "http://eqosys", who) });
} });
afterAll(() => server.stop(true));
const client = () => eqosys({ app: "game", url: `http://127.0.0.1:${server.port}/`, from: ["https://game.example"], prefix: "g" });

beforeEach(() => {
  g.localStorage = store(); g.sessionStorage = store(); went = ""; address = "https://game.example/play";
  g.location = loc(); g.history = { replaceState: (_: unknown, __: string, to: string) => { address = new URL(to, address).href; g.location = loc(); } };
});

test("sign in, come back with a code, and the name and token are kept", async () => {
  const eq = client();
  expect(eq.canSignIn()).toBe(true);
  await eq.signIn("play");
  const out = new URL(went), state = out.searchParams.get("state")!;
  expect(out.searchParams.get("app")).toBe("game");
  expect(out.searchParams.get("return")).toBe("https://game.example/play");

  address = `https://game.example/play?code=eq_1&state=${state}&room=A`; g.location = loc();
  const back = await eq.finishSignIn();
  expect(back).toMatchObject({ then: "play", login: { name: "Ada", email: "ada@example.com" } });
  expect(exchanged).toMatchObject({ app: "game", code: "eq_1" });
  expect(address).toBe("https://game.example/play?room=A");
  expect(eq.login()?.name).toBe("Ada");
  expect(eq.fresh(eq.login()!)).toBe(true);
  expect(await eq.finishSignIn()).toBeNull();
  eq.signOut();
  expect(eq.login()).toBeNull();
});

test("a return that didn't start in this tab is refused, and another origin can't sign in", async () => {
  const eq = client();
  address = "https://game.example/play?code=eq_1&state=forged"; g.location = loc();
  expect((await eq.finishSignIn())?.login).toBeNull();
  address = "http://localhost:3000/"; g.location = loc();
  expect(eq.canSignIn()).toBe(false);
});
