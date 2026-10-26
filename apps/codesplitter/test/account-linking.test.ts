import { afterEach, describe, expect, test } from "bun:test";
import { accounts } from "./app-kit.ts";

// A provider sign-in with the email of a password account nobody verified must not
// link onto it: whoever signed up first would keep a working password on that account (#2297).

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** GitHub says "ana@example.com, verified"; every other request goes through. */
function fakeGithub() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "gho_fake", token_type: "bearer", scope: "read:user,user:email" });
    if (url === "https://api.github.com/user") return Response.json({ id: 4242, login: "ana-gh", name: "Ana", email: "ana@example.com", avatar_url: "" });
    if (url === "https://api.github.com/user/emails") return Response.json([{ email: "ana@example.com", primary: true, verified: true }]);
    return realFetch(input, init);
  }) as typeof fetch;
}

describe("account linking", () => {
  test("a verified provider sign-in does not adopt an unverified password account", async () => {
    const { call, signup } = await accounts({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" });
    const squatter = await signup("ana@example.com", "squatter");
    fakeGithub();
    const start = await call(null, "/api/auth/sign-in/social", { method: "POST", headers: { "content-type": "application/json", origin: "http://codesplitter.local" }, body: JSON.stringify({ provider: "github", callbackURL: "/" }) });
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state")!;
    const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const back = await call(null, `/api/auth/callback/github?code=fake&state=${state}`, { headers: { cookie } });
    // Refused: no session for the provider, and the squatter's account has no GitHub on it.
    expect(back.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token="))).toBe(false);
    const linked = (await (await call(null, "/api/auth/list-accounts", { headers: { cookie: squatter } })).json()) as { providerId: string }[];
    expect(linked.map((a) => a.providerId)).toEqual(["credential"]);
  });
});
