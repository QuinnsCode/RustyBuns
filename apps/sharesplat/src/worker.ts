// The ShareSplat Worker: one URL per product, its cleaned .spz kept in R2. The built page (dist/ui) is static
// assets, served before the Worker for every path but these (wrangler.jsonc's run_worker_first):
//
//   POST   /api/splats          a signed-in seller's cleaned .spz (the body) becomes a product -> Hosted (api.ts)
//   DELETE /api/splats/<id>     its owner takes a product down
//   GET    /s/<id>.spz          the file, for the viewer; never changes, so cached for a year, open to any page (WebGL)
//   GET    /p/<id>              the product's page: the spinning product alone, for an iframe or the Shopify block
//
// Uploads need an eqosys sign-in (a token eqosys signed for this app), so the bucket only grows with real sellers,
// at most MAX_PER_PERSON products of MAX_BYTES each.
import { hex, sha256 } from "@rustybuns/util/bytes";
import { privateJson } from "@rustybuns/util/http";
import { checkerFor } from "@rustybuns/util/token";
import { APP, EQOSYS, ID, MAX_BYTES, MAX_PER_PERSON, type Hosted, type Problem } from "./api.ts";

type Stored = {
  body: ReadableStream;
  httpEtag: string;
  customMetadata?: Record<string, string>;
  writeHttpMetadata(h: Headers): void;
};

/** The part of an R2 bucket this Worker uses: the real binding, or shell-bun's twin over a directory. */
export interface Bucket {
  get(key: string): Promise<Stored | null>;
  head(key: string): Promise<Omit<Stored, "body"> | null>;
  put(key: string, value: ArrayBuffer | string, opts?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(opts: { prefix: string; limit?: number }): Promise<{ objects: { key: string }[] }>;
}

export interface Env {
  SPLATS: Bucket;
  /** The built page, on Cloudflare. */
  ASSETS?: { fetch(req: Request): Promise<Response> };
  /** The eqosys whose tokens sign sellers in; the live one unless set. */
  EQOSYS_URL?: string;
}

const IMMUTABLE = "public, max-age=31536000, immutable";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};
const fail = (error: string, status: number) => privateJson({ error } satisfies Problem, status, CORS);
const fileKey = (id: string) => `s/${id}.spz`;
/** Who owns what, one empty object per product, under a hash of their eqosys id (no email or id in a key). */
const ownerPrefix = async (sub: string) => `by/${(await sha256(sub)).slice(0, 24)}/`;

/** An .spz is gzip (the format as Niantic wrote it) or, from newer writers, the raw "NGSP" header. */
const isSpz = (b: Uint8Array) =>
  (b[0] === 0x1f && b[1] === 0x8b) || (b[0] === 0x4e && b[1] === 0x47 && b[2] === 0x53 && b[3] === 0x50);

async function seller(req: Request, env: Env): Promise<string | null> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer (\S+\.\S+\.\S+)$/);
  const claims = m ? await checkerFor(env.EQOSYS_URL || EQOSYS, APP).check(m[1]!) : null;
  return claims?.sub ?? null;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (path === "/api/splats" && req.method === "POST") return host(req, env, url);
  const del = path.match(/^\/api\/splats\/([0-9a-f]+)$/);
  if (del && req.method === "DELETE") return takeDown(req, env, del[1]!);

  const file = path.match(/^\/s\/([0-9a-f]+)\.spz$/);
  if (file && req.method === "GET" && ID.test(file[1]!)) {
    const o = await env.SPLATS.get(fileKey(file[1]!));
    if (!o) return new Response("not found", { status: 404, headers: CORS });
    const headers = new Headers(CORS);
    o.writeHttpMetadata(headers);
    headers.set("cache-control", IMMUTABLE);
    headers.set("etag", o.httpEtag);
    return new Response(o.body, { headers });
  }

  const page = path.match(/^\/p\/([0-9a-f]+)$/);
  if (page && req.method === "GET" && ID.test(page[1]!)) {
    if (!(await env.SPLATS.head(fileKey(page[1]!)))) return new Response("no such product", { status: 404 });
    // The embed page itself is a static asset; this is the stable address that points at it.
    return Response.redirect(`${url.origin}/?embed=1&src=${encodeURIComponent(`/s/${page[1]}.spz`)}`, 302);
  }

  return env.ASSETS ? env.ASSETS.fetch(req) : new Response("not found", { status: 404 });
}

async function host(req: Request, env: Env, url: URL): Promise<Response> {
  const who = await seller(req, env);
  if (!who) return fail("sign in with eqosys to put a product online", 401);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(`bigger than ${MAX_BYTES >> 20} MB`, 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return fail(`bigger than ${MAX_BYTES >> 20} MB`, 413);
  if (!isSpz(bytes)) return fail("that isn't an .spz file", 400);

  const id = hex(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 20);
  const mine = await ownerPrefix(who);
  const known = await env.SPLATS.head(fileKey(id));
  if (known && known.customMetadata?.owner !== mine) return fail("someone else already put this exact file online", 409);
  if (!known) {
    const have = await env.SPLATS.list({ prefix: mine, limit: MAX_PER_PERSON + 1 });
    if (have.objects.length >= MAX_PER_PERSON) return fail(`you have ${MAX_PER_PERSON} products online; take one down to add another`, 429);
    await env.SPLATS.put(fileKey(id), bytes.buffer as ArrayBuffer, {
      httpMetadata: { contentType: "application/octet-stream", cacheControl: IMMUTABLE },
      customMetadata: { owner: mine },
    });
    await env.SPLATS.put(`${mine}${id}`, "");
  }
  const reply: Hosted = { id, src: `${url.origin}/s/${id}.spz`, page: `${url.origin}/p/${id}` };
  return privateJson(reply satisfies Hosted, known ? 200 : 201, CORS);
}

async function takeDown(req: Request, env: Env, id: string): Promise<Response> {
  const who = await seller(req, env);
  if (!who) return fail("sign in with eqosys first", 401);
  const mine = await ownerPrefix(who);
  const o = ID.test(id) ? await env.SPLATS.head(fileKey(id)) : null;
  if (!o || o.customMetadata?.owner !== mine) return fail("no product of yours by that id", 404);
  await env.SPLATS.delete(fileKey(id));
  await env.SPLATS.delete(`${mine}${id}`);
  return new Response(null, { status: 204, headers: CORS });
}

export default { fetch: handle };
