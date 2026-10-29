// Who you are here: a random key this browser keeps (the room and the profile store only ever
// see its hash), and your profile (chat name, chat layout). The page shows the localStorage copy
// at once, then takes the profile online (GET /me) when there is one; every change saves to both.
// The desktop has no /me, so its copy is the localStorage one.
import { defaultMe, sanitizeMe, type Me } from "../profile.ts";

const KEY = "fm-daw:key";
const ME = "fm-daw:me";
/** Changes this close together go online as one PUT. */
const SAVE_AFTER_MS = 600;

function newKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
}

let memoryKey: string | null = null;
/** This browser's key, made on first use. Without storage it lasts as long as the tab. */
export function myKey(): string {
  try {
    const k = localStorage.getItem(KEY);
    if (k && /^[0-9a-f]{32,64}$/.test(k)) return k;
    const made = newKey();
    localStorage.setItem(KEY, made);
    return made;
  } catch {
    return (memoryKey ??= newKey());
  }
}

export function localMe(): Me {
  try {
    const raw = localStorage.getItem(ME);
    return raw ? sanitizeMe(JSON.parse(raw)) : defaultMe();
  } catch { return defaultMe(); }
}

/** Set once GET /me answers: only then do changes go online too. */
let online = false;

/** The profile online, or null where there is none (the desktop, plain vite, a failed fetch). */
export async function fetchMe(): Promise<Me | null> {
  try {
    const r = await fetch("/me", { headers: { "X-User-Key": myKey() } });
    if (!r.ok || !r.headers.get("Content-Type")?.includes("application/json")) return null;
    const me = sanitizeMe(await r.json());
    online = true;
    return me;
  } catch { return null; }
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Keep it here now, and online shortly after (one PUT for a burst of changes, like a drag). */
export function saveMe(me: Me) {
  try { localStorage.setItem(ME, JSON.stringify(me)); } catch { /* storage off: online only */ }
  if (!online) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void fetch("/me", { method: "PUT", headers: { "X-User-Key": myKey(), "Content-Type": "application/json" }, body: JSON.stringify(me) }).catch(() => {});
  }, SAVE_AFTER_MS);
}
