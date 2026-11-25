// Where a page keeps its eqosys sign-in between visits (#5892): never localStorage, and never the access token.
// What is kept is the page's own key pair (made non-extractable, so no script can read the private half out) and who
// signed in, with a refresh token eqosys bound to that key (DPoP): copied anywhere else, the refresh token spends nowhere.
// In a browser it lives in IndexedDB; with none (a test, an odd webview) in memory only, so the player signs in again
// next visit. A desktop host can hand `eqosys()` its own vault (the OS keychain, `@rustybuns/util/secrets`).
import { check, obj, opt, str, type Of } from "./guard.ts";

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

const isKey = (v: unknown): v is CryptoKey => typeof CryptoKey !== "undefined" && v instanceof CryptoKey;
/** A stored value as a `Kept`: anything that isn't one (an older shape, a cleared store) is nothing kept. */
export function keptOf(v: unknown): Kept {
  if (typeof v !== "object" || v === null) return { key: null, login: null };
  const key: unknown = Reflect.get(v, "key"), login = check(KeptLogin, Reflect.get(v, "login"));
  const half = (k: string): unknown => (typeof key === "object" && key !== null ? Reflect.get(key, k) : null);
  const privateKey = half("privateKey"), publicKey = half("publicKey");
  return { key: isKey(privateKey) && isKey(publicKey) ? { privateKey, publicKey } : null, login };
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
