// Everything that isn't a page: the lease the engine calls, /health, and the admin's forms.
// Returns null for a path that is none of these, so the router goes on to the pages.
import { adminOf, authFor, authOn, needsSetup, sameEmail } from "./auth.ts";
import { crossSite, json, VERSION, type Env } from "./env.ts";
import { grant, lease, setRevoked } from "./licenses.ts";

const see = (to: string, from?: Response) => {
  const headers = new Headers({ location: to });
  for (const c of from?.headers.getSetCookie?.() ?? []) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
};
const field = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function handle(req: Request, conf: Env): Promise<Response | null> {
  const { pathname } = new URL(req.url);

  if (pathname === "/lease" && req.method === "POST") {
    return lease(conf, await req.json().catch(() => null) as never);
  }

  // Public and thin: up or down, nothing about who has paid. The detail is on the admin page.
  if (pathname === "/health" && req.method === "GET") {
    const db = await conf.DB.prepare("SELECT 1 AS n").first().then(() => true, () => false);
    return json({ ok: db && authOn(conf) && !!conf.ENGINE_KEY, db, auth: authOn(conf), key: !!conf.ENGINE_KEY, version: VERSION }, db ? 200 : 503);
  }

  if (!pathname.startsWith("/do/") || req.method !== "POST") return null;
  if (crossSite(req, conf)) return json({ error: "cross-site request refused" }, 403);
  if (!authOn(conf)) return json({ error: "accounts off" }, 503);
  const act = pathname.slice(4);
  const form = await req.formData().catch(() => new FormData());

  if (act === "login" || act === "setup") {
    if (await conf.AUTH_LIMIT?.limit({ key: req.headers.get("cf-connecting-ip") ?? "local" }).then((r) => !r.success)) return json({ error: "too many sign-in attempts: wait a minute" }, 429, );
    const email = field(form, "email"), password = field(form, "password");
    const auth = authFor(req, conf);
    // The first account is the admin's, and only with the admin's email; after that there is only sign-in.
    if (act === "setup") {
      if (!(await needsSetup(conf)) || !sameEmail(email, conf.ADMIN_EMAIL!)) return see("/login?e=setup");
      const made = await auth.api.signUpEmail({ body: { email, password, name: "admin" }, asResponse: true }).catch(() => null);
      return made?.ok ? see("/admin", made) : see("/login?e=setup");
    }
    const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true }).catch(() => null);
    return res?.ok && sameEmail(email, conf.ADMIN_EMAIL!) ? see("/admin", res) : see("/login?e=bad");
  }

  const admin = await adminOf(req, conf);
  if (!admin) return see("/login");

  if (act === "logout") return see("/login", await authFor(req, conf).api.signOut({ headers: req.headers, asResponse: true }));
  if (act === "grant") {
    const who = field(form, "who").trim();
    if (!who) return see("/admin?e=who");
    const days = Number(field(form, "days"));
    await grant(conf, who, Number.isFinite(days) && days > 0 ? days : null);
    return see("/admin?made=1");
  }
  if (act === "revoke" || act === "restore") {
    await setRevoked(conf, field(form, "license"), act === "revoke");
    return see("/admin");
  }
  return json({ error: "not found" }, 404);
}
