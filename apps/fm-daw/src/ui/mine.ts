// What's yours alone, kept in this browser (an account later): "my setup", a snapshot
// to come back to after someone else has had a go at the sesh, and the solo project,
// which is played apart from the sesh and never sent to it.
import { sanitize, type Project } from "../project.ts";

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
