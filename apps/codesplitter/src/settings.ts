// Your settings, in a Durable Object of your own (#1491): one UserSettings per person, SQLite-backed,
// created with a location hint from where they first connect, so a change is stored near them.
// The browser keeps its own copy in localStorage for the instant paint; this is the source of truth
// across devices.
//   GET /api/me/settings         {theme?, ...}: what you've set, nothing for what you haven't
//   PUT /api/me/settings {theme} only what you send changes; null puts one back to its default
// Slice 1 holds the light/dark choice. Add a setting by adding it to SETTINGS.

import { json, type Env } from "./env.ts";
import { isPlainObject } from "./util.ts";

/** Each setting and what it accepts. Anything else is refused, so the table can't grow without bound. */
export const SETTINGS: Record<string, (v: unknown) => boolean> = {
  theme: (v) => v === "light" || v === "dark" || v === "system",
};

/** Cloudflare's location hints, by the continent a request came from (coarse: never the colo or the city). */
const HINTS: Record<string, string> = { NA: "enam", SA: "sam", EU: "weur", AS: "apac", OC: "oc", AF: "afr" };
/** Where to create a person's object, from the request's `cf.continent`; undefined (no hint) when unknown. */
export function locationHint(req: Request): string | undefined {
  const cf = (req as { cf?: { continent?: string; longitude?: string | number } }).cf;
  if (cf?.continent === "NA" && Number(cf.longitude) < -105) return "wnam";
  return HINTS[cf?.continent ?? ""];
}

export class UserSettings {
  sql: any;
  constructor(ctx: any) {
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  all(): Record<string, unknown> {
    return Object.fromEntries(this.sql.exec("SELECT key, value FROM settings").toArray().map((r: any) => [r.key, JSON.parse(r.value)]));
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method === "GET") return json(this.all());
    if (req.method === "DELETE") { this.sql.exec("DELETE FROM settings"); return json({ ok: true }); }
    const changes: unknown = await req.json().catch(() => null);
    if (!isPlainObject(changes)) return json({ error: "send an object of settings" }, 400);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) this.sql.exec("DELETE FROM settings WHERE key = ?", k);
      else this.sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", k, JSON.stringify(v));
    }
    return json(this.all());
  }
}

/** The person's object. The hint only counts when the object is first made; later ones leave it where it is. */
export const settingsStub = (env: Env, user: string, req?: Request) =>
  env.SETTINGS.get(env.SETTINGS.idFromName(`user:${user}`), { locationHint: req && locationHint(req) });

export async function settingsRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] !== "me" || p[2] !== "settings" || p[3] || (req.method !== "GET" && req.method !== "PUT")) return null;
  if (!user) return json({ error: "sign in first" }, 401);
  if (req.method === "GET") return settingsStub(env, user, req).fetch(new Request("https://settings/", { method: "GET" }));
  const b: unknown = await req.json().catch(() => null);
  if (!isPlainObject(b)) return json({ error: "send an object of settings" }, 400);
  for (const [k, v] of Object.entries(b)) {
    if (!(k in SETTINGS)) return json({ error: `${k}: not a setting (${Object.keys(SETTINGS).join(", ")})` }, 400);
    if (v !== null && !SETTINGS[k]!(v)) return json({ error: `${k}: not an accepted value` }, 400);
  }
  return settingsStub(env, user, req).fetch(new Request("https://settings/", { method: "PUT", body: JSON.stringify(b) }));
}
