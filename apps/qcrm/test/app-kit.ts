// What the qCRM tests share: the app in-process (src/local.ts), signing up through Better Auth
// and carrying the cookie, and a POST helper. Each test file gets its own copy, so its own apps to close.
import { afterAll, setDefaultTimeout } from "bun:test";
import { local as boot, type Call } from "../src/local.ts";

// Password hashing and a seeded org make some tests slow on a busy machine; bun's 5 s default is tight.
setDefaultTimeout(30_000);

// Tests read response bodies as whatever the route sends; `unknown` would mean a cast on every line.
declare global { interface Body { json(): Promise<any> } }

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
export const local = async (extra?: Record<string, unknown>) => { const c = await boot(extra); opened.push(c); return c; };

export const post = (call: Call, cookie: string, path: string, body: unknown, method = "POST") =>
  call(cookie, path, { method, body: JSON.stringify(body) });

/** Sign up through Better Auth: the cookie string of a signed-in person. */
export async function signup(call: Call, email: string, name = email.split("@")[0]!) {
  const res = await post(call, "", "/api/auth/sign-up/email", { email, password: "correct horse battery", name });
  if (res.status !== 200) throw new Error(`sign-up ${res.status}: ${await res.text()}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

/** Sign up and read back the person's own org id and user id. */
export async function person(call: Call, email: string) {
  const cookie = await signup(call, email);
  const me = (await (await call(cookie, "/api/me")).json()) as { user: { id: string; email: string }; orgs: { id: string; role: string }[] };
  return { cookie, user: me.user, org: me.orgs[0]!.id };
}
