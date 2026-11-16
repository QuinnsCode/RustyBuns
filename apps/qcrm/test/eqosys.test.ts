// Sign in with eqosys: the whole round trip against a stand-in eqosys (its /oauth routes, PKCE checked as eqosys does),
// from the button's POST to a qCRM session, for a new person, one who already has a qCRM account, and an unverified email.
import { afterAll, expect, test } from "bun:test";
import { local, signup } from "./app-kit.ts";
import { b64url } from "@rustybuns/util/bytes";

const sha256Bytes = async (s: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));

/** Who the stand-in eqosys signs in next. */
let next = { sub: "eq-1", email: "new@example.com", email_verified: true, name: "New Person" };
const codes = new Map<string, { challenge: string; who: typeof next }>();
const tokens = new Map<string, typeof next>();
const seen: URL[] = [];
const eqosys = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/oauth/authorize") {
      seen.push(url);
      const code = crypto.randomUUID();
      codes.set(code, { challenge: url.searchParams.get("code_challenge")!, who: next });
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state")!);
      return Response.redirect(back.href, 302);
    }
    if (url.pathname === "/oauth/token") {
      const f = await req.formData();
      const c = codes.get(String(f.get("code")));
      codes.delete(String(f.get("code")));
      const proof = c && await sha256Bytes(String(f.get("code_verifier")));
      if (!c || proof !== c.challenge || f.get("client_id") !== "qcrm") return Response.json({ error: "invalid_grant" }, { status: 400 });
      const token = crypto.randomUUID();
      tokens.set(token, c.who);
      return Response.json({ access_token: token, token_type: "Bearer", expires_in: 3600 });
    }
    if (url.pathname === "/oauth/userinfo") {
      const who = tokens.get(/^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "");
      return who ? Response.json(who) : Response.json({ error: "invalid_token" }, { status: 401 });
    }
    return new Response("not found", { status: 404 });
  },
});
afterAll(() => eqosys.stop(true));

const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

/** Press "Continue with eqosys" and follow it home: where qCRM sends the browser, and its cookies. */
async function viaEqosys(app: Awaited<ReturnType<typeof local>>) {
  const start = await app("", "/api/auth/sign-in/social", { method: "POST", body: JSON.stringify({ provider: "eqosys", callbackURL: "/app" }) });
  expect(start.status).toBe(200);
  const { url } = await start.json();
  const there = await fetch(url, { redirect: "manual" });
  const back = new URL(there.headers.get("location")!);
  const home = await app(cookiesOf(start), back.pathname + back.search);
  return { to: home.headers.get("location") ?? "", cookie: cookiesOf(home) };
}

test("eqosys signs a new person in, links an existing account by verified email, and refuses to link an unverified one", async () => {
  const app = await local({ EQOSYS_URL: eqosys.url.origin });
  expect(await (await app("", "/api/providers")).json()).toContain("eqosys");

  // A new person: a qCRM account is made for them.
  next = { sub: "eq-1", email: "new@example.com", email_verified: true, name: "New Person" };
  const first = await viaEqosys(app);
  expect(first.to).toBe("/app");
  expect(seen[0]!.searchParams.get("client_id")).toBe("qcrm");
  expect(seen[0]!.searchParams.get("code_challenge_method")).toBe("S256");
  expect(seen[0]!.searchParams.get("redirect_uri")).toBe(`${new URL(app.env.BETTER_AUTH_URL!).origin}/api/auth/callback/eqosys`);
  const me = await (await app(first.cookie, "/api/me")).json();
  expect(me.user).toMatchObject({ email: "new@example.com", name: "New Person" });
  expect(me.orgs).toHaveLength(1);

  // Someone with a password account and a verified email (they opened qCRM's link): eqosys says the same email is theirs
  // and verified, so it is the same qCRM user. An unverified qCRM account isn't linked (Better Auth's rule): whoever made
  // it may not own the inbox, and their password would still open it.
  const pw = await signup(app, "alice@example.com");
  const alice = (await (await app(pw, "/api/me")).json()).user;
  await app.env.DB.prepare(`UPDATE "user" SET "emailVerified" = 1 WHERE id = ?`).bind(alice.id).run();
  next = { sub: "eq-2", email: "alice@example.com", email_verified: true, name: "Alice" };
  const linked = await viaEqosys(app);
  expect((await (await app(linked.cookie, "/api/me")).json()).user.id).toBe(alice.id);

  // An email eqosys hasn't seen proven doesn't take over the account that holds it.
  const bob = (await (await app(await signup(app, "bob@example.com"), "/api/me")).json()).user;
  await app.env.DB.prepare(`UPDATE "user" SET "emailVerified" = 1 WHERE id = ?`).bind(bob.id).run();
  next = { sub: "eq-3", email: "bob@example.com", email_verified: false, name: "Not Bob" };
  const refused = await viaEqosys(app);
  expect(refused.to).toContain("error=");
  expect((await app(refused.cookie, "/api/me")).status).toBe(401);
});

test("without EQOSYS_URL there is no eqosys button", async () => {
  const app = await local();
  expect(await (await app("", "/api/providers")).json()).not.toContain("eqosys");
});
