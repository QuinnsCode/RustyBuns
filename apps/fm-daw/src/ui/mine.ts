// What's yours alone, kept in this browser (an account later): "my setup", a snapshot
// to come back to after someone else has had a go at the sesh, and the solo project,
// which is played apart from the sesh and never sent to it.
import { sanitize, type Project } from "../project.ts";
import { soundIds } from "../take.ts";

export type Slot = "setup" | "solo";
type Store = Pick<Storage, "getItem" | "setItem">;
const key = (slot: Slot) => `fm-daw:${slot}`;
const browser = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The saved project, or null if there's none (or it no longer reads as one). */
export function loadMine(slot: Slot, store = browser()): Project | null {
  try {
    const s = store?.getItem(key(slot));
    return s ? sanitize(JSON.parse(s)) : null;
  } catch { return null; }
}

/** False when the browser wouldn't keep it (a private window, or storage full). */
export function saveMine(slot: Slot, p: Project, store = browser()): boolean {
  try { store?.setItem(key(slot), JSON.stringify(p)); return !!store; } catch { return false; }
}

// The solo project's takes: their sound is too big for localStorage, so it goes in IndexedDB beside it,
// one Float32Array per take id. A take never changes, so only new ones are written.
const TAKES = "solo-takes";
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
let opened: Promise<IDBDatabase> | null = null;
function takesDb(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error("no IndexedDB"));
  if (!opened) {
    const r = indexedDB.open("fm-daw", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(TAKES); };
    opened = req(r).catch((e: unknown) => { opened = null; throw e; });
  }
  return opened;
}
const takeIdsOf = (p: Project) => [...soundIds(p)];

/** Keep the sound of the solo project's takes, and let go of any no longer on a track. */
export async function saveSoloTakes(p: Project, sound: (id: string) => Float32Array | undefined): Promise<void> {
  try {
    const db = await takesDb(), want = new Set(takeIdsOf(p));
    const have = new Set((await req(db.transaction(TAKES).objectStore(TAKES).getAllKeys())).map(String));
    const store = db.transaction(TAKES, "readwrite").objectStore(TAKES);
    for (const id of have) if (!want.has(id)) store.delete(id);
    for (const id of want) { const pcm = sound(id); if (pcm && !have.has(id)) store.put(pcm, id); }
  } catch { /* a private window: the takes last until the page closes */ }
}

/** The solo project's takes' sound, as kept. */
export async function loadSoloTakes(p: Project): Promise<Map<string, Float32Array>> {
  const got = new Map<string, Float32Array>();
  try {
    const store = (await takesDb()).transaction(TAKES).objectStore(TAKES);
    for (const id of takeIdsOf(p)) {
      const v: unknown = await req(store.get(id));
      if (v instanceof Float32Array) got.set(id, v);
    }
  } catch { /* none kept */ }
  return got;
}
