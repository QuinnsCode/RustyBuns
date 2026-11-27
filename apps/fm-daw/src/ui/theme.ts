// The desk's light / dark pick: System (follow the OS), Light or Dark, kept in this browser.
// A pick sets data-theme on <html>, which app.css reads ahead of the OS's prefers-color-scheme;
// System leaves the attribute off, so the media query decides.
import { useEffect, useState } from "react";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
const KEY = "fm-daw.theme";

/** A stored value as a choice: anything unknown (nothing saved, an old value) is System. */
export function themeOf(stored: string | null): Theme {
  return THEMES.find((t) => t === stored) ?? "system";
}

/** What data-theme on <html> says for a choice: nothing for System, so the OS decides. */
export function themeAttr(choice: Theme): "light" | "dark" | null {
  return choice === "system" ? null : choice;
}

/** The look the desk ends up in: a pick, or under System what the OS prefers. */
export function shownTheme(choice: Theme, osLight: boolean): "light" | "dark" {
  return themeAttr(choice) ?? (osLight ? "light" : "dark");
}

export function loadTheme(): Theme {
  try { return themeOf(localStorage.getItem(KEY)); } catch { return "system"; }
}

export function applyTheme(choice: Theme) {
  const a = themeAttr(choice), root = document.documentElement;
  if (a) root.dataset.theme = a; else delete root.dataset.theme;
}

export function saveTheme(choice: Theme) {
  applyTheme(choice);
  try { if (choice === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch { /* private window: this visit only */ }
}

/** Ticks when the look changes (a pick, or the OS flipping under System), so a canvas can redraw in the new colours. */
export function useThemeTick(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => setN((x) => x + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = globalThis.matchMedia?.("(prefers-color-scheme: light)");
    mq?.addEventListener("change", bump);
    return () => { mo.disconnect(); mq?.removeEventListener("change", bump); };
  }, []);
  return n;
}
