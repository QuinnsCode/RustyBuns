// The house tokens: one accent, ink on white, fat rounded tiles with one strong outline.
// A game re-themes the kit by writing any of these onto :root or one element (`applyTheme`), never by forking CSS.
export const TOKENS = {
  "--ui-bg": "#ffffff",
  "--ui-ink": "#141414",
  "--ui-dim": "#6e6e73",
  "--ui-line": "#141414",
  "--ui-soft": "#f4f3f0",
  "--ui-accent": "#e8590c",
  "--ui-accent-soft": "#fff1e8",
  "--ui-scrim": "#14141466",
  "--ui-radius": "16px",
  "--ui-radius-sm": "12px",
  "--ui-border": "2px",
  "--ui-font": "ui-rounded,'SF Pro Rounded',system-ui,sans-serif",
} as const;

/** Token name (with or without the leading `--`) to CSS value. */
export type Theme = Record<string, string>;

/** Put a game's tokens on elements. */
export function applyTheme(theme: Theme | undefined, ...els: HTMLElement[]): void {
  for (const [k, v] of Object.entries(theme ?? {})) for (const el of els) el.style.setProperty(k.startsWith("--") ? k : `--${k}`, v);
}
