// A player signs in through eqosys and comes back: the code is traded (against a fake eqosys) for a login, the
// header shows their name, and signing out brings the sign-in button back. The game has no Worker identity to check.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";

const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const ada = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: "alien-disc-golf", source: "alien-disc-golf", access: ["play"] };
let eqosysUrl = "";
const fake: ReturnType<typeof Bun.serve> = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/api/exchange") return Response.json({ ...ada, token: await sign(signer, eqosysUrl, ada) });
  if (path === "/.well-known/jwks.json") return Response.json(await jwksOf(signer));
  return new Response("", { status: 404 });
} });
eqosysUrl = `http://127.0.0.1:${fake.port}`;
afterAll(() => fake.stop(true));

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g = globalThis as Record<string, unknown>;
const HOME = "https://alien-disc-golf.notryanquinn.workers.dev";
let went = "", address = `${HOME}/`;
const loc = () => { const u = new URL(address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { went = to; } }; };
beforeAll(() => { g.localStorage = mem(); g.sessionStorage = mem(); g.location = loc(); g.history = { replaceState: (_: unknown, __: string, to: string) => { address = new URL(to, address).href; g.location = loc(); } }; });

test("sign in, come back, the header shows the eqosys name, sign out", async () => {
  const { accountHtml, finishSignIn, login, signIn, signOut } = await import("../src/account.ts");
  expect(accountHtml()).toContain("Sign in");
  localStorage.setItem("adg.eqosys", eqosysUrl); // a local eqosys, as `bun run dev` there would be
  await signIn();
  expect(went.startsWith(`${eqosysUrl}/login?`)).toBe(true);
  address = `${HOME}/?code=eq_1&state=${new URL(went).searchParams.get("state")}&seed=7`; g.location = loc();
  const back = await finishSignIn();
  expect(back?.login?.name).toBe("Ada");
  expect(address).toBe(`${HOME}/?seed=7`);
  expect(login()?.email).toBe("ada@example.com");
  expect(accountHtml()).toContain("Ada");
  expect(accountHtml()).toContain("Sign out");
  signOut();
  expect(accountHtml()).toContain("Sign in");
});
