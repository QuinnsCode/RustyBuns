// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Webhooks, both ways, for any store. Every route needs an admin (the org's script key, or the shop signed in).
//
//   GET    /api/orgs/<org>/hooks              its webhooks and the last 20 deliveries (Hooks)
//   POST   /api/orgs/<org>/hooks              a new webhook (HookRequest -> HookReply): its signing secret is shown once
//   DELETE /api/orgs/<org>/hooks/<id>         remove one
//   POST   /api/orgs/<org>/hooks/<id>/test    send it a "test" event now (-> Delivery)
//   POST   /api/orgs/<org>/orders             an order came in (OrderRequest -> OrderReply): recorded once, its print
//                                             files laid out, and order.ready fired with their links
//
// Out: each event is one HookEvent body, signed (hook-sign.ts), sent at once; a non-2xx or no answer is tried again
// at 1 min, 5 min, 30 min, 2 h and 12 h by the cron (retryDue, from worker.ts scheduled), then marked failed. A cron
// trigger and a few D1 rows cost nothing on the free plan, so no Queue or Durable Object.
import { b64url, digest, unb64url } from "@rustybuns/util/bytes";
import { check } from "@rustybuns/util/guard";
import { privateJson, readJson } from "@rustybuns/util/http";
import { Delivery, EVENT_TYPES, HOOK_EVENTS, HookEvent, HookRequest, OrderReply, OrderRequest, PrintPlan, type HookReply, type Hooks, type OrderLine } from "./api.ts";
import { signHook, SIGNATURE } from "./hook-sign.ts";
import { designKey } from "./layout.ts";
import { printPlanRoute } from "./print.ts";
import type { Env } from "./worker.ts";

export const HOOKS_MAX = 5;
const LOG = 20;
/** Seconds to wait before each retry; one more failure after the last and it is marked failed. */
export const BACKOFF_S = [60, 300, 1800, 7200, 43_200];
const TIMEOUT_MS = 10_000;

/** Somewhere to keep a promise running after the reply: the Worker's ctx, or nowhere (local: it is awaited). */
export type Later = { waitUntil(p: Promise<unknown>): void } | undefined;
export const later = async (ctx: Later, p: Promise<unknown>) => { if (ctx) ctx.waitUntil(p); else await p; };

const rid = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

// The signing secret, sealed in D1 with AES-GCM under a key made from UPLOAD_SECRET: a leaked table signs nothing.
const sealKey = async (env: Env) =>
  crypto.subtle.importKey("raw", await digest(`qview3d hooks|${env.UPLOAD_SECRET}`) as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt", "decrypt"]);
async function seal(env: Env, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(env), new TextEncoder().encode(secret)));
  return `${b64url(iv)}.${b64url(ct)}`;
}
async function unseal(env: Env, sealed: string): Promise<string | null> {
  const [iv, ct] = sealed.split(".");
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(iv!) }, await sealKey(env), unb64url(ct!))); } catch { return null; }
}

type HookRow = { id: string; url: string; secret: string; events: string; created: number };
type DeliveryRow = { id: string; org: string; hook: string; event: string; body: string; status: string; attempts: number; code: number | null; error: string | null; at: number; next: number | null };

const eventsOf = (row: HookRow): string[] => { try { const v: unknown = JSON.parse(row.events); return Array.isArray(v) ? v.filter((e) => typeof e === "string") : []; } catch { return []; } };
const asDelivery = (r: DeliveryRow): Delivery | null =>
  check(Delivery, { id: r.id, hook: r.hook, event: r.event, status: r.status, attempts: r.attempts, code: r.code ?? undefined, error: r.error ?? undefined, at: r.at, next: r.next ?? undefined });

/** One try of one delivery: signed now, sent, and the row moved on (ok, the next retry, or failed). */
async function attempt(env: Env, d: DeliveryRow, now = Date.now()): Promise<DeliveryRow> {
  const hook = await env.DB.prepare("SELECT id, url, secret, events, created FROM hooks WHERE org = ? AND id = ?").bind(d.org, d.hook).first<HookRow>();
  const secret = hook ? await unseal(env, hook.secret) : null;
  let code: number | null = null, error: string | null = null;
  if (!hook || !secret) error = hook ? "its secret can't be read: make a new webhook" : "the webhook was removed";
  else {
    try {
      const res = await fetch(hook.url, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "content-type": "application/json", "user-agent": "QView3D-Webhooks/1", [SIGNATURE]: await signHook(secret, d.body), "QView3D-Event": d.event, "QView3D-Delivery": d.id },
        body: d.body,
      });
      code = res.status;
      await res.body?.cancel();
      if (!res.ok) error = `answered ${res.status}`;
    } catch (e) { error = e instanceof Error && e.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : `couldn't reach it: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`; }
  }
  const attempts = d.attempts + 1;
  const wait = BACKOFF_S[attempts - 1];
  const status = !error ? "ok" : hook && secret && wait !== undefined ? "pending" : "failed";
  const next = status === "pending" ? now + wait! * 1000 : null;
  await env.DB.prepare("UPDATE deliveries SET status = ?, attempts = ?, code = ?, error = ?, next = ? WHERE id = ?").bind(status, attempts, code, error, next, d.id).run();
  return { ...d, status, attempts, code, error, next };
}

/** Sends `type` to every webhook of `org` that hears it. The caller hands the promise to `later`. */
export async function fire(env: Env, org: string, type: (typeof EVENT_TYPES)[number], data: HookEvent["data"], only?: string): Promise<DeliveryRow[]> {
  const { results } = await env.DB.prepare("SELECT id, url, secret, events, created FROM hooks WHERE org = ?").bind(org).all<HookRow>();
  const hooks = results.filter((h) => (only ? h.id === only : eventsOf(h).includes(type)));
  const out: DeliveryRow[] = [];
  for (const h of hooks) {
    const id = rid(16), at = Date.now();
    const body = JSON.stringify({ id, type, org, created: at, data } satisfies HookEvent);
    const row: DeliveryRow = { id, org, hook: h.id, event: type, body, status: "pending", attempts: 0, code: null, error: null, at, next: at };
    await env.DB.prepare("INSERT INTO deliveries (id, org, hook, event, body, status, attempts, at, next) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)").bind(id, org, h.id, type, body, at, at).run();
    out.push(await attempt(env, row));
  }
  // The org keeps its last LOG deliveries; pending ones stay until they are done.
  if (hooks.length) await env.DB.prepare("DELETE FROM deliveries WHERE org = ? AND status != 'pending' AND id NOT IN (SELECT id FROM deliveries WHERE org = ? ORDER BY at DESC, rowid DESC LIMIT ?)").bind(org, org, LOG).run();
  return out;
}

/** The cron's job: every delivery whose retry is due, tried again. */
export async function retryDue(env: Env, now = Date.now()) {
  const { results } = await env.DB.prepare("SELECT * FROM deliveries WHERE status = 'pending' AND next <= ? ORDER BY next LIMIT 50").bind(now).all<DeliveryRow>();
  for (const d of results) await attempt(env, d, now);
  return results.length;
}

/** The routes above. `what` is "hooks" or "orders", `id` and `test` the rest of the path. */
export async function hooksRoute(req: Request, env: Env, ctx: Later, org: string, what: string, id: string | undefined, test: boolean, origin: string, h: Record<string, string>): Promise<Response> {
  const fail = (why: string, status: number) => privateJson({ error: why }, status, h);
  if (what === "orders") {
    if (id || test || req.method !== "POST") return fail("not found", 404);
    return orderRoute(req, env, ctx, org, origin, h);
  }
  if (!id && req.method === "GET") {
    const { results: hooks } = await env.DB.prepare("SELECT id, url, secret, events, created FROM hooks WHERE org = ? ORDER BY created").bind(org).all<HookRow>();
    const { results: log } = await env.DB.prepare("SELECT * FROM deliveries WHERE org = ? ORDER BY at DESC, rowid DESC LIMIT ?").bind(org, LOG).all<DeliveryRow>();
    const reply: Hooks = {
      hooks: hooks.map((r) => ({ id: r.id, url: r.url, events: eventsOf(r).filter((e): e is (typeof HOOK_EVENTS)[number] => (HOOK_EVENTS as readonly string[]).includes(e)), created: r.created })),
      deliveries: log.map(asDelivery).filter((d): d is Delivery => !!d),
    };
    return privateJson(reply, 200, h);
  }
  if (!id && req.method === "POST") {
    if (!env.UPLOAD_SECRET) return fail("webhooks are not set up (UPLOAD_SECRET)", 503);
    const body = await readJson(req, HookRequest);
    if (!body) return fail("expected {url: https://..., events?: [\"design.saved\", \"order.ready\"]}", 400);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM hooks WHERE org = ?").bind(org).first<{ n: number }>();
    if ((count?.n ?? 0) >= HOOKS_MAX) return fail(`a shop has at most ${HOOKS_MAX} webhooks: remove one first`, 409);
    const hid = rid(12), secret = `whsec_${b64url(crypto.getRandomValues(new Uint8Array(24)))}`;
    await env.DB.prepare("INSERT INTO hooks (org, id, url, secret, events, created) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(org, hid, body.url, await seal(env, secret), JSON.stringify(body.events ?? HOOK_EVENTS), Date.now()).run();
    return privateJson({ id: hid, secret } satisfies HookReply, 201, h);
  }
  if (!id || !/^[0-9a-f]{24}$/.test(id)) return fail("unknown webhook", 404);
  const known = await env.DB.prepare("SELECT id FROM hooks WHERE org = ? AND id = ?").bind(org, id).first<{ id: string }>();
  if (!known) return fail("unknown webhook", 404);
  if (!test && req.method === "DELETE") {
    await env.DB.batch([env.DB.prepare("DELETE FROM hooks WHERE org = ? AND id = ?").bind(org, id), env.DB.prepare("DELETE FROM deliveries WHERE org = ? AND hook = ?").bind(org, id)]);
    return privateJson({ removed: id }, 200, h);
  }
  if (test && req.method === "POST") {
    const [sent] = await fire(env, org, "test", {}, id);
    const d = sent && asDelivery(sent);
    return d ? privateJson(d, 200, h) : fail("the test couldn't be sent", 500);
  }
  return fail("not found", 404);
}

/** An order: each line's design must be the org's; its print plan is laid out; order.ready goes to the shop's webhooks. */
async function orderRoute(req: Request, env: Env, ctx: Later, org: string, origin: string, h: Record<string, string>): Promise<Response> {
  const fail = (why: string, status: number) => privateJson({ error: why }, status, h);
  const body = await readJson(req, OrderRequest);
  if (!body) return fail("expected {id, lines: [{design, qty?}]}", 400);
  const was = await env.DB.prepare("SELECT body FROM orders WHERE org = ? AND id = ?").bind(org, body.id).first<{ body: string }>();
  if (was) {
    let kept: unknown = null;
    try { kept = JSON.parse(was.body); } catch { /* a broken row reads as missing */ }
    const reply = check(OrderReply, kept);
    if (reply) return privateJson({ ...reply, fresh: false } satisfies OrderReply, 200, h);
  }
  const lines: OrderLine[] = [];
  for (const l of body.lines) {
    if (!(await env.BUCKET.head(designKey(org, l.design)))) return fail(`design ${l.design}: not one of this org's saved designs`, 400);
    // The print plan, as an admin would get it from GET .../designs/<id>/print.
    const plan = check(PrintPlan, await (await printPlanRoute(env, org, l.design, origin, {})).json());
    if (!plan) return fail(`design ${l.design}: its print files couldn't be laid out`, 500);
    lines.push({ design: l.design, qty: l.qty, print: `${origin}/api/orgs/${org}/designs/${l.design}/print`, sheets: plan.sheets, skipped: plan.skipped });
  }
  const reply: OrderReply = { id: body.id, lines, created: Date.now(), fresh: true };
  await env.DB.prepare("INSERT OR IGNORE INTO orders (org, id, body, created) VALUES (?, ?, ?, ?)").bind(org, body.id, JSON.stringify(reply), reply.created).run();
  await later(ctx, fire(env, org, "order.ready", { order: body.id, lines }));
  return privateJson(reply, 201, h);
}
