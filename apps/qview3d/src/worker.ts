// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The QView3D Worker. Static assets (dist/client: /v1/qview3d.js and the demo page) are served before it runs.
//
//   GET  /api/orgs/<org>/products/<product>   a product's model and colours
//   POST /api/orgs/<org>/uploads              sign one upload (SignRequest -> SignReply); the page's origin must be the org's
//   PUT  /u/<token>                           the bytes for a Worker-signed upload, checked against the token
//   POST /api/orgs/<org>/designs              save a design (Design -> DesignReply); its files must be the org's and exist
//   GET  /r/<key>                             a texture, snapshot or design, edge-cached for a year (the names never change)
import { hex } from "@rustybuns/util/bytes";
import { json, privateJson, readJson } from "@rustybuns/util/http";
import { Design, Org, Product, SignRequest, type DesignReply, type SignReply } from "./api.ts";
import { designKey, fileKey, ID, KINDS, orgKey, productKey, servable } from "./layout.ts";
import { presignUrl, readToken, uploadToken } from "./sign.ts";

/** The part of an R2 bucket this Worker uses: the real binding, or shell-bun's twin over a directory. */
export interface Bucket {
  get(key: string): Promise<{ body: ReadableStream; httpEtag: string; size: number; text(): Promise<string>; writeHttpMetadata(h: Headers): void } | null>;
  head(key: string): Promise<{ size: number } | null>;
  put(key: string, value: ArrayBuffer | string, opts?: { httpMetadata?: Record<string, string> }): Promise<unknown>;
}

export interface Env {
  BUCKET: Bucket;
  UPLOAD_SECRET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** The bucket's name for presigned URLs; the binding's own name otherwise. */
  R2_BUCKET_NAME?: string;
}

const UPLOAD_TTL_S = 600;
const IMMUTABLE = "public, max-age=31536000, immutable";

const cors = (origin: string | null): Record<string, string> => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
  vary: "origin",
});
const fail = (why: string, status: number, origin: string | null) => privateJson({ error: why }, status, cors(origin));

async function sha256(bytes: ArrayBuffer) {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

async function readOrg(env: Env, org: string): Promise<Org | null> {
  const o = await env.BUCKET.get(orgKey(org));
  if (!o) return null;
  return readJson(new Response(await o.text()), Org);
}

/** Whether a page at `origin` may act for the org: listed exactly, or the org allows any ("*"). */
const allowed = (o: Org, origin: string | null) => o.origins.includes("*") || (origin !== null && o.origins.includes(origin));

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

  if (url.pathname.startsWith("/r/") && req.method === "GET") return serve(req, env, decodeURIComponent(url.pathname.slice(3)));
  if (url.pathname.startsWith("/u/") && req.method === "PUT") return upload(req, env, url.pathname.slice(3), origin);

  const m = url.pathname.match(/^\/api\/orgs\/([^/]+)\/(products|uploads|designs)(?:\/([^/]+))?$/);
  if (!m) return fail("not found", 404, origin);
  const [, org, what, id] = m;
  if (!org || !ID.test(org)) return fail("unknown org", 404, origin);
  const settings = await readOrg(env, org);
  if (!settings) return fail("unknown org", 404, origin);

  if (what === "products" && req.method === "GET" && id && ID.test(id)) {
    const o = await env.BUCKET.get(productKey(org, id));
    const p = o && (await readJson(new Response(await o.text()), Product));
    return p ? json(p, 200, { ...cors(origin), "cache-control": "public, max-age=60" }) : fail("unknown product", 404, origin);
  }
  if (req.method !== "POST" || id) return fail("not found", 404, origin);
  if (!allowed(settings, origin)) return fail("this page may not use this org", 403, origin);
  if (what === "uploads") return sign(req, env, org, url, origin);
  return saveDesign(req, env, org, url, origin);
}

async function sign(req: Request, env: Env, org: string, url: URL, origin: string | null): Promise<Response> {
  const r = await readJson(req, SignRequest);
  if (!r) return fail("expected {kind, type, size, sha256}", 400, origin);
  const k = KINDS[r.kind];
  if (!(k.types as readonly string[]).includes(r.type)) return fail(`${r.kind}: ${k.types.join(", ")} only`, 400, origin);
  if (r.size > k.max) return fail(`${r.kind}: up to ${k.max >> 20} MB`, 413, origin);
  const key = fileKey(org, r.kind, r.sha256, r.type);
  const served = r.kind === "original" ? undefined : `${url.origin}/r/${key}`;
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
