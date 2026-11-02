// The park-service look on the house kit (#3208): buttons, chips and panels are `packages/ui`, re-themed with tokens.
// The lobby and radio render their buttons as HTML strings, so a watcher gives each new button its kit class.
import { applyTheme, installUi } from "@rustybuns/ui";

export const PARK_THEME = {
  "--ui-bg": "var(--paper)", "--ui-ink": "var(--ink)", "--ui-dim": "var(--muted)", "--ui-line": "var(--brown-2)",
  "--ui-soft": "var(--lan)", "--ui-accent": "var(--brown)", "--ui-accent-soft": "var(--paper-2)", "--ui-on-accent": "var(--cream)",
  "--ui-border": "1px", "--ui-radius": "10px", "--ui-radius-sm": "6px", "--ui-font": "var(--grid)",
};

/** Which kit class a hand-written button gets, or "" when it keeps the game's own look (the sign-board Play, text links, colour swatches). */
export function kitClass(b: HTMLButtonElement): string {
  if (b.matches(".play, .link, .ui-btn, .ui-chip, .ui-tab, [data-look][style], [class*='gc-']")) return "";
  return b.hasAttribute("aria-pressed") ? "ui-chip" : "ui-btn";
}

export function installKit(root: HTMLElement = document.body): void {
  installUi();
  applyTheme(PARK_THEME, document.documentElement);
  const decorate = (n: ParentNode) => { for (const b of n.querySelectorAll<HTMLButtonElement>("button")) { const c = kitClass(b); if (c) b.classList.add(c); } };
  decorate(root);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n instanceof HTMLElement) { if (n instanceof HTMLButtonElement) { const c = kitClass(n); if (c) n.classList.add(c); } decorate(n); } }).observe(root, { childList: true, subtree: true });
}
