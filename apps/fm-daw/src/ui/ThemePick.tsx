import { useState } from "react";
import { type Theme, THEMES, loadTheme, saveTheme, shownTheme } from "./theme.ts";

// lucide's monitor, sun and moon (ISC)
const ICONS: Record<Theme, React.ReactNode> = {
  system: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>,
  dark: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
};
const WORDS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

/** System, Light or Dark for the desk, an icon each with its word as the tooltip. */
export function ThemePick() {
  const [theme, setTheme] = useState(loadTheme);
  // System says which look the OS gives right now
  const word = (t: Theme) => t === "system" ? `System (${shownTheme(t, globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ?? false)} now)` : WORDS[t];
  return (
    <div className="field"><span className="silk">Look</span>
      <div className="seg theme-pick" role="radiogroup" aria-label="Light or dark">
        {THEMES.map((t) => (
          <button key={t} className={theme === t ? "on" : ""} role="radio" aria-checked={theme === t} title={word(t)} aria-label={WORDS[t]}
            onClick={() => { setTheme(t); saveTheme(t); }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[t]}</svg>
          </button>
        ))}
      </div>
    </div>
  );
}
