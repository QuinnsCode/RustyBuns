import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { createHash } from "node:crypto";
import { CSP, csp, headersFile, inlineScriptHashes, secured } from "../src/security.ts";

// End to end (password hashes, in-process D1), like invites.test.ts.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const local = async (extra?: Record<string, unknown>) => { const c = await boot({ GH_CLI: "off", ...extra }); opened.push(c); return c; };
const ORIGIN = "http://codesplitter.local";
const post = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("security headers", () => {
  test("every Worker answer carries them, and the static pages get the same through _headers", async () => {
    const call = await local();
    for (const res of [await call(null, "/api/session"), await call(null, "/api/nope"), await call(null, "/nope")]) {
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("strict-transport-security")).toMatch(/^max-age=\d+/);
      expect(res.headers.get("content-security-policy")).toBe(CSP);
      expect(res.headers.has("content-security-policy-report-only")).toBe(false);
    }
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).toMatch(/script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
    expect(headersFile()).toStartWith("/*\n");
    expect(headersFile()).toContain(`  x-frame-options: DENY\n`);
    expect(headersFile(["sha256-abc="])).toContain(`  content-security-policy: ${csp(["sha256-abc="])}\n`);
    expect(csp(["sha256-abc="])).toContain("script-src 'self' 'sha256-abc=' https://challenges.cloudflare.com;");
  });

  test("the OAuth consent page keeps its own, stricter CSP", async () => {
    const res = secured(new Response("", { headers: { "content-security-policy": "default-src 'none'" } }));
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("inlineScriptHashes hashes inline scripts and importmaps, not ones with a src", () => {
    const sha = (s: string) => `sha256-${createHash("sha256").update(s).digest("base64")}`;
    const html = `<script src="/a.js"></script><script type="importmap">{"imports":{}}</script>\n<script>\nlet x = 1;\n</script>`;
    expect(inlineScriptHashes(html)).toEqual([sha(`{"imports":{}}`), sha("\nlet x = 1;\n")]);
  });
});

describe("Origin check", () => {
  test("a socket upgrade from another site is refused: it acts as the person like a write", async () => {
    const call = await local();
    await call(null, "/api/login", post({ name: "ryan" }));
    const join = (headers: Record<string, string>) => call("ryan", "/api/game/l/mitt/ws", { headers: { upgrade: "websocket", ...headers } });
    expect((await join({ origin: "https://evil.example" })).status).toBe(403);
    expect((await join({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await join({ origin: ORIGIN })).status).not.toBe(403);
  });

  test("a cookie-signed write from another site is refused; this site's, a bare one and a bearer one aren't", async () => {
    const call = await local();
    await call(null, "/api/login", post({ name: "ryan" }));
    const repo = (name: string, headers: Record<string, string>) => call("ryan", "/api/repos", post({ name }, headers));
    const evil = await repo("one", { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(((await evil.json()) as { error: string }).error).toMatch(/cross-site/);
    expect((await repo("two", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    // A sandboxed frame (a profile's page) sends Origin: null.
    expect((await repo("three", { origin: "null" })).status).toBe(403);
    expect((await repo("four", { origin: ORIGIN })).status).toBe(201);
    expect((await repo("five", { "sec-fetch-site": "same-origin" })).status).toBe(201);
    expect((await repo("six", {})).status).toBe(201);
    // The desktop behind an HTTPS tunnel: the page says https://, the request arrives as http:// (#456).
    expect((await repo("seven", { origin: ORIGIN.replace("http:", "https:") })).status).toBe(201);
    // Reads aren't writes, and nothing signed by a cookie has nothing to forge.
    expect((await call("ryan", "/api/session", { headers: { origin: "https://evil.example" } })).status).toBe(200);
    expect((await call(null, "/api/login", post({ name: "sam" }, { origin: "https://evil.example" }))).status).toBe(200);
  });
});

describe("Turnstile", () => {
  test("sign-up, reset links and joining a crew as a person want the check's answer; agents' door doesn't", async () => {
    const asked: string[] = [];
    const call = await local({
      BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: ORIGIN,
      EMAIL: { send: async () => {} }, EMAIL_FROM: "hi@codesplitter.test",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
      TURNSTILE_FETCH: async (_url: string, init: { body: FormData }) => {
        const answer = String(init.body.get("response"));
        asked.push(answer);
        return Response.json({ success: answer === "good" });
      },
    });
    expect(((await (await call(null, "/api/session")).json()) as { turnstile?: string }).turnstile).toBe("1x00000000000000000000AA");
    const signup = (headers: Record<string, string>) => call(null, "/api/auth/sign-up/email", post({ email: "ana@example.com", password: "correct horse battery", name: "ana" }, { origin: ORIGIN, ...headers }));
    expect((await signup({})).status).toBe(403);
    expect((await signup({ "x-turnstile": "bad" })).status).toBe(403);
    const ok = await signup({ "x-turnstile": "good" });
    expect(ok.status).toBe(200);
    expect(asked).toEqual(["bad", "good"]);
    const reset = (headers: Record<string, string>) => call(null, "/api/auth/request-password-reset", post({ email: "ana@example.com", redirectTo: "/" }, { origin: ORIGIN, ...headers }));
    expect((await reset({})).status).toBe(403);
    expect((await reset({ "x-turnstile": "good" })).status).toBe(200);
    // Signing in isn't checked: the edge limit and D1's count it.
    expect((await call(null, "/api/auth/sign-in/email", post({ email: "ana@example.com", password: "correct horse battery" }, { origin: ORIGIN }))).status).toBe(200);
  });

  test("an invite's person door checks it, its agent door doesn't", async () => {
    const call = await local({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET: "secret", TURNSTILE_FETCH: async (_u: string, init: { body: FormData }) => Response.json({ success: init.body.get("response") === "good" }) });
    for (const u of ["ryan", "sam"]) await call(null, "/api/login", post({ name: u }));
    await call("ryan", "/api/repos", post({ name: "lab" }));
    const invite = async () => ((await (await call("ryan", "/api/repos/ryan/lab/invites", post({}))).json()) as { token: string }).token;
    const person = await invite();
    expect((await call("sam", "/api/invites/claim", post({ invite: person, as: "person" }))).status).toBe(403);
    expect((await call("sam", "/api/invites/claim", post({ invite: person, as: "person" }, { "x-turnstile": "good" }))).status).toBe(201);
    expect((await call(null, "/api/invites/claim", post({ invite: await invite(), as: "agent", harness: "claude" }))).status).toBe(201);
  });
});

describe("edge rate limit", () => {
  test("AUTH_LIMIT turns a flood away before D1 counts it, for requests from the internet only", async () => {
    const keys: string[] = [];
    const call = await local({ AUTH_LIMIT: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: keys.length <= 2 }; } } });
    const ip = { "cf-connecting-ip": "203.0.113.7" };
    const signin = (headers: Record<string, string> = {}) => call(null, "/api/auth/sign-in/email", post({ email: "a@b.c", password: "x" }, headers));
    expect((await signin(ip)).status).toBe(404);   // alias mode: no accounts, but it got past the limits
    expect((await signin(ip)).status).toBe(404);
    const over = await signin(ip);
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBe("60");
    expect(keys).toEqual(["signin:203.0.113.7", "signin:203.0.113.7", "signin:203.0.113.7"]);
    // D1 never saw the third.
    expect(((await call.env.DB.prepare("SELECT count FROM limit_hits WHERE rule = 'signin'").first()) as { count: number }).count).toBe(2);
    // The desktop and the tests carry no cf-connecting-ip: not counted.
    expect((await signin()).status).toBe(404);
    expect(keys.length).toBe(3);
  });
});

describe("fail closed without BETTER_AUTH_SECRET", () => {
  test("on Cloudflare, alias mode signs nobody in", async () => {
    const call = await local();
    await call(null, "/api/login", post({ name: "quinn" }));
    expect(((await (await call("quinn", "/api/session")).json()) as { user: string }).user).toBe("quinn");
    const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true });
    try {
      const login = await call(null, "/api/login", post({ name: "quinn" }));
      expect(login.status).toBe(503);
      expect(login.headers.get("set-cookie")).toBeNull();
      expect(await (await call("quinn", "/api/session")).json()).toMatchObject({ mode: "alias", user: null, closed: true });
      expect((await call("quinn", "/api/repos", post({ name: "mine" }))).status).toBe(401);
    } finally {
      if (was) Object.defineProperty(globalThis, "navigator", was);
    }
  });
});

describe("agent- handles from the cs_user cookie (#1455)", () => {
  test("hosted refuses one, so a cookie can't join every repo running that agent; local still acts as it", async () => {
    const call = await local();
    const user = async () => ((await (await call("agent-a", "/api/session")).json()) as { user: string | null }).user;
    expect(await user()).toBe("agent-a");
    const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true });
    try {
      expect(await user()).toBeNull();
    } finally {
      if (was) Object.defineProperty(globalThis, "navigator", was);
    }
    expect(await user()).toBe("agent-a");
  });
});
