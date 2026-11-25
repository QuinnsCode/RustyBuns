// Where a page keeps its eqosys sign-in between visits (#5892): never localStorage, and never the access token.
// What is kept is the page's own key pair (made non-extractable, so no script can read the private half out) and who
// signed in, with a refresh token eqosys bound to that key (DPoP): copied anywhere else, the refresh token spends nowhere.
// In a browser it lives in IndexedDB; with none (a test, an odd webview) in memory only, so the player signs in again
// next visit. On a desktop build the host keeps who signed in in the OS store (`hostVault`, #5886), and the key stays here.
import { Bad, check, maybe, nul, obj, type Guard, type Of } from "./guard.ts";
import { KeptLogin, type ProofAsk } from "./token.ts";

/** Who signed in, as kept: no access token (that lives in memory for its ten minutes). */
export { KeptLogin } from "./token.ts";

export interface Kept {
  /** The page's DPoP key; its private half is non-extractable. */
  key: CryptoKeyPair | null;
  login: KeptLogin | null;
}

export interface Vault {
  load(): Promise<Kept>;
  save(k: Kept): Promise<void>;
  /** A DPoP proof for this request from a key the vault holds itself (a desktop host's), so the page needs no key of its own. */
  prove?(htm: string, url: string): Promise<string>;
}

/** Where a desktop host serves its own page the sign-in it keeps in the OS store (`login` in shell-bun's `serve`). */
export const HOST_LOGIN_PATH = "/__rb/login";
/** GET HOST_LOGIN_PATH: who the OS store has, if anyone. */
export const HostLogin = obj({ login: nul(KeptLogin) });

/**
 * The desktop vault: who signed in, and the DPoP key their refresh token is bound to, live in the host's OS store
 * (macOS Keychain, Credential Manager, Secret Service), and the host signs each proof. The host listens on a new port
 * each launch, so anything in the webview's own storage (a new origin each time) would be lost on a restart.
 * Null on a page no host marked (`<meta name="rb-login">`), so the web build keeps IndexedDB. `send` is fetch; a test
 * passes one that carries the host's cookie.
 */
export function hostVault(opts: { send?: typeof fetch; at?: string; marked?: boolean } = {}): Vault | null {
  const marked = opts.marked ?? (typeof document !== "undefined" && !!document.querySelector?.('meta[name="rb-login"]'));
  if (!marked) return null;
  const send = opts.send ?? fetch, at = opts.at ?? HOST_LOGIN_PATH;
  const sent = async (res: Response) => { if (!res.ok) throw new Error(`the host said ${res.status}`); return res; };
  const json = { "content-type": "application/json" };
  return {
    async load() {
      const res = await send(at, { credentials: "same-origin" });
      return { key: null, login: res.ok ? check(HostLogin, await res.json().catch(() => null))?.login ?? null : null };
    },
    async save(k) {
      await sent(await send(at, k.login
        ? { method: "PUT", credentials: "same-origin", headers: json, body: JSON.stringify(k.login) }
        : { method: "DELETE", credentials: "same-origin" }));
    },
    async prove(htm, url) {
      const ask: Of<typeof ProofAsk> = { htm, url };
      return (await sent(await send(`${at}/proof`, { method: "POST", credentials: "same-origin", headers: json, body: JSON.stringify(ask) }))).text();
    },
  };
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
