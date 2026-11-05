// GDPR for any app that keeps people's data, in four pieces it can take one at a time:
//
//   regionOf(cf)        where a person's vault lives: "eu" for the EU, EEA, UK and Switzerland (a Durable Object jurisdiction), else null
//   Holder, dossier()   each part of an app that keeps personal data says what it keeps, why (its legal basis) and for how long;
//                       the privacy page lists them and dossier() is the copy a person downloads (access, Art. 15; portability, Art. 20)
//   seal(), unseal()    AES-256-GCM under the person's own key, bound to where the bytes belong, so a row copied elsewhere won't open
//   Vault               the body of a per-person Durable Object: that key, the consent ledger (Art. 7) and the log of what was asked for.
//                       Shredding it is erasure (Art. 17) for everything sealed with the key, backups included: D1 keeps 30 days of history.
//
// The vault is the only place the key is, so it goes in the person's own region and everything sealed with it is only readable through there.
import { arr, bool, check, nul, num, obj, oneOf, rec, str, type Of } from "./guard.ts";
import { b64url, unb64url } from "./bytes.ts";

/** The EU 27, the rest of the EEA, the UK and Switzerland: the countries whose data protection law is GDPR or follows it. */
const EUROPE = new Set(("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE " + "IS LI NO GB CH").split(" "));
export type Region = "eu" | null;

/** The jurisdiction for a person signing up with this `request.cf`: "eu" when Cloudflare puts them in Europe, else null (no restriction). */
export function regionOf(cf: unknown): Region {
  if (!cf || typeof cf !== "object") return null;
  if ("isEUCountry" in cf && cf.isEUCountry === "1") return "eu";
  return "country" in cf && typeof cf.country === "string" && EUROPE.has(cf.country.toUpperCase()) ? "eu" : null;
}

/** The region of whoever sent `req`, from what Cloudflare saw (`req.cf`): a client can't pick it. Null off Cloudflare. */
export const regionAt = (req: Request): Region => regionOf("cf" in req ? req.cf : undefined);

/** A Durable Object namespace, or the part of one these helpers call. */
export interface Namespace<Stub> { idFromName(name: string): unknown; get(id: unknown): Stub; jurisdiction?(j: "eu"): Namespace<Stub> }

/** The person's own object in their region's slice of the namespace. A region needs `jurisdiction` (Workers have it; a local fake may not). */
export const inRegion = <Stub>(ns: Namespace<Stub>, region: Region, name: string): Stub => {
  const at = region && ns.jurisdiction ? ns.jurisdiction(region) : ns;
  return at.get(at.idFromName(name));
};

/** GDPR's lawful bases (Art. 6) that apps here use. */
export type Basis = "contract" | "consent" | "legitimate interest" | "legal obligation";

/** One part of an app that keeps personal data. The page shows `what`, `why`, `basis` and `keep`; `export` is that part of the copy. */
export interface Holder<Ctx> {
  id: string;
  /** What is kept, in a person's words. */
  what: string;
  /** What it is for. */
  why: string;
  basis: Basis;
  /** How long: "until you delete your account", "24 hours". */
  keep: string;
  export(ctx: Ctx): Promise<unknown>;
}

/** Everything an app holds about one person, section by section, ready to hand them as JSON. */
export async function dossier<Ctx>(app: string, holders: readonly Holder<Ctx>[], ctx: Ctx, now = Date.now()) {
  const sections = await Promise.all(holders.map(async ({ export: read, ...h }) => ({ ...h, data: await read(ctx) })));
  return { app, at: new Date(now).toISOString(), sections };
}

/** The headers that make a dossier a file the browser saves. */
export const dossierHeaders = (app: string, now = Date.now()) => ({
  "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
  "content-disposition": `attachment; filename="${app}-data-${new Date(now).toISOString().slice(0, 10)}.json"`,
});

/** Bytes as plain base64, for a dossier: fine for a few hundred KB, where spreading them into one call would not be. */
export function base64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---- Sealing ----------------------------------------------------------------------------------------------------

const AES = { name: "AES-GCM", length: 256 } as const;
const V1 = 1;

/** A fresh data key: 32 random bytes as base64url. It lives in the person's vault and nowhere else. */
export const newDataKey = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

const importKey = (key: string) => crypto.subtle.importKey("raw", unb64url(key), AES, false, ["encrypt", "decrypt"]);

/** `data` sealed under `key`: a version byte, a 12-byte nonce, then AES-GCM's ciphertext and tag. `where` (say `user/app/slot`)
 * is bound in as associated data, so the bytes only open for the place they were sealed for. */
export async function seal(key: string, data: Uint8Array<ArrayBuffer>, where: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(where) }, await importKey(key), data));
  const out = new Uint8Array(1 + iv.length + ct.length);
  out[0] = V1; out.set(iv, 1); out.set(ct, 1 + iv.length);
  return out;
}

/** What `seal` sealed, or null when the key, the place or a byte is wrong (a shredded key looks the same: gone). */
export async function unseal(key: string, sealed: Uint8Array<ArrayBuffer>, where: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (sealed[0] !== V1 || sealed.length < 1 + 12 + 16) return null;
  try {
    const iv = sealed.subarray(1, 13);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(where) }, await importKey(key), sealed.subarray(13)));
  } catch { return null; }
}

// ---- The vault --------------------------------------------------------------------------------------------------

/** One consent given or taken back. The ledger keeps every one, so the app can show what a person agreed to and when (Art. 7(1)). */
export const Consent = obj({ purpose: str(64, { min: 1, re: /^[a-z0-9-]+$/ }), granted: bool(), version: str(32, { min: 1 }), at: num(0, 1e14) });
export type Consent = Of<typeof Consent>;
/** A request a person made of their data: the log is how the app shows it answered within the month GDPR gives it (Art. 12(3)). */
export const Asked = obj({ kind: oneOf(["export", "erase", "rectify", "consent"]), at: num(0, 1e14) });
export type Asked = Of<typeof Asked>;
const MAX_LEDGER = 500, MAX_LOG = 200;

/** What a vault's state call answers: where it is, the consents now in force, the whole ledger and the log. */
export const VaultState = obj({ region: nul(oneOf(["eu"])), consents: rec(Consent, MAX_LEDGER), ledger: arr(Consent, MAX_LEDGER), log: arr(Asked, MAX_LOG) });
export type VaultState = Of<typeof VaultState>;

interface VaultStorage { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<boolean> }

/** The body of a per-person Durable Object. The app's Durable Object class makes one over `ctx.storage` and hands it `fetch`:
 *   GET  /key                     the data key, made on first ask             POST /consent { purpose, granted, version }
 *   GET  /state                   VaultState                                  POST /asked { kind }
 *   POST /shred                   forget everything, the key first: what it sealed can never be opened again
 * Only the app's own Worker can reach it (a Durable Object has no public URL), so it trusts what it is sent. */
export class Vault {
  constructor(private storage: VaultStorage) {}

  async key(): Promise<string> {
    const had = await this.storage.get<string>("key");
    if (had) return had;
    const key = newDataKey();
    await this.storage.put("key", key);
    return key;
  }

  async state(): Promise<VaultState> {
    const [region, ledger, log] = await Promise.all([this.storage.get<Region>("region"), this.storage.get<Consent[]>("ledger"), this.storage.get<Asked[]>("log")]);
    const consents: Record<string, Consent> = {};
    for (const c of ledger ?? []) consents[c.purpose] = c;
    return { region: region ?? null, consents, ledger: ledger ?? [], log: log ?? [] };
  }

  private async append<T>(k: "ledger" | "log", v: T, max: number) {
    const list = [...(await this.storage.get<T[]>(k)) ?? [], v];
    await this.storage.put(k, list.slice(-max));
  }

  async consent(c: Consent) { await this.append("ledger", c, MAX_LEDGER); await this.asked({ kind: "consent", at: c.at }); }
  async asked(a: Asked) { await this.append("log", a, MAX_LOG); }

  /** Erasure: the key goes first, so a crash halfway still leaves nothing sealed readable. */
  async shred() { for (const k of ["key", "ledger", "log", "region"]) await this.storage.delete(k); }

  async fetch(req: Request): Promise<Response> {
    const { pathname, searchParams } = new URL(req.url);
    const reply = (v: unknown, status = 200) => Response.json(v, { status });
    // The region rides on every call, so a vault knows where it is from the first one.
    const region = searchParams.get("region");
    if (region === "eu" && !(await this.storage.get("region"))) await this.storage.put("region", "eu");
    if (pathname === "/key") return reply({ key: await this.key() });
    if (pathname === "/state") return reply(await this.state());
    if (req.method !== "POST") return reply({ error: "not here" }, 404);
    const body: unknown = await req.json().catch(() => null);
    if (pathname === "/consent") {
      const c = check(Consent, body);
      return c ? (await this.consent(c), reply(await this.state())) : reply({ error: "send { purpose, granted, version, at }" }, 400);
    }
    if (pathname === "/asked") {
      const a = check(Asked, body);
      return a ? (await this.asked(a), reply({ ok: true })) : reply({ error: "send { kind, at }" }, 400);
    }
    if (pathname === "/shred") return (await this.shred(), reply({ ok: true }));
    return reply({ error: "not here" }, 404);
  }
}

/** The Worker's side of a vault: one stub, its region carried on every call. */
export function vaultClient(stub: { fetch(req: Request): Promise<Response> }, region: Region) {
  const at = (path: string) => `https://vault${path}${region ? `?region=${region}` : ""}`;
  const post = (path: string, body: unknown = {}) => stub.fetch(new Request(at(path), { method: "POST", body: JSON.stringify(body) }));
  const Key = obj({ key: str(64, { min: 43 }) });
  return {
    key: async () => check(Key, await (await stub.fetch(new Request(at("/key")))).json())?.key ?? null,
    state: async (): Promise<VaultState | null> => {
      const r = await stub.fetch(new Request(at("/state")));
      return r.ok ? check(VaultState, await r.json()) : null;
    },
    consent: (c: Omit<Consent, "at">, now = Date.now()) => post("/consent", { ...c, at: now }),
    asked: (kind: Asked["kind"], now = Date.now()) => post("/asked", { kind, at: now }),
    shred: () => post("/shred"),
  };
}
