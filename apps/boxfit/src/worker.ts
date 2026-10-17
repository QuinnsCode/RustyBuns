// The whole server: the sealed engine's key for a paid license, a health check, and the page (served by
// the assets binding, which answers every other path). Everything else runs in the browser.
import { engineKey, type LeaseEnv } from "./seal.ts";

export const VERSION = "0.1.0";

export interface Env extends LeaseEnv { BOXFIT_URL?: string; ASSETS?: { fetch(req: Request): Promise<Response> } }

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function handle(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/health") return json({ ok: true, version: VERSION, sealed: Boolean(env.ARTSTEW_URL && env.BOXFIT_LICENSE) });
  if (pathname === "/api/engine/key" && req.method === "GET") {
    const key = await engineKey({ ...env, host: env.BOXFIT_URL, version: VERSION });
    return key ? json({ key }) : json({ error: "engine locked: license not paid" }, 402);
  }
  if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
  return env.ASSETS ? env.ASSETS.fetch(req) : new Response("not found", { status: 404 });
}

export default { fetch: handle };
