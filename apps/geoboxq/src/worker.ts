// The whole server: the sealed engine's key for a paid license, the solve API, a health check, and the page
// (served by the assets binding, which answers every other path). The same `handle` runs on Cloudflare
// and on a plain Bun server (src/serve.ts), so a host can go down without the API going with it.
import { loadEngine, solve, type Thing } from "./engine.ts";
import { group } from "./model.ts";
import { ratesApi, type RatesEnv } from "./rates.ts";
import { engineKey } from "@rustybuns/seal";
import { privateJson } from "@rustybuns/util/http";
import wasm from "./wasm-pkg/geoboxq_engine_bg.wasm";

export const VERSION = "0.1.0";
/** A request body bigger than this is refused before it is parsed. A few hundred pieces is far under it. */
export const MAX_BODY = 256 * 1024;

export interface Env extends RatesEnv { ARTSTEW_URL?: string; GEOBOXQ_LICENSE?: string; GEOBOXQ_URL?: string; /** Comma-separated store keys. Set: `POST /api/solve` needs `Authorization: Bearer <key>`. Unset: open. */ GEOBOXQ_API_KEYS?: string; ASSETS?: { fetch(req: Request): Promise<Response> } }

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type, authorization" };
const json = (body: unknown, status = 200) => privateJson(body, status, CORS);

/**
 * `POST /api/solve` with `{ boxes: [{name,l,w,h}], items: [{name,l,w,h,qty?,inner?}], pad? }`: the smallest box
 * everything fits in, and the nesting as a tree. Small on purpose, so a store's wrapper can map it to its own box set.
 */
async function solveApi(req: Request, env: Env) {
  const keys = env.GEOBOXQ_API_KEYS?.split(",").map((k) => k.trim()).filter(Boolean) ?? [];
  if (keys.length && !keys.includes(req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "")) return json({ error: "send Authorization: Bearer <key>" }, 401);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: `body is over ${MAX_BODY} bytes` }, 413);
  let body: { boxes?: Thing[]; items?: Thing[]; pad?: number };
  try { body = JSON.parse(text); } catch { return json({ error: "body is not JSON" }, 400); }
  if (!Array.isArray(body?.boxes) || !Array.isArray(body?.items)) return json({ error: "send { boxes: [...], items: [...] }" }, 400);
  try {
    await loadEngine(wasm);
    const sol = await solve(body.boxes, body.items, body.pad ?? 0);
    const best = sol.best === null ? null : { index: sol.best, name: sol.boxes[sol.best]!.name, fill: sol.boxes[sol.best]!.fill };
    return json({ fits: best !== null, box: best, boxes: sol.boxes, nested: sol.nested, tree: group(sol.pieces) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "could not solve" }, 400);
  }
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (req.method === "OPTIONS" && pathname.startsWith("/api/")) return new Response(null, { status: 204, headers: CORS });
  if (pathname === "/api/health") return json({ ok: true, version: VERSION, sealed: Boolean(env.ARTSTEW_URL && env.GEOBOXQ_LICENSE) });
  if (pathname === "/api/solve") return req.method === "POST" ? solveApi(req, env) : json({ error: "POST only" }, 405);
  if (pathname === "/api/rates") {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: `body is over ${MAX_BODY} bytes` }, 413);
    const out = await ratesApi(text, env);
    return json(out.body, out.status);
  }
  if (pathname === "/api/engine/key" && req.method === "GET") {
    const key = await engineKey({ ARTSTEW_URL: env.ARTSTEW_URL, license: env.GEOBOXQ_LICENSE, host: env.GEOBOXQ_URL, version: VERSION });
    return key ? json({ key }) : json({ error: "engine locked: license not paid" }, 402);
  }
  if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
  return env.ASSETS ? env.ASSETS.fetch(req) : new Response("not found", { status: 404 });
}

export default { fetch: handle };
