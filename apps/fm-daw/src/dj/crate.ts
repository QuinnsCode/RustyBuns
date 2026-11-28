// The tracks you add to the decks, kept in this browser (IndexedDB), so the set you prep at home (/decks.html, or your
// own room) is in the library when you open the decks at an event: the same files, never sent anywhere. Keyed by file
// name, CRATE_MAX of them; a private window or a full disk keeps them for this visit only.

/** The most tracks the library keeps for next time: a long set, a few hundred MB. */
export const CRATE_MAX = 60;
const STORE = "tracks";

const done = <T,>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
let opened: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error("no IndexedDB"));
  if (!opened) {
    const r = indexedDB.open("qollab-studio-crate", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    opened = done(r).catch((e: unknown) => { opened = null; throw e; });
  }
  return opened;
}
const store = async (mode: IDBTransactionMode) => (await db()).transaction(STORE, mode).objectStore(STORE);

/** The tracks this browser keeps, by name; none in a private window. */
export async function keptTracks(): Promise<File[]> {
  try {
    const all: unknown[] = await done((await store("readonly")).getAll());
    return all.filter((f): f is File => f instanceof File);
  } catch { return []; }
}
/** Keep this track for next time. False: the library is full or the browser won't, so it is here for this visit only. */
export async function keepTrack(f: File): Promise<boolean> {
  try {
    const names = await done((await store("readonly")).getAllKeys());
    if (!names.includes(f.name) && names.length >= CRATE_MAX) return false;
    await done((await store("readwrite")).put(f, f.name));
    return true;
  } catch { return false; }
}
export async function forgetTrack(name: string): Promise<void> {
  try { await done((await store("readwrite")).delete(name)); } catch { /* nothing kept to forget */ }
}
