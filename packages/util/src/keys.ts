// Keys people pick for a page's commands (#3793). Every command starts with none, so nothing fires until someone
// chooses one; a page lists its keyable commands in a Keys setting, records a key by pressing it, and binds them:
//
//   const keys = keyStore("cs_keys");
//   bindKeys({ keys: keys.get, run: (name) => runIt(name) });
//   const why = refuseKey(keyOf(e), name, keys.get(), titleOf); // null, or why not ("⌘S belongs to the browser")
//
// A key never fires while someone types (an input, textarea, select or editable field) or while a dialog is open.
// The palette shows the chosen key through the command's `keys` field (commands.ts).

/** What keyOf reads from a KeyboardEvent. */
export interface KeyPress { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

const MODS = new Set(["Shift", "Meta", "Control", "Alt", "AltGraph", "CapsLock", "Fn", "OS"]);
const NAMED: Record<string, string> = { " ": "Space", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * A key press as people read it: "N", "Shift+N", "Alt+N", "?", "F2", "⌘S" (Ctrl+S off a Mac). A lone modifier is null.
 * Letters and digits come from `code`, so Alt on a Mac names the key, not the symbol it types.
 */
export function keyOf(e: KeyPress, mac = MAC): string | null {
  if (MODS.has(e.key) || !e.key || e.key === "Unidentified" || e.key === "Dead") return null;
  const letter = /^Key([A-Z])$/.exec(e.code ?? "")?.[1] ?? /^Digit(\d)$/.exec(e.code ?? "")?.[1];
  const base = letter ?? NAMED[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  // Shift is part of a symbol ("?" is Shift+/), so it is only named beside a letter, a digit or a named key.
  const shift = e.shiftKey && (!!letter || e.key.length > 1);
  const parts = [e.ctrlKey && "Ctrl+", e.altKey && "Alt+", shift && "Shift+"].filter(Boolean).join("");
  return e.metaKey ? `${mac ? "⌘" : "Win+"}${parts}${base}` : `${parts}${base}`;
}

/** Keys that already move around every page: the browser's and the page's own. */
const MOVES = new Set(["Esc", "Tab", "Shift+Tab", "Enter", "Space", "Backspace", "↑", "↓", "←", "→", "Home", "End", "PageUp", "PageDown"]);

/**
 * Why `key` can't go to command `name`, or null when it can: a browser key (⌘ or Ctrl with anything, F5, F11, F12),
 * one that moves around the page (Esc, Tab, Enter, arrows), or one already taken, named by its command's title.
 */
export function refuseKey(key: string | null, name: string, taken: Readonly<Record<string, string>>, titleOf: (name: string) => string = (n) => n): string | null {
  if (!key) return "Press a key, not only Shift, Alt or ⌘";
  if (/^(⌘|Ctrl\+|Win\+)/.test(key) || /^(Alt\+)?(Shift\+)?F(5|11|12)$/.test(key)) return `${key} belongs to the browser`;
  if (MOVES.has(key)) return `${key} moves around the page`;
  const other = Object.entries(taken).find(([n, k]) => k === key && n !== name)?.[0];
  return other ? `${key} is taken by “${titleOf(other)}”` : null;
}

/** Whether a key press landed where someone types. */
export const isTyping = (target: EventTarget | null): boolean =>
  !!target && typeof Reflect.get(target, "closest") === "function" && !!Reflect.get(target, "closest").call(target, "input, textarea, select, [contenteditable]:not([contenteditable=false])");

/** Whether a dialog is open: a <dialog open>, or an aria-modal sheet that isn't inside something hidden. */
export function dialogOpen(doc: Document = document): boolean {
  return [...doc.querySelectorAll("dialog[open], [aria-modal=true]")].some((el) => !el.closest("[hidden]"));
}

/** The chosen keys, command name to key, kept in this browser under `storageKey` (none when storage is blocked). */
export function keyStore(storageKey: string) {
  const read = (): Record<string, string> => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
      return Object.fromEntries(Object.entries(v).filter((p): p is [string, string] => typeof p[1] === "string" && !!p[1]));
    } catch { return {}; }
  };
  let keys = read();
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(keys)); } catch { /* kept until the page closes */ } };
  return {
    get: (): Readonly<Record<string, string>> => keys,
    set(name: string, key: string | null) { const next = { ...keys }; if (key) next[name] = key; else delete next[name]; keys = next; save(); },
  };
}

/** Where key presses come from: the window, or a fake one in a test. */
export interface KeyTarget { addEventListener(type: "keydown", fn: (e: KeyboardEvent) => void): void; removeEventListener(type: "keydown", fn: (e: KeyboardEvent) => void): void }

/**
 * Run a command when its key is pressed, unless someone is typing, a dialog is open, the key repeats or something
 * else took it (defaultPrevented). The answer stops listening.
 */
export function bindKeys(o: { keys: () => Readonly<Record<string, string>>; run(name: string): unknown; busy?: () => boolean; target?: KeyTarget }): () => void {
  const t: KeyTarget = o.target ?? window;
  const busy = o.busy ?? (() => typeof document !== "undefined" && dialogOpen());
  const on = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat || isTyping(e.target) || busy()) return;
    const k = keyOf(e);
    const name = k && Object.entries(o.keys()).find(([, v]) => v === k)?.[0];
    if (!name) return;
    e.preventDefault();
    void o.run(name);
  };
  t.addEventListener("keydown", on);
  return () => t.removeEventListener("keydown", on);
}
