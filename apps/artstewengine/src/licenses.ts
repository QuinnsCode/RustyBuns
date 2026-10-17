// Who has paid. A license is a random string the buyer puts in qCRM's QCRM_LICENSE; paying means a row
// here that isn't revoked or lapsed. The lease answer is the only way the engine's key leaves.
import type { Env } from "./env.ts";

export interface License {
  license: string; who: string; created_at: number; paid_until: number | null; revoked_at: number | null;
  last_lease_at: number | null; leases: number; last_host: string | null; last_version: string | null;
}
export type Status = "paid" | "lapsed" | "revoked";
export const statusOf = (l: License, now: number): Status => l.revoked_at ? "revoked" : l.paid_until && l.paid_until <= now ? "lapsed" : "paid";

const HOUR = 3600_000;
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Add a paid license. `days` blank means until revoked. Returns the new license string. */
export async function grant(conf: Env, who: string, days: number | null, now = Date.now()): Promise<string> {
  const license = "art_" + b64url(crypto.getRandomValues(new Uint8Array(24)));
  await conf.DB.prepare("INSERT INTO licenses (license, who, created_at, paid_until) VALUES (?, ?, ?, ?)")
    .bind(license, who.trim().slice(0, 120), now, days && days > 0 ? now + days * 86400_000 : null).run();
  return license;
}

/** Revoke (bye bye) or restore. Revoking is instant: the next lease is a 402. */
export async function setRevoked(conf: Env, license: string, revoked: boolean, now = Date.now()) {
  await conf.DB.prepare("UPDATE licenses SET revoked_at = ? WHERE license = ?").bind(revoked ? now : null, license).run();
}

const tally = (conf: Env, ok: 0 | 1, now: number) =>
  conf.DB.prepare("INSERT INTO lease_hours (hour, ok, n) VALUES (?, ?, 1) ON CONFLICT (hour, ok) DO UPDATE SET n = n + 1").bind(Math.floor(now / HOUR), ok);

/** qCRM asking "have you paid?". Paid: its host and version are noted and it gets the key. */
export async function lease(conf: Env, body: { license?: unknown; host?: unknown; version?: unknown } | null, now = Date.now()): Promise<Response> {
  const nope = Response.json({ ok: false, error: "no pay, bye bye" }, { status: 402, headers: { "cache-control": "no-store" } });
  const license = typeof body?.license === "string" && body.license.length <= 200 ? body.license : "";
  const row = license && conf.ENGINE_KEY ? await conf.DB.prepare("SELECT * FROM licenses WHERE license = ?").bind(license).first<License>() : null;
  if (!row || statusOf(row, now) !== "paid") { await tally(conf, 0, now).run(); return nope; }
  const text = (v: unknown) => typeof v === "string" ? v.slice(0, 200) : null;
  await conf.DB.batch([
    conf.DB.prepare("UPDATE licenses SET last_lease_at = ?, leases = leases + 1, last_host = ?, last_version = ? WHERE license = ?").bind(now, text(body?.host), text(body?.version), license),
    tally(conf, 1, now),
  ]);
  return Response.json({ ok: true, key: conf.ENGINE_KEY, seconds: 3600 }, { headers: { "cache-control": "no-store" } });
}

export async function listLicenses(conf: Env): Promise<License[]> {
  return (await conf.DB.prepare("SELECT * FROM licenses ORDER BY created_at DESC").all<License>()).results;
}

export interface Metrics {
  paid: number; lapsed: number; revoked: number; accounts: number;
  /** Per hour for the last 24, oldest first. */
  hours: { hour: number; ok: number; refused: number }[];
  ok24: number; refused24: number;
}

export async function metrics(conf: Env, licenses: License[], now = Date.now()): Promise<Metrics> {
  const since = Math.floor(now / HOUR) - 23;
  const rows = (await conf.DB.prepare("SELECT hour, ok, n FROM lease_hours WHERE hour >= ?").bind(since).all<{ hour: number; ok: number; n: number }>()).results;
  const hours = Array.from({ length: 24 }, (_, i) => ({ hour: since + i, ok: 0, refused: 0 }));
  for (const r of rows) { const h = hours[r.hour - since]; if (h) { if (r.ok) h.ok += r.n; else h.refused += r.n; } }
  const by = (s: Status) => licenses.filter((l) => statusOf(l, now) === s).length;
  const accounts = (await conf.DB.prepare('SELECT COUNT(*) AS n FROM "user"').first<{ n: number }>())?.n ?? 0;
  return { paid: by("paid"), lapsed: by("lapsed"), revoked: by("revoked"), accounts, hours, ok24: hours.reduce((a, h) => a + h.ok, 0), refused24: hours.reduce((a, h) => a + h.refused, 0) };
}
