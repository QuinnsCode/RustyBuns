// Outgoing webhooks: tell the outside world (CI, a chat bot) when something
// happens in a repo. The owner adds a URL per hook, picks its events, and gets
// a secret; every delivery is a POST of GitHub-shaped JSON, signed with
// HMAC-SHA256 of the body in `X-CodeSplitters-Signature: sha256=<hex>`, the way
// GitHub signs `X-Hub-Signature-256`.
//
//   commit           main was catalogued and pushed to git (GitHub's `push`)
//   branch.opened    a branch was opened (GitHub's `create`)
//   branch.merged    a branch merged into main (a merged `pull_request`)
//   deploy.finished  a real deploy finished, either way (`deployment_status`)
//
// Every delivery is logged, and every try is a message on the HOOKS queue
// (Cloudflare Queues; sqlite in the desktop's own process): the first goes out
// at once, and a failed one books the next on the queue after 1, 5, 30 and 120
// minutes, then is given up.
//
//   GET    /api/repos/:o/:r/hooks                           the hooks, each with its last delivery (owner only)
//   POST   /api/repos/:o/:r/hooks                           {url, events?, secret?}: the secret is shown this once
//   DELETE /api/repos/:o/:r/hooks/:id
//   GET    /api/repos/:o/:r/hooks/:id/deliveries            the last 20
//   POST   /api/repos/:o/:r/hooks/:id/deliveries/:d/redeliver

import { json, type Env } from "./env.ts";

export const EVENTS = ["commit", "branch.opened", "branch.merged", "deploy.finished"] as const;
export type Event = (typeof EVENTS)[number];
/** Minutes to wait after each failed try; past the last one, the delivery is given up. */
const BACKOFF = [1, 5, 30, 120];
const MAX_HOOKS = 10;

/** A message on the queue: try `id` again, as its try number `n + 1`. */
export interface HookMessage { id: string; n: number }

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

interface Delivery { id: string; event: string; payload: string; attempts: number }

/** One try: POST it and log the answer. Says how many seconds until the next try, or null when there's none. */
async function attempt(env: Env, d: Delivery, url: string, secret: string) {
  const send = (env.HOOK_FETCH as typeof fetch | undefined) ?? fetch;
  let code = 0, response = "";
  try {
    const res = await send(url, {
      method: "POST",
      body: d.payload,
      headers: {
        "content-type": "application/json",
        "user-agent": "codeSplitters-Hookshot",
        "x-codesplitters-event": d.event,
        "x-codesplitters-delivery": d.id,
        "x-codesplitters-signature": await sign(secret, d.payload),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    code = res.status;
    response = (await res.text().catch(() => "")).slice(0, 1000);
  } catch (e) {
    response = (e as Error).message.slice(0, 1000);
  }
  const ok = code >= 200 && code < 300, tries = d.attempts + 1;
  const status = ok ? "ok" : tries > BACKOFF.length ? "failed" : "pending";
  const wait = status === "pending" ? BACKOFF[tries - 1]! * 60 : null;
  await env.DB.prepare("UPDATE webhook_deliveries SET status = ?, attempts = ?, next_at = ?, code = ?, response = ? WHERE id = ?")
    .bind(status, tries, wait === null ? null : Date.now() + wait * 1000, code, response, d.id).run();
  return wait;
}

/** Something happened in owner/repo: log a delivery to every hook that wants it, and queue their first tries. */
export async function emit(env: Env, owner: string, repo: string, event: Event, sender: string, data: Record<string, unknown>) {
  try {
    const { results } = await env.DB.prepare("SELECT id, url, secret, events FROM webhooks WHERE owner = ? AND repo = ?").bind(owner, repo).all();
    const hooks = (results as { id: string; url: string; secret: string; events: string }[]).filter((h) => h.events.split(",").includes(event));
    if (!hooks.length) return;
    const r = await env.DB.prepare("SELECT visibility FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
    const payload = JSON.stringify({
      ...data,
      repository: { name: repo, full_name: `${owner}/${repo}`, owner: { login: owner }, private: r?.visibility === "private", default_branch: "main" },
      sender: { login: sender },
    });
    const now = Date.now();
    const ids = hooks.map(() => crypto.randomUUID());
    await env.DB.batch(hooks.map((hook, i) => env.DB.prepare("INSERT INTO webhook_deliveries (id, hook, owner, repo, event, payload, status, next_at, at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)")
      .bind(ids[i], hook.id, owner, repo, event, payload, now, now)));
    await env.HOOKS.sendBatch(ids.map((id) => ({ body: { id, n: 0 } satisfies HookMessage })));
  } catch {
    // A hook never gets in the way of what happened.
  }
}

/**
 * The HOOKS queue's consumer: each message is one try. A message is stale once
 * its delivery has moved on (tried since, redelivered, or finished), and whoever
 * claims the delivery's next_at sends it, so a message the queue hands out twice
 * is sent once.
 */
export async function deliverHooks(batch: { messages: readonly { body: HookMessage; ack(): void }[] }, env: Env) {
  await Promise.all(batch.messages.map(async (m) => {
    const { id, n } = m.body;
    const d = await env.DB.prepare(`SELECT d.id, d.event, d.payload, d.attempts, d.next_at, h.url, h.secret FROM webhook_deliveries d
      LEFT JOIN webhooks h ON h.id = d.hook WHERE d.id = ? AND d.status = 'pending' AND d.attempts = ?`).bind(id, n).first() as (Delivery & { next_at: number | null; url: string | null; secret: string | null }) | null;
    if (d && !d.url) await env.DB.prepare("UPDATE webhook_deliveries SET status = 'failed', next_at = NULL, response = 'hook deleted' WHERE id = ?").bind(id).run();
    else if (d && d.next_at !== null) {
      const claim = await env.DB.prepare("UPDATE webhook_deliveries SET next_at = NULL WHERE id = ? AND attempts = ? AND next_at = ? AND status = 'pending'").bind(id, n, d.next_at).run();
      if (claim.meta?.changes) {
        const wait = await attempt(env, d, d.url!, d.secret!);
        if (wait !== null) await env.HOOKS.send({ id, n: n + 1 } satisfies HookMessage, { delaySeconds: wait });
      }
    }
    m.ack();
  }));
}

function checkUrl(u: unknown) {
  try {
    const url = new URL(String(u));
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

export async function hookRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "hooks")) return null;
  const [owner, repo, id] = [p[2], p[3], p[5]];
  // Hooks carry a secret and say what happens in the repo: the owner's alone.
  if (user !== owner) return json({ error: "only the repo's owner can manage its webhooks" }, 403);
  if (!(await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first())) return json({ error: "not found" }, 404);

  if (!id && req.method === "GET") {
    const { results } = await env.DB.prepare(`SELECT h.id, h.url, h.events, h.created_at,
      (SELECT json_object('event', d.event, 'status', d.status, 'code', d.code, 'at', d.at) FROM webhook_deliveries d WHERE d.hook = h.id ORDER BY d.at DESC LIMIT 1) AS last
      FROM webhooks h WHERE h.owner = ? AND h.repo = ? ORDER BY h.created_at`).bind(owner, repo).all();
    return json({ events: EVENTS, hooks: (results as any[]).map((h) => ({ ...h, events: h.events.split(","), last: h.last ? JSON.parse(h.last) : null })) });
  }
  if (!id && req.method === "POST") {
    const b = (await req.json().catch(() => ({}))) as { url?: string; events?: string[]; secret?: string };
    const url = checkUrl(b.url);
    if (!url) return json({ error: "url: an http(s) URL, without a password in it" }, 400);
    const events = b.events ?? [...EVENTS];
    if (!Array.isArray(events) || !events.length || events.some((e) => !EVENTS.includes(e as Event))) return json({ error: `events: some of ${EVENTS.join(", ")}` }, 400);
    if (b.secret !== undefined && (typeof b.secret !== "string" || b.secret.length < 16)) return json({ error: "secret: at least 16 characters, or leave it out for one made for you" }, 400);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM webhooks WHERE owner = ? AND repo = ?").bind(owner, repo).first();
    if ((n?.n ?? 0) >= MAX_HOOKS) return json({ error: `a repo has at most ${MAX_HOOKS} webhooks` }, 400);
    const hook = { id: crypto.randomUUID().slice(0, 8), url, events: [...new Set(events)], secret: b.secret ?? hex(crypto.getRandomValues(new Uint8Array(24)).buffer), created_at: Date.now() };
    await env.DB.prepare("INSERT INTO webhooks (id, owner, repo, url, secret, events, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(hook.id, owner, repo, hook.url, hook.secret, hook.events.join(","), hook.created_at).run();
    return json(hook, 201);
  }

  const hook = id && await env.DB.prepare("SELECT id, url, secret FROM webhooks WHERE id = ? AND owner = ? AND repo = ?").bind(id, owner, repo).first();
  if (!hook) return json({ error: "no such webhook" }, 404);
  if (!p[6] && req.method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM webhooks WHERE id = ?").bind(id),
      env.DB.prepare("DELETE FROM webhook_deliveries WHERE hook = ?").bind(id),
    ]);
    return json({ ok: true });
  }
  if (p[6] === "deliveries" && !p[7] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, event, status, attempts, next_at, code, response, payload, at FROM webhook_deliveries WHERE hook = ? ORDER BY at DESC LIMIT 20").bind(id).all();
    return json(results);
  }
  if (p[6] === "deliveries" && p[7] && p[8] === "redeliver" && req.method === "POST") {
    const d = await env.DB.prepare("SELECT id FROM webhook_deliveries WHERE id = ? AND hook = ?").bind(p[7], id).first();
    if (!d) return json({ error: "no such delivery" }, 404);
    // A fresh run of tries, starting now; messages left from the last run are stale.
    await env.DB.prepare("UPDATE webhook_deliveries SET status = 'pending', attempts = 0, next_at = ? WHERE id = ?").bind(Date.now(), d.id).run();
    await env.HOOKS.send({ id: d.id as string, n: 0 } satisfies HookMessage);
    return json({ ok: true }, 202);
  }
  return null;
}
