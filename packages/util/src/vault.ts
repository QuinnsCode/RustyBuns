// Where a page keeps its eqosys sign-in between visits (#5892): never localStorage, and never the access token.
// What is kept is the page's own key pair (made non-extractable, so no script can read the private half out) and who
// signed in, with a refresh token eqosys bound to that key (DPoP): copied anywhere else, the refresh token spends nowhere.
// In a browser it lives in IndexedDB; with none (a test, an odd webview) in memory only, so the player signs in again
// next visit. A desktop host can hand `eqosys()` its own vault (the OS keychain, `@rustybuns/util/secrets`).
import { Bad, check, maybe, nul, obj, opt, str, type Guard, type Of } from "./guard.ts";

/** Who signed in, as kept: no access token (that lives in memory for its ten minutes). */
export const KeptLogin = obj({ name: str(200), email: str(320), refresh: opt(str(100)) });
export type KeptLogin = Of<typeof KeptLogin>;

export interface Kept {
  /** The page's DPoP key; its private half is non-extractable. */
  key: CryptoKeyPair | null;
  login: KeptLogin | null;
}

export interface Vault {
  load(): Promise<Kept>;
  save(k: Kept): Promise<void>;
}

/** A WebCrypto key, as IndexedDB gives it back (a structured clone keeps it a `CryptoKey`, unextractable as made). */
const Key: Guard<CryptoKey> = (v) => {
  if (typeof CryptoKey !== "undefined" && v instanceof CryptoKey) return v;
  throw new Bad("a CryptoKey");
};
/** What the vault holds: each half read on its own, so a bad key or an older login shape is nothing kept, not an error. */
const Stored = obj({ key: maybe(nul(obj({ privateKey: Key, publicKey: Key }))), login: maybe(nul(KeptLogin)) });
/** A stored value as a `Kept`: anything that isn't one (an older shape, a cleared store) is nothing kept. */
export function keptOf(v: unknown): Kept {
  const got = check(Stored, v);
  return { key: got?.key ?? null, login: got?.login ?? null };
}

/** Kept for as long as the page is open. */
export function memoryVault(): Vault {
  let held: Kept = { key: null, login: null };
  return { load: async () => held, save: async (k) => { held = k; } };
}

/** IndexedDB database `eqosys`, one entry per `name` (the client's prefix); null where the page has no IndexedDB. */
export function idbVault(name: string): Vault | null {
  if (typeof indexedDB === "undefined") return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => db ??= new Promise((ok, no) => {
    const r = indexedDB.open("eqosys", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kept");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { db = null; no(r.error); };
  });
  const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => open().then((d) => new Promise<T>((ok, no) => {
    const q = f(d.transaction("kept", mode).objectStore("kept"));
    q.onsuccess = () => ok(q.result);
    q.onerror = () => no(q.error);
  }));
  return {
    load: async () => keptOf(await run<unknown>("readonly", (s) => s.get(name))),
    save: async (k) => { await run("readwrite", (s) => s.put(k, name)); },
  };
}
