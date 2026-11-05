// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// The game runs wholly in the page and has no server of its own, so there is no token to pass on: the sign-in
// gives the player their eqosys name, shown on the menu and with their result.
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "delayed-reaction";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A local page or the desktop window just plays without a name. */
export const SIGN_IN_FROM = ["https://delayed-reaction.notryanquinn.workers.dev"];

/** The menu's black and white on every eqosys surface (account chip, achievement toast, report form): style.css's colours. */
export const SKIN = { css: ".eq-btn,.eq-chip.in{border-radius:999px}", theme: {
  "--ui-bg": "var(--bg)", "--ui-ink": "var(--ink)", "--ui-line": "rgba(255, 255, 255, 0.7)", "--ui-dim": "rgba(255, 255, 255, 0.6)",
  "--ui-soft": "#151515", "--ui-accent": "#9dff5f", "--ui-accent-soft": "#1d2a14", "--ui-on-accent": "#000", "--ui-border": "1.5px",
  "--ui-radius-sm": "12px", "--ui-font": "system-ui, sans-serif", "--ui-shadow": "0 12px 30px -12px #000",
} };

export const { signIn, finishSignIn, login, signOut, canSignIn, accountChip, reportButton, achieve } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "delayed-reaction", skin: SKIN });
