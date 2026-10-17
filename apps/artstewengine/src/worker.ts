// Have you paid? POST /lease { license } answers with the engine's key if a payment is on record,
// 402 if not. The owner grants and revokes with PUT/DELETE /paid/<license> and the admin token.
// Stateless beyond one KV namespace: a revoked license stops getting keys on its next lease.

export interface KV {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface Env { PAYMENTS: KV; ENGINE_KEY?: string; ADMIN_TOKEN?: string }

/** How long a lease is good for: qCRM re-asks after this, and keeps working through an outage for a day more. */
export const LEASE_SECONDS = 3600;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Constant-time compare, so the admin token can't be guessed byte by byte. */
function same(a: string, b: string) {
  const [x, y] = [new TextEncoder().encode(a), new TextEncoder().encode(b)];
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (pathname === "/lease" && req.method === "POST") {
      const body = await req.json().catch(() => null) as { license?: unknown } | null;
      const license = typeof body?.license === "string" ? body.license : "";
      if (!license || license.length > 200 || !env.ENGINE_KEY) return json({ ok: false, error: "no pay, bye bye" }, 402);
      const paid = await env.PAYMENTS.get<{ who: string }>(`paid:${license}`, "json");
      if (!paid) return json({ ok: false, error: "no pay, bye bye" }, 402);
      return json({ ok: true, key: env.ENGINE_KEY, seconds: LEASE_SECONDS });
    }

    const m = pathname.match(/^\/paid\/([^/]{1,200})$/);
    if (m) {
      const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (!env.ADMIN_TOKEN || !same(token, env.ADMIN_TOKEN)) return json({ error: "no" }, 401);
      const key = `paid:${decodeURIComponent(m[1]!)}`;
      if (req.method === "DELETE") { await env.PAYMENTS.delete(key); return json({ ok: true }); }
      if (req.method === "PUT") {
        const b = await req.json().catch(() => null) as { who?: string; days?: number } | null;
        // KV needs a TTL of at least 60 s; no days means paid until revoked.
        const ttl = b?.days ? Math.max(60, Math.round(b.days * 86400)) : undefined;
        await env.PAYMENTS.put(key, JSON.stringify({ who: b?.who ?? "" }), ttl ? { expirationTtl: ttl } : undefined);
        return json({ ok: true });
      }
    }
    return json({ error: "not found" }, 404);
  },
};
