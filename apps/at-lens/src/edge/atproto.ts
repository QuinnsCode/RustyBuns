// The AT Protocol walk, from a name to someone's data, with nothing but public HTTPS:
//
//   handle (a domain)  --DNS TXT _atproto.<handle> or https://<handle>/.well-known/atproto-did-->  DID
//   DID                --plc.directory, or https://<host>/.well-known/did.json for did:web-->       DID document
//   DID document       --alsoKnownAs at://<handle> (must point back), service #atproto_pds-->       data server (PDS)
//   PDS                --/xrpc/com.atproto.repo.describeRepo, listRecords-->                        collections, records
//
// Every step takes a `fetch` so the tests hand it a fake network. Specs: https://atproto.com/specs/handle,
// https://atproto.com/specs/did, https://atproto.com/specs/xrpc.
import { arr, check, obj, opt, raw, str, type Of } from "@rustybuns/util/guard";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Something the person asked for that the network doesn't have: a 404, not a 502. */
export class NotFound extends Error {}

// A handle is a domain name: two or more labels, the last not starting with a digit, 253 at most.
const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const HANDLE = new RegExp(`^(${LABEL}\\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$`);
const NO_TLDS = ["alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion", "test"];
export const isHandle = (s: string) => s.length <= 253 && HANDLE.test(s) && !NO_TLDS.includes(s.slice(s.lastIndexOf(".") + 1));

// atproto uses two DID methods: did:plc (the PLC directory) and did:web (a host's own did.json, hostname only).
const PLC = /^did:plc:[a-z2-7]{24}$/;
export const isDid = (s: string) => PLC.test(s) || (s.startsWith("did:web:") && isHandle(s.slice(8)));

/** "@Alice.example.com", "alice.example.com" or "did:plc:..." as what to look up, or null. */
export function parseQuery(q: string): { did: string } | { handle: string } | null {
  const s = q.trim().replace(/^@/, "");
  if (s.startsWith("did:")) return isDid(s) ? { did: s } : null;
  const h = s.toLowerCase();
  return isHandle(h) ? { handle: h } : null;
}

const TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024;

/** A body as text, given up after `max` bytes: someone else's server decides what it sends. */
async function body(res: Response, max = MAX_BYTES): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel(); throw new Error(`${res.url || "a server"} sent more than ${max} bytes`); }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  parts.reduce((at, p) => (all.set(p, at), at + p.byteLength), 0);
  return new TextDecoder().decode(all);
}

async function getJson(f: Fetcher, url: string, accept = "application/json"): Promise<unknown> {
  const res = await f(url, { headers: { accept }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  if (res.status === 404 || res.status === 400) throw new NotFound(`${new URL(url).host} said ${res.status}`);
  if (!res.ok) throw new Error(`${new URL(url).host} said ${res.status}`);
  try { return JSON.parse(await body(res)); } catch (e) { throw e instanceof NotFound ? e : new Error(`${new URL(url).host} sent something that isn't JSON`); }
}

const Doh = obj({ Answer: opt(arr(obj({ type: raw, data: str(2000) }), 50, { drop: true })) });

/** The DID in `_atproto.<handle>`'s TXT records (Cloudflare's DNS over HTTPS), or null when there isn't exactly one. */
export async function didFromDns(handle: string, f: Fetcher): Promise<string | null> {
  const doh = check(Doh, await getJson(f, `https://cloudflare-dns.com/dns-query?name=_atproto.${handle}&type=TXT`, "application/dns-json").catch(() => null));
  const dids = new Set<string>();
  for (const a of doh?.Answer ?? []) {
    if (a.type !== 16) continue;
    // A TXT answer is one or more quoted strings: "did=did:plc:..." (long ones split as "a" "b").
    const txt = a.data.replace(/"\s*"/g, "").replace(/^"|"$/g, "");
    if (txt.startsWith("did=") && isDid(txt.slice(4))) dids.add(txt.slice(4));
  }
  return dids.size === 1 ? [...dids][0]! : null;
}

/** The DID at `https://<handle>/.well-known/atproto-did`, or null. */
export async function didFromWellKnown(handle: string, f: Fetcher): Promise<string | null> {
  try {
    const res = await f(`https://${handle}/.well-known/atproto-did`, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
    if (!res.ok) return null;
    const s = (await body(res, 2048)).trim();
    return isDid(s) ? s : null;
  } catch { return null; }
}

/** A handle's DID: DNS first, then the handle's own web server, as the spec says either may hold it. */
export async function resolveHandle(handle: string, f: Fetcher): Promise<{ did: string; via: "dns" | "https" } | null> {
  const dns = await didFromDns(handle, f);
  if (dns) return { did: dns, via: "dns" };
  const web = await didFromWellKnown(handle, f);
  return web ? { did: web, via: "https" } : null;
}

const DidDoc = obj({
  id: str(2048),
  alsoKnownAs: opt(arr(str(2048), 20, { drop: true })),
  service: opt(arr(obj({ id: str(2048), type: str(200), serviceEndpoint: raw }), 20, { drop: true })),
});
export type DidDoc = Of<typeof DidDoc>;

/** Where a DID's document lives. */
export const didDocUrl = (did: string) => did.startsWith("did:web:") ? `https://${did.slice(8)}/.well-known/did.json` : `https://plc.directory/${did}`;

export async function resolveDid(did: string, f: Fetcher): Promise<DidDoc> {
  const doc = check(DidDoc, await getJson(f, didDocUrl(did)));
  if (!doc || doc.id !== did) throw new Error(`${didDocUrl(did)} is not ${did}'s DID document`);
  return doc;
}

/** The handle a DID document claims (its first at:// alias), lower-cased, or null. */
export function claimedHandle(doc: DidDoc): string | null {
  const aka = doc.alsoKnownAs?.find((a) => a.startsWith("at://"));
  const h = aka?.slice(5).toLowerCase();
  return h && isHandle(h) ? h : null;
}

/** The data server a DID document names (#atproto_pds, an https URL), or null. */
export function pdsOf(doc: DidDoc): string | null {
  const s = doc.service?.find((x) => (x.id === "#atproto_pds" || x.id === `${doc.id}#atproto_pds`) && x.type === "AtprotoPersonalDataServer");
  if (typeof s?.serviceEndpoint !== "string") return null;
  try {
    const u = new URL(s.serviceEndpoint);
    return u.protocol === "https:" && isHandle(u.hostname) && !u.port ? u.origin : null;
  } catch { return null; }
}

const Describe = obj({ collections: opt(arr(str(317), 500, { drop: true })) });

export interface Lookup {
  did: string;
  /** The handle the DID document claims, or null when it claims none. */
  handle: string | null;
  /** True when that handle resolves back to this DID: the two-way check the spec asks for before trusting a handle. */
  verified: boolean;
  /** How the handle was resolved, when it was. */
  via: "dns" | "https" | null;
  pds: string;
  collections: string[];
  doc: DidDoc;
}

/** The whole walk: a handle or DID to its identity, data server and collections. */
export async function lookup(q: string, f: Fetcher): Promise<Lookup> {
  const p = parseQuery(q);
  if (!p) throw new NotFound(`"${q.slice(0, 80)}" is neither a handle (a domain name) nor a did:plc or did:web`);
  const found = "did" in p ? null : await resolveHandle(p.handle, f);
  if ("handle" in p && !found) throw new NotFound(`${p.handle} has no DID: no _atproto TXT record and no /.well-known/atproto-did`);
  const did = "did" in p ? p.did : found!.did;
  const doc = await resolveDid(did, f);
  const handle = claimedHandle(doc);
  // Asked by handle: the document must claim it. Asked by DID: the claimed handle must resolve back here.
  const back = "handle" in p ? (handle === p.handle ? found : null) : handle ? await resolveHandle(handle, f) : null;
  const verified = !!back && back.did === did;
  const pds = pdsOf(doc);
  if (!pds) throw new NotFound(`${did}'s DID document names no data server`);
  const repo = check(Describe, await getJson(f, `${pds}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(did)}`));
  return { did, handle, verified, via: verified ? back!.via : null, pds, collections: (repo?.collections ?? []).sort(), doc };
}

// A collection is an NSID: reversed domain plus a name, like app.bsky.feed.post.
const NSID = /^[a-zA-Z]([a-zA-Z0-9-]{0,62})?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,62})?)+(\.[a-zA-Z][a-zA-Z0-9]{0,62})$/;
export const isNsid = (s: string) => s.length <= 317 && NSID.test(s);

const Records = obj({ records: arr(obj({ uri: str(8192), cid: str(200), value: raw }), 100, { drop: true }), cursor: opt(str(200)) });
export type Records = Of<typeof Records>;

/** A collection's newest records (up to `limit`) from the DID's own data server. */
export async function records(did: string, collection: string, f: Fetcher, limit = 10): Promise<Records> {
  if (!isDid(did)) throw new NotFound(`"${did.slice(0, 80)}" is not a did:plc or did:web`);
  if (!isNsid(collection)) throw new NotFound(`"${collection.slice(0, 80)}" is not a collection name (an NSID)`);
  const pds = pdsOf(await resolveDid(did, f));
  if (!pds) throw new NotFound(`${did}'s DID document names no data server`);
  const got = check(Records, await getJson(f, `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&limit=${limit}`));
  if (!got) throw new Error(`${new URL(pds).host} sent records in a shape this doesn't know`);
  return got;
}
