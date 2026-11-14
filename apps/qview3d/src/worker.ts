// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The QView3D Worker. Static assets (dist/client: /v1/qview3d.js and the demo page) are served before it runs.
//
//   GET  /api/orgs/<org>/products/<product>   a product's model and colours
//   POST /api/orgs/<org>/uploads              sign one upload (SignRequest -> SignReply); the page's origin must be the org's
//   PUT  /u/<token>                           the bytes for a Worker-signed upload, checked against the token
//   POST /api/orgs/<org>/designs              save a design (Design -> DesignReply); its files must be the org's and exist
//   GET  /r/<key>                             a texture, snapshot, design or sample model, edge-cached for a year (names never change)
//   POST /api/orgs/<org>/models               an admin starts a sample model from product photos, or files a scan (samples.ts)
//   GET  /api/orgs/<org>/models/<id>          an admin asks how it's going
//   GET  /api/orgs/<org>/designs/<id>/print   an admin gets a design's print files laid out, per zone (print.ts)
//   GET  /api/orgs/<org>/originals/<file>     an admin fetches a shopper's original, the print source
//   GET  /v1/embed.md, /llms.txt              how to put the widget on a page, for a coding agent (embed.ts)
//
// A fresh deploy with an empty bucket still serves the demo org and its three hats (demo.ts), read-only.
import { hex } from "@rustybuns/util/bytes";
import { json, privateJson, readJson } from "@rustybuns/util/http";
import { Design, Org, Product, SignRequest, zonesOf, type DesignReply, type SignReply } from "./api.ts";
import { BUILT_IN_DEMO, DEMO_ORG, DEMO_PRODUCTS } from "./demo.ts";
import { embedGuide } from "./embed.ts";
import { designKey, fileKey, ID, KINDS, orgKey, productKey, servable } from "./layout.ts";
import { originalRoute, printPlanRoute } from "./print.ts";
import { isAdmin, sampleRoute, startSampleRoute } from "./samples.ts";
import { presignUrl, readToken, uploadToken } from "./sign.ts";

/** The part of an R2 bucket this Worker uses: the real binding, or shell-bun's twin over a directory. */
export interface Bucket {
  get(key: string): Promise<{ body: ReadableStream; httpEtag: string; size: number; httpMetadata?: { contentType?: string }; text(): Promise<string>; writeHttpMetadata(h: Headers): void } | null>;
  head(key: string): Promise<{ size: number } | null>;
  put(key: string, value: ArrayBuffer | string, opts?: { httpMetadata?: Record<string, string> }): Promise<unknown>;
  list(opts: { prefix: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

/** A Cloudflare rate limit binding: a count per key over its period, at each location. */
export interface RateLimit {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  BUCKET: Bucket;
  UPLOAD_SECRET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** The bucket's name for presigned URLs; the binding's own name otherwise. */
  R2_BUCKET_NAME?: string;
  /** Meshy, for samples. Without a key, samples answer 503. MESHY_API_BASE points elsewhere (the stand-in). */
  MESHY_API_KEY?: string;
  MESHY_API_BASE?: string;
  /** Samples a day across every org, the ceiling on the Meshy bill. Default 50. */
  MESHY_DAILY?: string;
  /** Signs a minute per IP and org, and sample starts a minute per org. Absent on the local twin: no limit there. */
  SIGN_LIMIT?: RateLimit;
  SAMPLE_LIMIT?: RateLimit;
}

const UPLOAD_TTL_S = 600;
const IMMUTABLE = "public, max-age=31536000, immutable";

const cors = (origin: string | null): Record<string, string> => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
  vary: "origin",
});
const fail = (why: string, status: number, origin: string | null) => privateJson({ error: why }, status, cors(origin));

/** Whether `key` is over `limit` this minute. Without the binding (the local twin) nothing is. */
const over = async (limit: RateLimit | undefined, key: string) => limit ? !(await limit.limit({ key })).success : false;
const slowDown = (what: string, origin: string | null) =>
  privateJson({ error: `too many ${what}: try again in a minute`, retryAfter: 60 }, 429, { ...cors(origin), "retry-after": "60" });

async function sha256(bytes: ArrayBuffer) {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

/** The org's settings, and whether they are the built-in demo's (no orgs/demo/ in the bucket yet). */
async function readOrg(env: Env, org: string): Promise<{ settings: Org; builtIn: boolean } | null> {
  const o = await env.BUCKET.get(orgKey(org));
  if (!o) return org === DEMO_ORG ? { settings: BUILT_IN_DEMO, builtIn: true } : null;
  const settings = await readJson(new Response(await o.text()), Org);
  return settings && { settings, builtIn: false };
}

/** Whether a page at `origin` may act for the org: listed exactly, or the org allows any ("*"). */
const allowed = (o: Org, origin: string | null) => o.origins.includes("*") || (origin !== null && o.origins.includes(origin));

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

  if (url.pathname.startsWith("/r/") && req.method === "GET") return serve(req, env, decodeURIComponent(url.pathname.slice(3)));
  if (url.pathname.startsWith("/u/") && req.method === "PUT") return upload(req, env, url.pathname.slice(3), origin);
  if ((url.pathname === "/v1/embed.md" || url.pathname === "/llms.txt") && req.method === "GET") {
    return new Response(embedGuide(url.origin), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300", ...cors(null) } });
  }

  const m = url.pathname.match(/^\/api\/orgs\/([^/]+)\/(products|uploads|designs|models|originals)(?:\/([^/]+))?(\/print)?$/);
  if (!m) return fail("not found", 404, origin);
  const [, org, what, id, print] = m;
  if (!org || !ID.test(org)) return fail("unknown org", 404, origin);
  const found = await readOrg(env, org);
  if (!found) return fail("unknown org", 404, origin);
  const { settings, builtIn } = found;

  if (what === "products" && req.method === "GET" && id && ID.test(id) && !print) {
    const o = await env.BUCKET.get(productKey(org, id));
    const p = o ? await readJson(new Response(await o.text()), Product) : builtIn ? (DEMO_PRODUCTS[id] ?? null) : null;
    return p ? json(p, 200, { ...cors(origin), "cache-control": "public, max-age=60" }) : fail("unknown product", 404, origin);
  }
  // An admin key works from anywhere (the admin page is on our own host); everyone else needs a listed page.
  const admin = await isAdmin(req, settings);
  if (what === "originals" || print) {
    if (!admin) return fail("an admin key is needed for print files", 401, origin);
    if (req.method !== "GET" || !id) return fail("not found", 404, origin);
    if (what === "originals") return originalRoute(env, org, id, cors(origin));
    if (what === "designs") return printPlanRoute(env, org, id, url.origin, cors(origin));
    return fail("not found", 404, origin);
  }
  if (what === "models") {
    if (!admin) return fail("an admin key is needed for samples", 401, origin);
    if (req.method === "POST" && !id) {
      if (await over(env.SAMPLE_LIMIT, org)) return slowDown("samples started", origin);
      return startSampleRoute(req, env, org, settings, cors(origin));
    }
    if (req.method === "GET" && id) return sampleRoute(env, org, id, cors(origin));
    return fail("not found", 404, origin);
  }
  if (req.method !== "POST" || id) return fail("not found", 404, origin);
  if (!admin && !allowed(settings, origin)) return fail("this page may not use this org", 403, origin);
  if (builtIn) return fail("the public demo keeps no files: download a snapshot instead, or ask hello@qntbr.com for an org of your own", 403, origin);
  if (what === "uploads") {
    if (await over(env.SIGN_LIMIT, `${req.headers.get("cf-connecting-ip") ?? "-"}:${org}`)) return slowDown("uploads signed", origin);
    return sign(req, env, org, url, origin, admin);
  }
  return saveDesign(req, env, org, url, origin);
}

async function sign(req: Request, env: Env, org: string, url: URL, origin: string | null, admin: boolean): Promise<Response> {
  const r = await readJson(req, SignRequest);
  if (!r) return fail("expected {kind, type, size, sha256}", 400, origin);
  if ((r.kind === "photo" || r.kind === "scan") && !admin) return fail(`product ${r.kind}s need an admin key`, 401, origin);
  const k = KINDS[r.kind];
  if (!(k.types as readonly string[]).includes(r.type)) return fail(`${r.kind}: ${k.types.join(", ")} only`, 400, origin);
  if (r.size > k.max) return fail(`${r.kind}: up to ${k.max >> 20} MB`, 413, origin);
  const key = fileKey(org, r.kind, r.sha256, r.type);
  const served = r.kind === "original" || r.kind === "photo" ? undefined : `${url.origin}/r/${key}`;
  if (await env.BUCKET.head(key)) return privateJson({ key, exists: true, url: served } satisfies SignReply, 200, cors(origin));

  const headers = { "content-type": r.type };
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    const put = await presignUrl({
      method: "PUT", host: `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, path: `/${env.R2_BUCKET_NAME ?? "qview3d"}/${key}`,
      region: "auto", accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      headers, expires: UPLOAD_TTL_S, date: new Date(),
    });
    return privateJson({ key, exists: false, put: { url: put, headers }, url: served } satisfies SignReply, 200, cors(origin));
  }
  if (!env.UPLOAD_SECRET) return fail("uploads are not set up (UPLOAD_SECRET)", 503, origin);
  const token = await uploadToken(env.UPLOAD_SECRET, { key, type: r.type, size: r.size, sha256: r.sha256, exp: Date.now() + UPLOAD_TTL_S * 1000 });
  return privateJson({ key, exists: false, put: { url: `${url.origin}/u/${token}`, headers }, url: served } satisfies SignReply, 200, cors(origin));
}

async function upload(req: Request, env: Env, token: string, origin: string | null): Promise<Response> {
  if (!env.UPLOAD_SECRET) return fail("uploads are not set up (UPLOAD_SECRET)", 503, origin);
  const claim = await readToken(env.UPLOAD_SECRET, token);
  if (!claim) return fail("this upload link is wrong or has expired", 403, origin);
  if (req.headers.get("content-type") !== claim.type) return fail(`content-type must be ${claim.type}`, 400, origin);
  const declared = Number(req.headers.get("content-length") ?? claim.size);
  if (declared > claim.size) return fail("larger than signed for", 413, origin);
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength !== claim.size) return fail("size differs from what was signed", 400, origin);
  if ((await sha256(bytes)) !== claim.sha256) return fail("the bytes do not match their SHA-256", 400, origin);
  await env.BUCKET.put(claim.key, bytes, { httpMetadata: { contentType: claim.type, cacheControl: IMMUTABLE } });
  return privateJson({ key: claim.key }, 201, cors(origin));
}

async function saveDesign(req: Request, env: Env, org: string, url: URL, origin: string | null): Promise<Response> {
  const d = await readJson(req, Design);
  if (!d) return fail("expected a design (v, model, color, layers, camera)", 400, origin);
  // One picture a zone, and only zones the product has: a cap has no back to print on.
  const zones = d.layers.map((l) => l.zone ?? "front");
  const bad = zones.find((z) => !zonesOf(d.model).includes(z));
  if (bad) return fail(`a ${d.model} has no ${bad} to print on`, 400, origin);
  if (new Set(zones).size < zones.length) return fail("one picture a zone", 400, origin);
  const own = `orgs/${org}/`;
  const files = [d.snapshot, ...d.layers.flatMap((l) => [l.texture, l.original])].filter((k): k is string => !!k);
  for (const key of files) {
    if (!key.startsWith(own)) return fail(`${key}: not this org's file`, 400, origin);
    if (!(await env.BUCKET.head(key))) return fail(`${key}: upload it first`, 400, origin);
  }
  const body = JSON.stringify(d);
  const id = (await sha256(new TextEncoder().encode(body).buffer as ArrayBuffer)).slice(0, 24);
  const key = designKey(org, id);
  await env.BUCKET.put(key, body, { httpMetadata: { contentType: "application/json", cacheControl: IMMUTABLE } });
  return privateJson({ id, url: `${url.origin}/r/${key}` } satisfies DesignReply, 201, cors(origin));
}

/** One served object: from the edge cache when it is there, else R2, then into the cache. WebGL needs the CORS header. */
async function serve(req: Request, env: Env, key: string): Promise<Response> {
  if (!servable(key)) return new Response("not found", { status: 404, headers: cors(null) });
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const hit = await cache?.match(req);
  if (hit) return hit;
  const o = await env.BUCKET.get(key);
  if (!o) return new Response("not found", { status: 404, headers: cors(null) });
  const headers = new Headers(cors(null));
  o.writeHttpMetadata(headers);
  headers.set("cache-control", IMMUTABLE);
  headers.set("etag", o.httpEtag);
  const res = new Response(o.body, { headers });
  await cache?.put(req, res.clone());
  return res;
}

export default { fetch: handle };
