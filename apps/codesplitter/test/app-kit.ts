// What the codesplitter tests share: an app that cleans up after itself, a POST helper and the
// accounts-on app. Split across files so bun test --parallel can run them side by side; each
// file gets its own copy of this module, so its own apps to close.
import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { local as boot, type Call } from "../src/local.ts";

// These run the app end to end (real git, password hashes, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

// Every app instance makes a temp dir of git repos; remove them all at the end.
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
export const local = async (extra?: Record<string, unknown>) => { const c = await boot(extra); opened.push(c); return c; };

export const post = (call: Call, user: string | null, path: string, body: unknown) =>
  call(user, path, { method: "POST", body: JSON.stringify(body) });

/** The app with accounts on, and helpers to sign up, pick a handle and ask who you are. */
export async function accounts(extra: Record<string, unknown> = {}) {
  const origin = "http://codesplitter.local";
  const call = await local({ BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: origin, ...extra });
  const signup = async (email: string, name: string, headers: Record<string, string> = {}) => {
    const res = await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin, ...headers },
      body: JSON.stringify({ email, password: "correct horse battery", name }) });
    return (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")!]).map((c) => c.split(";")[0]).join("; ");
  };
  const session = async (cookie = "") => (await (await call(null, "/api/session", { headers: { cookie } })).json()) as any;
  const claim = (cookie: string, name: string, headers: Record<string, string> = {}) =>
    call(null, "/api/handle", { method: "POST", headers: { cookie, ...headers }, body: JSON.stringify({ name }) });
  /** Sign up and claim `handle`: the cookie of someone ready to dig. */
  const person = async (email: string, handle: string) => { const c = await signup(email, handle); expect((await claim(c, handle)).status).toBe(201); return c; };
  return { call, signup, session, claim, person };
}
