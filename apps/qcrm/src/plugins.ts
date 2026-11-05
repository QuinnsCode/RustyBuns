// Plugins, the first integrations: Twilio and Plivo send a text from a contact and file replies on the
// contact's timeline; "form" is a secret URL a website form, Zapier, Make or n8n POSTs a lead to.
//
//   GET    /api/orgs/:org/plugins                       every kind, connected or not, config masked (any member)
//   PUT    /api/orgs/:org/plugins/:kind {…, rotate?, disabled?}   connect or change (owner+); the inbound URL shows once
//   DELETE /api/orgs/:org/plugins/:kind                 (owner+)
//   POST   /api/orgs/:org/contacts/:id/sms {body, via?}  send through twilio or plivo, log an "sms" activity (employee+)
//   POST   /api/in/:token                               public: a provider's inbound SMS, or a form post. src/api.ts
//                                                       routes it before sign-in; it is not in openapi.ts, since
//                                                       providers and websites call it, not agents.
//
// Auth tokens are AES-GCM encrypted at rest under HKDF(BETTER_AUTH_SECRET, info "qcrm-plugins") and never leave
// the server: a read shows "…a1b2". An inbound token is 24 random bytes kept only as its SHA-256; its URL is
// shown when it is made or rotated, and after that only its tail.
//
// A provider signs an inbound SMS with the auth token over the URL it was sent to. That URL is BETTER_AUTH_URL
// plus the path (the public origin), never req.url, which Cloudflare may rewrite. Demo and scenario orgs can't
// connect a phone plugin: a text costs someone money.

import { unb64url } from "@rustybuns/util/bytes";
import { arr, Bad, bool, check, obj, oneOf, opt, str, type Guard, type Of } from "@rustybuns/util/guard";
import { createRow, getRow, updateRow } from "./crm.ts";
import { demoRows, isDemo } from "./demo-snapshot.ts";
import { b64url, error, json, parseJson, readBody, sha256, type Env, type Row } from "./env.ts";
import { orgRow, type Ctx } from "./orgs.ts";
import { can } from "./rbac.ts";

export const KINDS = ["twilio", "plivo", "form"] as const;
export type Kind = (typeof KINDS)[number];
const PHONE_KINDS = ["twilio", "plivo"] as const;
type PhoneKind = (typeof PHONE_KINDS)[number];
const isKind = (k: unknown): k is Kind => KINDS.some((x) => x === k);
/** What each phone kind calls its account id in the API. */
const ACCOUNT = { twilio: "account_sid", plivo: "auth_id" } as const;
const MAX_BODY = 16 * 1024;
const SMS_MAX = 1600;
const TIMEOUT = 10_000;

interface PluginRow { id: string; org_id: string; kind: string; config: string; token_tail: string; created_at: number; updated_at: number; disabled: number }

// ---- Phone numbers ----

/** A number's digits for matching: the last ten when there are more, so a country code or trunk prefix doesn't matter. */
export const phoneKey = (s: string) => { const d = s.replace(/\D/g, ""); return d.length > 10 ? d.slice(-10) : d; };

/** `s` as E.164 (+ and digits), or null. Ten digits without a + read as North American (+1); a leading 00 is the international prefix. */
export function e164(s: string): string | null {
  const t = s.trim();
  let d = t.replace(/\D/g, "");
  if (!t.startsWith("+") && t.startsWith("00")) d = d.slice(2);
  else if (!t.startsWith("+") && d.length === 10) d = "1" + d;
  return /^[1-9]\d{6,14}$/.test(d) ? "+" + d : null;
}

const phone: Guard<string> = (v) => (typeof v === "string" && e164(v)) || bad("a phone number in E.164, like +15551234567");
const bad = (why: string): never => { throw new Bad(why); };

// ---- Secrets at rest ----

const enc = (s: string) => new TextEncoder().encode(s);
const keys = new Map<string, Promise<CryptoKey>>();
const keyFor = (secret: string) => {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc(secret), "HKDF", false, ["deriveKey"]).then((base) => crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc("qcrm-plugins") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
    keys.set(secret, k);
  }
  return k;
};

/** `plain` encrypted: "v1.<iv>.<ciphertext>", base64url. */
export async function seal(env: Env, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(env.BETTER_AUTH_SECRET!), enc(plain));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

/** What `seal` made, or null when it was made under another secret or isn't one. */
export async function unseal(env: Env, sealed: string): Promise<string | null> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) return null;
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(iv) }, await keyFor(env.BETTER_AUTH_SECRET!), unb64url(ct))); } catch { return null; }
}

// ---- Stored config ----

/** A phone plugin's config as stored: the account id, the sending number, the sealed token and its last four. */
const Stored = obj({ account: str(64), from: str(20), auth_token: str(2000), tail: str(8) });
type Stored = Of<typeof Stored>;
const stored = (row: PluginRow) => check(Stored, parseJson<unknown>(row.config, null));

interface Phone { kind: PhoneKind; account: string; from: string; token: string }
async function unpack(env: Env, row: PluginRow): Promise<Phone | null> {
  const c = stored(row);
  const token = c && (await unseal(env, c.auth_token));
  return c && token && (row.kind === "twilio" || row.kind === "plivo") ? { kind: row.kind, account: c.account, from: c.from, token } : null;
}

const origin = (env: Env, url: URL) => env.BETTER_AUTH_URL ?? url.origin;

/** A plugin as the API shows it. `fresh` is a token just made: its URL is shown this once. */
function view(env: Env, url: URL, kind: Kind, row: PluginRow | null, fresh?: string) {
  const c = row && kind !== "form" ? stored(row) : null;
  return {
    kind, connected: !!row, disabled: !!row?.disabled,
    config: c && kind !== "form" ? { [ACCOUNT[kind]]: c.account, from: c.from, auth_token: `…${c.tail}` } : {},
    inbound_url: fresh ? `${origin(env, url)}/api/in/${fresh}` : row ? `${origin(env, url)}/api/in/…${row.token_tail}` : null,
    created_at: row?.created_at ?? null, updated_at: row?.updated_at ?? null,
  };
}

const newToken = () => "in_" + b64url(crypto.getRandomValues(new Uint8Array(24)));

// ---- Org routes ----

const PutBody = obj({
  account_sid: opt(str(64, { re: /^AC[0-9a-fA-F]{32}$/ })), auth_id: opt(str(40, { re: /^[A-Za-z0-9]{10,40}$/ })),
  auth_token: opt(str(128, { min: 8, re: /^\S+$/ })), from: opt(phone), rotate: opt(bool()), disabled: opt(bool()),
});
const SmsBody = obj({ body: str(SMS_MAX), via: opt(oneOf(PHONE_KINDS)) });

/** A guard's value, or the 400 it explains. */
function read<T>(g: Guard<T>, v: unknown): T | Response {
  try { return g(v); } catch (e) { if (e instanceof Bad) return error(400, e.message); throw e; }
}

const rowOf = (env: Env, org: string, kind: string) => env.DB.prepare("SELECT * FROM plugins WHERE org_id = ? AND kind = ?").bind(org, kind).first<PluginRow>();

export async function pluginRoutes(ctx: Ctx): Promise<Response | null> {
  const { req, env, url, org, role, p } = ctx;
  if (p[0] === "contacts" && p[1] && p[2] === "sms" && !p[3] && req.method === "POST") return sendSms(ctx, p[1]);
  if (p[0] !== "plugins" || p[2]) return null;
  if (!p[1] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM plugins WHERE org_id = ?").bind(org).all<PluginRow>();
    return json(KINDS.map((k) => view(env, url, k, results.find((r) => r.kind === k) ?? null)));
  }
  const kind = p[1];
  if (!isKind(kind)) return error(404, `no such plugin: one of ${KINDS.join(", ")}`);
  if (req.method !== "PUT" && req.method !== "DELETE") return null;
  if (!can(role, "plugins")) return error(403, "owners and up connect plugins");
  const before = await rowOf(env, org, kind);
  if (req.method === "DELETE") {
    if (!before) return error(404, `${kind} isn't connected`);
    await env.DB.prepare("DELETE FROM plugins WHERE id = ?").bind(before.id).run();
    await ctx.audit("plugin.delete", kind, { kind });
    return json({ ok: true });
  }
  if (kind !== "form") {
    const plan = (await orgRow(env, org))?.plan;
    if (plan === "demo" || plan === "scenario") return error(403, `${kind} is not in a trial org: texts cost money, so make your own org first`);
  }
  const b = read(PutBody, (await readBody(req)) ?? {});
  if (b instanceof Response) return b;
  let config: Stored | Record<string, never> = {};
  if (kind !== "form") {
    const old = before && stored(before);
    const account = (kind === "twilio" ? b.account_sid : b.auth_id) ?? old?.account;
    const from = b.from ?? old?.from;
    const token = b.auth_token ? { auth_token: await seal(env, b.auth_token), tail: b.auth_token.slice(-4) } : old ? { auth_token: old.auth_token, tail: old.tail } : null;
    if (!account || !from || !token) return error(400, `${kind} needs ${ACCOUNT[kind]}, auth_token and from`);
    config = { account, from, ...token };
  }
  const fresh = !before || b.rotate === true ? newToken() : undefined;
  const now = Date.now();
  const disabled = b.disabled ?? !!before?.disabled;
  const row: PluginRow = { id: before?.id ?? crypto.randomUUID(), org_id: org, kind, config: JSON.stringify(config), token_tail: fresh?.slice(-4) ?? before!.token_tail, created_at: before?.created_at ?? now, updated_at: now, disabled: disabled ? 1 : 0 };
  if (before) {
    await env.DB.prepare(`UPDATE plugins SET config = ?, disabled = ?, updated_at = ?${fresh ? ", token_hash = ?, token_tail = ?" : ""} WHERE id = ?`)
      .bind(row.config, row.disabled, now, ...(fresh ? [await sha256(fresh), row.token_tail] : []), row.id).run();
  } else {
    await env.DB.prepare("INSERT INTO plugins (id, org_id, kind, config, token_hash, token_tail, created_at, updated_at, disabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(row.id, org, kind, row.config, await sha256(fresh!), row.token_tail, now, now, row.disabled).run();
  }
  // Which fields changed, never their values.
  const changed = Object.keys(b).filter((k) => k !== "rotate");
  await ctx.audit(before ? (fresh ? "plugin.rotate" : "plugin.update") : "plugin.connect", kind, { kind, changed });
  return json(view(env, url, kind, row, fresh));
}

/** The org's phone plugin: `via` when named, else Twilio, else Plivo. */
async function phonePlugin(env: Env, org: string, via?: PhoneKind) {
  const { results } = await env.DB.prepare("SELECT * FROM plugins WHERE org_id = ? AND kind IN ('twilio', 'plivo') AND disabled = 0").bind(org).all<PluginRow>();
  const row = via ? results.find((r) => r.kind === via) : results.find((r) => r.kind === "twilio") ?? results.find((r) => r.kind === "plivo");
  return row ? unpack(env, row) : null;
}

const basic = (user: string, pass: string) => "Basic " + btoa(`${user}:${pass}`);
const TwilioSent = obj({ sid: str(64) }), TwilioError = obj({ message: str(1000) });
const PlivoSent = obj({ message_uuid: arr(str(64), 10, { min: 1 }) }), PlivoError = obj({ error: str(1000) });

/** One text out: the provider's message id, or why it didn't go. */
async function send(c: Phone, to: string, text: string): Promise<{ id: string } | string> {
  try {
    if (c.kind === "twilio") {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.account)}/Messages.json`, {
        method: "POST", signal: AbortSignal.timeout(TIMEOUT),
        headers: { authorization: basic(c.account, c.token), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: c.from, Body: text }).toString(),
      });
      const reply: unknown = await res.json().catch(() => null);
      const sent = res.ok ? check(TwilioSent, reply) : null;
      return sent ? { id: sent.sid } : `twilio said ${res.status}: ${check(TwilioError, reply)?.message ?? "no reason given"}`;
    }
    const res = await fetch(`https://api.plivo.com/v1/Account/${encodeURIComponent(c.account)}/Message/`, {
      method: "POST", signal: AbortSignal.timeout(TIMEOUT),
      headers: { authorization: basic(c.account, c.token), "content-type": "application/json" },
      body: JSON.stringify({ src: c.from, dst: to, text }),
    });
    const reply: unknown = await res.json().catch(() => null);
    const sent = res.ok ? check(PlivoSent, reply) : null;
    return sent ? { id: sent.message_uuid[0]! } : `plivo said ${res.status}: ${check(PlivoError, reply)?.error ?? "no reason given"}`;
  } catch {
    return `couldn't reach ${c.kind}`;
  }
}

async function sendSms({ req, env, org, role, user }: Ctx, contactId: string): Promise<Response> {
  if (!can(role, "sms")) return error(403, `a ${role} can't send texts`);
  const b = read(SmsBody, await readBody(req));
  if (b instanceof Response) return b;
  const contact = await getRow(env, org, "contacts", contactId);
  if (!contact) return error(404, "not found");
  const to = typeof contact.phone === "string" ? e164(contact.phone) : null;
  if (!to) return error(400, "the contact has no phone number to text");
  const plugin = await phonePlugin(env, org, b.via);
  if (!plugin) return error(409, b.via ? `${b.via} isn't connected` : "connect twilio or plivo first");
  const sent = await send(plugin, to, b.body);
  if (typeof sent === "string") return error(502, sent);
  const activity = await createRow(env, org, "activities", { type: "sms", contact_id: contactId, body: `Sent: ${b.body}` }, user.id);
  if (typeof activity === "string") return error(400, activity);
  return json({ activity, provider_id: sent.id }, 201);
}

// ---- Inbound: POST /api/in/:token ----

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };

/** The body as text, or null past `max` bytes. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  const reader = req.body?.getReader();
  if (!reader) return "";
  const dec = new TextDecoder();
  let text = "", n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + dec.decode();
    n += value.byteLength;
    if (n > max) { await reader.cancel(); return null; }
    text += dec.decode(value, { stream: true });
  }
}

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
async function hmac(hash: "SHA-1" | "SHA-256", key: string, data: string) {
  const k = await crypto.subtle.importKey("raw", enc(key), { name: "HMAC", hash }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", k, enc(data)));
}
/** Equal strings, in time that doesn't depend on where they differ. */
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };
const byKey = (pairs: [string, string][]) => [...pairs].sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));

/**
 * Twilio's X-Twilio-Signature: base64 HMAC-SHA1, keyed with the auth token, over the full URL Twilio called
 * followed by every POST parameter's name and value, sorted by name, with nothing between.
 * (twilio.com/docs/usage/webhooks/webhooks-security, "Validating signatures from Twilio".)
 */
export const twilioSignature = (token: string, url: string, params: [string, string][]) =>
  hmac("SHA-1", token, url + byKey(params).map(([k, v]) => k + v).join(""));

/**
 * Plivo's X-Plivo-Signature-V3, as plivo-python's plivo/utils/signature_v3.py and plivo-node's
 * lib/utils/v3Security.js (validateV3Signature) build it for a POST:
 *
 *   def construct_post_url(uri, params):
 *       base_url = construct_get_url(uri, dict(), True if len(params) == 0 else False)
 *       return base_url + bytearray(get_sorted_params_string(params), 'utf-8')
 *   # construct_get_url: scheme://netloc/path, then "?" + the URL's own query as sorted k=v joined by "&"
 *   # when that query is non-empty or there are POST params, then "." when both are;
 *   # get_sorted_params_string: each POST param, sorted by name (a list's values sorted too), as name+value, no separator.
 *   def get_signature_v3(auth_token, base_url, nonce):
 *       base_url = '{}.{}'.format(base_url, nonce)
 *       return base64(hmac(auth_token, base_url, sha256).digest())
 *
 * The header may carry several signatures, comma-separated; one matching is enough.
 */
export function plivoBase(url: string, params: [string, string][]) {
  const u = new URL(url);
  const base = `${u.protocol}//${u.host}${u.pathname}`;
  const query = byKey([...u.searchParams]).map(([k, v]) => `${k}=${v}`).join("&");
  if (!params.length) return query ? `${base}?${query}` : base;
  return `${base}?${query}${query ? "." : ""}${byKey(params).map(([k, v]) => k + v).join("")}`;
}
export const plivoSignature = (token: string, url: string, params: [string, string][], nonce: string) => hmac("SHA-256", token, `${plivoBase(url, params)}.${nonce}`);

/** Signed by the provider whose plugin this is. */
async function signed(req: Request, c: Phone, url: string, params: [string, string][]) {
  if (c.kind === "twilio") {
    const got = req.headers.get("x-twilio-signature");
    return !!got && same(got, await twilioSignature(c.token, url, params));
  }
  const got = req.headers.get("x-plivo-signature-v3"), nonce = req.headers.get("x-plivo-signature-v3-nonce");
  if (!got || !nonce) return false;
  const want = await plivoSignature(c.token, url, params, nonce);
  return got.split(",").some((s) => same(s.trim(), want));
}

const DIGITS = "replace(replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '')";
/** The org's contact with this number, by its digits (phoneKey), newest first. */
async function contactByPhone(env: Env, org: string, number: string) {
  const key = phoneKey(number);
  if (key.length < 7) return null;
  const { results } = await env.DB.prepare(`SELECT * FROM contacts WHERE org_id = ? AND deleted_at IS NULL AND phone IS NOT NULL AND ${DIGITS} LIKE ? ORDER BY updated_at DESC LIMIT 20`)
    .bind(org, "%" + key).all();
  return results.find((r) => typeof r.phone === "string" && phoneKey(r.phone) === key) ?? null;
}

async function contactByEmail(env: Env, org: string, email: string): Promise<Row | null> {
  if (await isDemo(env, org)) return (await demoRows(env, org, "contacts")).find((r) => r.email === email) ?? null;
  return env.DB.prepare("SELECT * FROM contacts WHERE org_id = ? AND email = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1").bind(org, email).first();
}

const twiml = () => new Response("<Response/>", { headers: { "content-type": "text/xml" } });

async function smsIn(req: Request, env: Env, row: PluginRow, url: string, text: string): Promise<Response> {
  const params = [...new URLSearchParams(text)];
  const c = await unpack(env, row);
  if (!c || !(await signed(req, c, url, params))) return error(403, "bad signature");
  const field = (k: string) => params.find(([n]) => n === k)?.[1];
  const from = field("From");
  if (!from || phoneKey(from).length < 7) return error(400, "From: the sender's number");
  const body = (row.kind === "twilio" ? field("Body") : field("Text")) ?? "";
  const known = await contactByPhone(env, row.org_id, from);
  const contact = known ?? (await createRow(env, row.org_id, "contacts", { phone: e164(from) ?? from, tags: ["inbound"] }, null));
  if (typeof contact === "string") return error(400, contact);
  await createRow(env, row.org_id, "activities", { type: "sms", contact_id: contact.id, body: `Received: ${body.slice(0, SMS_MAX)}` }, null);
  return twiml();
}

/** A form's fields and how long each may be; longer is cut, not refused, so a lead isn't lost to a long message. */
const FIELDS = ["first_name", "last_name", "name", "email", "phone", "company", "message", "redirect"] as const;
type FormField = (typeof FIELDS)[number];
const CAPS: Record<FormField, number> = { first_name: 100, last_name: 100, name: 200, email: 254, phone: 40, company: 200, message: 1900, redirect: 2000 };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The known fields of a JSON object, a urlencoded body or multipart form data, trimmed and cut; blanks left out. */
async function formFields(req: Request, text: string): Promise<Partial<Record<FormField, string>> | null> {
  const type = req.headers.get("content-type") ?? "";
  let get: (k: string) => unknown;
  if (type.includes("json")) {
    const v = parseJson<unknown>(text, null);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    get = (k) => Object.getOwnPropertyDescriptor(v, k)?.value;
  } else if (type.includes("multipart/form-data")) {
    const fd = await new Response(text, { headers: { "content-type": type } }).formData().catch(() => null);
    if (!fd) return null;
    get = (k) => fd.get(k);
  } else {
    const q = new URLSearchParams(text);
    get = (k) => q.get(k);
  }
  const out: Partial<Record<FormField, string>> = {};
  for (const k of FIELDS) {
    const v = get(k);
    const s = typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
    if (s) out[k] = s.slice(0, CAPS[k]);
  }
  return out;
}

async function companyId(env: Env, org: string, name: string) {
  const found = await env.DB.prepare("SELECT id FROM companies WHERE org_id = ? AND deleted_at IS NULL AND lower(name) = lower(?) LIMIT 1").bind(org, name).first<string>("id");
  if (found) return found;
  const made = await createRow(env, org, "companies", { name }, null);
  return typeof made === "string" ? undefined : String(made.id);
}

async function formIn(req: Request, env: Env, row: PluginRow, text: string): Promise<Response> {
  const f = await formFields(req, text);
  if (!f) return error(400, "send JSON, a urlencoded form or multipart form data");
  const email = f.email?.toLowerCase();
  if (email && !EMAIL.test(email)) return error(400, "email: an email address");
  if (!email && !f.phone) return error(400, "send an email or a phone");
  let first = f.first_name, last = f.last_name;
  if (!first && !last && f.name) { const [a, ...rest] = f.name.split(/\s+/); first = a; last = rest.join(" ") || undefined; }
  const org = row.org_id;
  const known = email ? await contactByEmail(env, org, email) : await contactByPhone(env, org, f.phone!);
  const data: Record<string, unknown> = { first_name: first, last_name: last, email, phone: f.phone, company_id: f.company ? await companyId(env, org, f.company) : undefined };
  const contact = known ? await updateRow(env, org, "contacts", String(known.id), data, null) : await createRow(env, org, "contacts", { ...data, tags: ["form"] }, null);
  if (typeof contact === "string") return error(400, contact);
  if (!contact) return error(404, "not found");
  await createRow(env, org, "activities", { type: "note", contact_id: contact.id, body: f.message ? `From the form: ${f.message}` : "Sent the form" }, null);
  const back = f.redirect && (() => { try { const u = new URL(f.redirect); return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null; } catch { return null; } })();
  return back ? new Response(null, { status: 303, headers: { location: back } }) : json({ ok: true }, 201);
}

/** POST /api/in/:token, before sign-in (src/api.ts rate-limits it first). */
export async function inbound(req: Request, env: Env, token: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const res = await (async () => {
    if (req.method !== "POST") return error(405, "POST here");
    const row = await env.DB.prepare("SELECT * FROM plugins WHERE token_hash = ? AND disabled = 0").bind(await sha256(token)).first<PluginRow>();
    if (!row) return error(404, "not found");
    const text = await readCapped(req, MAX_BODY);
    if (text === null) return error(413, `${MAX_BODY / 1024} KB at most`);
    if (row.kind === "form") return formIn(req, env, row, text);
    const u = new URL(req.url);
    return smsIn(req, env, row, `${origin(env, u)}${u.pathname}${u.search}`, text);
  })();
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}
