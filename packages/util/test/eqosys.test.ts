// A player goes to eqosys and comes back: the handoff's secrets stay in the tab, the code is traded for a login, and a return that didn't start here is refused.
import { afterAll, beforeEach, expect, test } from "bun:test";
import { newKey, sign } from "../src/token.ts";
import { eqosys } from "../src/eqosys.ts";

const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g = globalThis as Record<string, unknown>;
let went = "", address = "https://game.example/play";
const loc = () => { const u = new URL(address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { went = to; } }; };
const key = { EQOSYS_SIGNING_KEY: await newKey() };
let exchanged: unknown = null, renewals = 0, refuse = false;
const who = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: "game", source: "game", access: ["play"] };
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/health" || path === "/oauth/revoke") return Response.json({});
  if (path === "/oauth/token") {
    if (refuse) return Response.json({ error: "invalid_grant" }, { status: 400 });
    return Response.json({ access_token: await sign(key, "http://eqosys", who), refresh_token: `r${++renewals + 1}` });
  }
  exchanged = await req.json();
  return Response.json({ ...who, token: await sign(key, "http://eqosys", who), refresh: "r1" });
} });
/** A login whose ten minutes ran out an hour ago. */
const stale = async (refresh?: string) => JSON.stringify({ name: "Ada", email: "ada@example.com", token: await sign(key, "http://eqosys", who, Date.now() - 3_600_000), ...(refresh ? { refresh } : {}) });
const until = async (ok: () => unknown) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); };
afterAll(() => server.stop(true));
const client = () => eqosys({ app: "game", url: `http://127.0.0.1:${server.port}/`, from: ["https://game.example"], prefix: "g" });

beforeEach(() => {
  g.localStorage = store(); g.sessionStorage = store(); went = ""; address = "https://game.example/play"; refuse = false;
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
  expect(exchanged).toMatchObject({ app: "game", code: "eq_1", keep: true });
  expect(eq.login()?.refresh).toBe("r1");
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

test("back after the token ran out: it renews in the background, no trip to eqosys", async () => {
  (g.localStorage as Storage).setItem("g.login", await stale("r1"));
  const eq = client();
  expect(await eq.finishSignIn()).toBeNull();
  expect(went).toBe("");
  expect(eq.fresh(eq.login()!)).toBe(true);
  expect(eq.login()?.refresh).not.toBe("r1");
});

test("renewal refused: one quiet check with eqosys keeps the invite's query, and signed out there the player is a guest", async () => {
  refuse = true;
  address = "https://game.example/play?room=A"; g.location = loc();
  (g.localStorage as Storage).setItem("g.login", await stale("r1"));
  const eq = client();
  void eq.finishSignIn();
  await until(() => went);
  const out = new URL(went);
  expect([out.pathname, out.searchParams.get("prompt"), out.searchParams.get("return")]).toEqual(["/login", "none", "https://game.example/play"]);

  address = `https://game.example/play?error=login_required&state=${out.searchParams.get("state")}`; g.location = loc();
  expect(await eq.finishSignIn()).toBeNull();
  expect(address).toBe("https://game.example/play?room=A");
  expect(eq.login()).toBeNull();
});
