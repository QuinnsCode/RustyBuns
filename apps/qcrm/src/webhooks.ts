// Outgoing webhooks: an owner adds a URL and the events it wants; every event is a POST of
// JSON signed with HMAC-SHA256 of the body (`x-qcrm-signature: sha256=<hex>`), the way GitHub
// signs. Every delivery is a row, every try a message on the HOOKS queue: the first goes out at
// once, a failed one books the next after min(60 * 2^attempt, 3600) seconds, and after 8 tries
// the delivery is "dead".
//
//   GET    /api/orgs/:org/webhooks                     (owner+)
//   POST   /api/orgs/:org/webhooks {url, events?}      the secret is shown this once
//   PUT    /api/orgs/:org/webhooks/:id {url?, events?, disabled?}
//   DELETE /api/orgs/:org/webhooks/:id
//   GET    /api/orgs/:org/webhooks/:id/deliveries      the last 50
//   POST   /api/orgs/:org/webhooks/:id/deliveries/:delivery/replay   send it again as a fresh first try (409 while it waits)
//
// URLs must be https, and never a private or loopback address literal. When BETTER_AUTH_URL is
// http:// the app runs on someone's own machine (the desktop, tests), and there http and
// loopback are allowed: the receiver is the same machine.

import { error, hex, json, parseJson, readBody, type Env, type HookMessage } from "./env.ts";
import type { Ctx } from "./orgs.ts";

const ENTITIES = ["contact", "company", "deal", "activity"] as const;
export const EVENTS = [...ENTITIES.flatMap((e) => [`${e}.created`, `${e}.updated`, `${e}.deleted`]), "member.added", "member.changed", "member.removed"] as const;
export type Event = (typeof EVENTS)[number];
const MAX_ATTEMPTS = 8;
const MAX_HOOKS = 10;

export async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

const local = (env: Env) => !!env.BETTER_AUTH_URL?.startsWith("http://");

/** Whether `host` is an address literal that points inward: loopback, RFC 1918, link-local, CGNAT, IPv6 private. */
export function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  const a = /^\d+\.\d+\.\d+\.\d+$/.test(h) ? h.split(".").map(Number) : null;
  if (a) {
    const [x, y] = a as [number, number];
    return x === 0 || x === 10 || x === 127 || x >= 224 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127);
  }
  if (!h.includes(":")) return false;
  const mapped = /(\d+\.\d+\.\d+\.\d+)$/.exec(h)?.[1];
  return h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("ff") || (!!mapped && privateHost(mapped));
}

function checkUrl(env: Env, u: unknown) {
  try {
    const url = new URL(String(u));
    const scheme = url.protocol === "https:" || (local(env) && url.protocol === "http:");
    return scheme && !url.username && !url.password && (local(env) || !privateHost(url.hostname)) ? url.toString() : null;
  } catch { return null; }
}

/** Something happened in `org`: a delivery row per hook that listens, and its first try on the queue. */
export async function emit(env: Env, org: string, event: Event, data: Record<string, unknown>) {
  try {
    const { results } = await env.DB.prepare("SELECT id, events FROM webhooks WHERE org_id = ? AND disabled = 0").bind(org).all<{ id: string; events: string }>();
    const hooks = results.filter((h) => parseJson<string[]>(h.events, []).includes(event));
    if (!hooks.length) return;
    const now = Date.now();
    const payload = JSON.stringify({ event, org, at: now, data });
    const ids = hooks.map(() => crypto.randomUUID());
    await env.DB.batch(hooks.map((h, i) => env.DB.prepare("INSERT INTO webhook_deliveries (id, webhook_id, org_id, event, payload, status, attempts, next_at, created_at) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)")
      .bind(ids[i], h.id, org, event, payload, now, now)));
    for (const id of ids) await env.HOOKS?.send({ delivery: id, attempt: 1 });
  } catch {
    // A hook never gets in the way of what happened.
  }
}

/**
 * One try of a delivery. Stale messages (the row moved on since) are dropped: a message the
 * queue hands out twice is sent once.
 */
export async function deliver(env: Env, { delivery, attempt }: HookMessage) {
  const d = await env.DB.prepare(`SELECT d.id, d.event, d.payload, d.attempts, h.url, h.secret FROM webhook_deliveries d LEFT JOIN webhooks h ON h.id = d.webhook_id
    WHERE d.id = ? AND d.status = 'pending'`).bind(delivery).first<{ id: string; event: string; payload: string; attempts: number; url: string | null; secret: string | null }>();
  if (!d || d.attempts !== attempt - 1) return;
  if (!d.url || !d.secret) { await env.DB.prepare("UPDATE webhook_deliveries SET status = 'dead', next_at = NULL WHERE id = ?").bind(d.id).run(); return; }
  let code = 0;
  try {
    const res = await fetch(d.url, {
      method: "POST", body: d.payload, redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", "user-agent": "qCRM-Hookshot", "x-qcrm-event": d.event, "x-qcrm-delivery": d.id, "x-qcrm-signature": await sign(d.secret, d.payload) },
    });
    code = res.status;
    await res.body?.cancel();
  } catch { /* code stays 0: unreachable or timed out */ }
  const ok = code >= 200 && code < 300;
  const status = ok ? "ok" : attempt >= MAX_ATTEMPTS ? "dead" : "pending";
  const delay = status === "pending" ? Math.min(60 * 2 ** attempt, 3600) : null;
  await env.DB.prepare("UPDATE webhook_deliveries SET status = ?, attempts = ?, next_at = ?, last_code = ? WHERE id = ?")
    .bind(status, attempt, delay === null ? null : Date.now() + delay * 1000, code, d.id).run();
  if (delay !== null) await env.HOOKS?.send({ delivery: d.id, attempt: attempt + 1 }, { delaySeconds: delay });
}

const shown = (h: Record<string, unknown>) => ({ ...h, events: parseJson(h.events, []), disabled: !!h.disabled });

export async function webhookRoutes({ req, env, org, p, audit }: Ctx): Promise<Response | null> {
  if (p[0] !== "webhooks") return null;
  if (!p[1] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, url, events, created_at, disabled FROM webhooks WHERE org_id = ? ORDER BY created_at").bind(org).all();
    return json({ events: EVENTS, webhooks: results.map(shown) });
  }
  if (!p[1] && req.method === "POST") {
    const b = await readBody<{ url?: unknown; events?: unknown }>(req);
    const url = checkUrl(env, b?.url);
    if (!url) return error(400, "url: an https URL out on the internet, without a password in it");
    const events = b?.events === undefined ? [...EVENTS] : b.events;
    if (!Array.isArray(events) || !events.length || events.some((e) => !(EVENTS as readonly string[]).includes(e))) return error(400, `events: some of ${EVENTS.join(", ")}`);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM webhooks WHERE org_id = ?").bind(org).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_HOOKS) return error(400, `an org has at most ${MAX_HOOKS} webhooks`);
    const hook = { id: crypto.randomUUID(), url, events: [...new Set(events as string[])], secret: hex(crypto.getRandomValues(new Uint8Array(24))), created_at: Date.now(), disabled: false };
    await env.DB.prepare("INSERT INTO webhooks (id, org_id, url, events, secret, created_at, disabled) VALUES (?, ?, ?, ?, ?, ?, 0)")
      .bind(hook.id, org, url, JSON.stringify(hook.events), hook.secret, hook.created_at).run();
    await audit("webhook.create", hook.id, new URL(url).host);
    return json(hook, 201);
  }
  const hook = p[1] ? await env.DB.prepare("SELECT id, url, events, created_at, disabled FROM webhooks WHERE id = ? AND org_id = ?").bind(p[1], org).first() : null;
  if (!hook) return error(404, "no such webhook");
  if (!p[2] && req.method === "PUT") {
    const b = await readBody<{ url?: unknown; events?: unknown; disabled?: unknown }>(req);
    const url = b?.url === undefined ? hook.url : checkUrl(env, b.url);
    if (!url) return error(400, "url: an https URL out on the internet");
    const events = b?.events === undefined ? parseJson(hook.events, []) : b.events;
    if (!Array.isArray(events) || !events.length || events.some((e) => !(EVENTS as readonly string[]).includes(e))) return error(400, `events: some of ${EVENTS.join(", ")}`);
    const disabled = b?.disabled === undefined ? !!hook.disabled : b.disabled === true;
    await env.DB.prepare("UPDATE webhooks SET url = ?, events = ?, disabled = ? WHERE id = ?").bind(url, JSON.stringify(events), disabled ? 1 : 0, hook.id).run();
    await audit("webhook.update", hook.id as string);
    return json(shown({ ...hook, url, events: JSON.stringify(events), disabled }));
  }
  if (!p[2] && req.method === "DELETE") {
    await env.DB.batch([env.DB.prepare("DELETE FROM webhooks WHERE id = ?").bind(hook.id), env.DB.prepare("DELETE FROM webhook_deliveries WHERE webhook_id = ?").bind(hook.id)]);
    await audit("webhook.delete", hook.id as string);
    return json({ ok: true });
  }
  if (p[2] === "deliveries" && !p[3] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, event, status, attempts, next_at, last_code, created_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50").bind(hook.id).all();
    return json(results);
  }
  if (p[2] === "deliveries" && p[3] && p[4] === "replay" && !p[5] && req.method === "POST") {
    const d = await env.DB.prepare("SELECT id, status FROM webhook_deliveries WHERE id = ? AND webhook_id = ?").bind(p[3], hook.id).first<{ id: string; status: string }>();
    if (!d) return error(404, "no such delivery");
    if (d.status === "pending") return error(409, "it is still waiting for a try");
    // Back to attempt 0: a retry message still queued for an older attempt no longer matches and is dropped.
    await env.DB.prepare("UPDATE webhook_deliveries SET status = 'pending', attempts = 0, next_at = ?, last_code = NULL WHERE id = ?").bind(Date.now(), d.id).run();
    await env.HOOKS?.send({ delivery: d.id, attempt: 1 });
    await audit("webhook.replay", hook.id as string, d.id);
    return json({ ok: true });
  }
  return null;
}
