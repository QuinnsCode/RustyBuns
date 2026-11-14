// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Upload URLs, two ways:
//
// - Through the Worker (the default, no extra keys): a short-lived token naming one key, one type, one size and the
//   bytes' SHA-256, HMAC-signed with UPLOAD_SECRET. The page PUTs to /u/<token>; the Worker checks all four and
//   writes R2 through its binding. It works the same on the local twin, and the bytes are checked against their name.
// - Straight to R2 (when the R2_* keys are set): an S3 SigV4 presigned PUT, so big originals never pass through
//   the Worker. R2 has no presigned POST (form uploads); a presigned PUT is its equivalent. The bucket then needs a
//   CORS rule allowing PUT from the shops' origins.
import { b64url, hex, hmacHex, hmacSigned, unb64url } from "@rustybuns/util/bytes";
import { check, num, obj, str, type Of } from "@rustybuns/util/guard";
import { parseJson } from "@rustybuns/util/http";

const UploadClaim = obj({ key: str(300), type: str(40), size: num(0, 1e9), sha256: str(64), exp: num(0, 1e15) });
export type UploadClaim = Of<typeof UploadClaim>;

/** A token for /u/<token>: the claim as base64url JSON, a dot, its HMAC. */
export async function uploadToken(secret: string, claim: UploadClaim): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(claim)));
  return `${body}.${await hmacHex(secret, body)}`;
}

/** The claim a token carries, or null when it is forged, malformed or past its time. */
export async function readToken(secret: string, token: string, now = Date.now()): Promise<UploadClaim | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig || !(await hmacSigned(secret, body, sig))) return null;
  let text: string;
  try { text = new TextDecoder().decode(unb64url(body)); } catch { return null; }
  const claim = check(UploadClaim, parseJson(text));
  return claim && claim.exp > now ? claim : null;
}

const enc = new TextEncoder();
async function hmac(key: Uint8Array | string, msg: string): Promise<Uint8Array> {
  const raw = typeof key === "string" ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const sha256Hex = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
/** RFC 3986 encoding, as SigV4 wants it. */
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export type Presign = {
  method: string; host: string; path: string; region: string; service?: string;
  accessKeyId: string; secretAccessKey: string;
  /** Headers the uploader must send exactly (content-type). `host` is always signed. */
  headers?: Record<string, string>;
  expires: number; date: Date;
};

/** An S3 SigV4 query-signed URL (UNSIGNED-PAYLOAD), for R2 or any S3 API. */
export async function presignUrl(p: Presign): Promise<string> {
  const service = p.service ?? "s3";
  const amz = p.date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amz.slice(0, 8);
  const scope = `${day}/${p.region}/${service}/aws4_request`;
  const headers: Record<string, string> = { host: p.host };
  for (const [k, v] of Object.entries(p.headers ?? {})) headers[k.toLowerCase()] = v.trim();
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${p.accessKeyId}/${scope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(p.expires),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const qs = Object.keys(query).sort().map((k) => `${rfc3986(k)}=${rfc3986(query[k]!)}`).join("&");
  const uri = p.path.split("/").map(rfc3986).join("/");
  const canonical = [p.method, uri, qs, names.map((n) => `${n}:${headers[n]}\n`).join(""), signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amz, scope, await sha256Hex(canonical)].join("\n");
  let key = await hmac(`AWS4${p.secretAccessKey}`, day);
  for (const part of [p.region, service, "aws4_request"]) key = await hmac(key, part);
  return `https://${p.host}${uri}?${qs}&X-Amz-Signature=${hex(await hmac(key, toSign))}`;
}
