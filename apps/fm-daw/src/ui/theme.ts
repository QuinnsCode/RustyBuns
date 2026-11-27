// Qollab Studio's light / dark pick: System (follow the OS), Light or Dark, kept in this browser and read by every
// page. The look shown is set as data-theme="light" | "dark" on <html> (System resolves to the OS's look and follows
// it), so each page's stylesheet needs one :root[data-theme="light"] block. The pick itself is in the room pill
// (way.ts). No React here: the plain pages import it too.

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
const KEY = "fm-daw.theme";

/** A stored value as a choice: anything unknown (nothing saved, an old value) is System. */
export function themeOf(stored: string | null): Theme {
  return THEMES.find((t) => t === stored) ?? "system";
}

/** The look a page ends up in: a pick, or under System what the OS prefers. */
export function shownTheme(choice: Theme, osLight: boolean): "light" | "dark" {
  return choice === "system" ? (osLight ? "light" : "dark") : choice;
}

const osLight = () => globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;

export function loadTheme(): Theme {
  try { return themeOf(localStorage.getItem(KEY)); } catch { return "system"; }
}

export function applyTheme(choice: Theme) {
  document.documentElement.dataset.theme = shownTheme(choice, osLight());
}

export function saveTheme(choice: Theme) {
  applyTheme(choice);
  try { if (choice === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch { /* private window: this visit only */ }
}

let following = false;
/** On load: the saved pick, then kept in step with the OS (under System) and with a pick made in another tab. */
export function followTheme() {
  applyTheme(loadTheme());
  if (following) return;
  following = true;
  globalThis.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", () => applyTheme(loadTheme()));
  addEventListener("storage", () => applyTheme(loadTheme())); // cheap, so any key will do
}

/** Calls `fn` whenever the look changes, so a canvas can redraw in the new colours; returns the unsubscribe. */
export function onThemeChange(fn: () => void): () => void {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
