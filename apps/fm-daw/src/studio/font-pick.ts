// This viewer's pick of font for headings and buttons (Settings > You, #6420), kept in this browser: the jam room's
// settings and the front door (#6527) both wear it. The faces are fonts.css.

/** Qollab's own thick face (brand.css, the default) first, then the 20 on the owner's font board. Small text stays Exo 2 whichever is picked. */
export const FONTS = ["Russo One", "Saira Condensed","Barlow Condensed", "Inter", "Space Grotesk", "Oswald", "Bebas Neue", "Anton", "Teko", "Rajdhani",
  "Archivo Narrow", "Chakra Petch", "Orbitron", "Righteous", "Bungee", "Press Start 2P", "Space Mono", "DM Sans", "Outfit", "Fraunces", "Permanent Marker"] as const;
export const DEFAULT_FONT = FONTS[0];
const FONT_KEY = "qollab-studio:font";

/** The font this browser picked for headings and buttons, or the default. */
export function loadFont(): string {
  try { const f = localStorage.getItem(FONT_KEY); return f && FONTS.some((x) => x === f) ? f : DEFAULT_FONT; } catch { return DEFAULT_FONT; }
}
/** Wear `font` on this page (the `--qs-head` the jam room's CSS reads) and keep it for next time. */
export function wearFont(font: string, keep = true) {
  document.documentElement.style.setProperty("--qs-head", `"${font}"`);
  if (keep) try { localStorage.setItem(FONT_KEY, font); } catch { /* worn for this page only */ }
}
