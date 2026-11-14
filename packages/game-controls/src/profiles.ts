// Four saved "controller personalities": each holds the settings, key bindings and pad buttons as they were.
// Pure, so a test reaches it without a page. Changes always land in the active slot; picking an empty slot starts
// it as a copy of what you have, so a new personality is "this, but different".
import { type Settings, parseSettings } from "./settings.ts";

export const SLOTS = 4;

export interface Profile { settings: Settings; keys: Record<string, string[]>; pad: Record<string, number> }
export interface Book { active: number; slots: (Profile | null)[] }

const plain = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : {});

function parseProfile(raw: unknown): Profile | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = plain(raw);
  const keys: Profile["keys"] = {};
  for (const [id, v] of Object.entries(plain(o.keys))) if (Array.isArray(v)) keys[id] = v.filter((c): c is string => typeof c === "string");
  const pad: Profile["pad"] = {};
  for (const [id, v] of Object.entries(plain(o.pad))) if (typeof v === "number" && Number.isInteger(v)) pad[id] = v;
  return { settings: parseSettings(o.settings), keys, pad };
}

/** Whatever was stored (unknown) down to a book with exactly four slots and a valid active one. */
export function parseBook(raw: unknown): Book {
  const o = plain(raw);
  const list = Array.isArray(o.slots) ? o.slots : [];
  const slots = Array.from({ length: SLOTS }, (_, i) => parseProfile(list[i]));
  const a = o.active;
  return { active: typeof a === "number" && Number.isInteger(a) && a >= 0 && a < SLOTS ? a : 0, slots };
}

/** The active slot becomes what the player has now. */
export const remember = (b: Book, now: Profile): Book => ({ ...b, slots: b.slots.map((p, i) => (i === b.active ? now : p)) });

/** Go to another slot; `load` is what to apply (the slot's own, or a copy of `now` when it was empty). */
export function switchTo(b: Book, now: Profile, to: number): { book: Book; load: Profile } {
  const saved = remember(b, now);
  const load = saved.slots[to] ?? now;
  return { book: { active: to, slots: saved.slots.map((p, i) => (i === to ? load : p)) }, load };
}
