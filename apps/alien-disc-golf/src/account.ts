// Signing in through eqosys, so the scorecard can carry the player's name and achievements land on the eqosys
// account (the catalog is "alien-disc-golf" in apps/eqosys/src/achievements.ts). The game has no server-side players
// (its Worker only relays NOAA's wind), so this is just the sign-in and the name: the token is kept for
// when a leaderboard needs a Worker to check it with `TokenChecker`.
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "alien-disc-golf";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A local page or the desktop window plays as a guest. */
export const SIGN_IN_FROM = ["https://alien-disc-golf.notryanquinn.workers.dev"];
/** The scanner's glass, from styles.css's own colours: the Controls card wears it (main.ts), and so does every eqosys
 * surface (account chip, achievement toast, report form), so a toast reads as one more panel of the weather board. */
export const THEME = {
  "--ui-bg": "var(--glass)", "--ui-panel": "var(--panel-art-solid)", "--ui-ink": "var(--ink)", "--ui-dim": "var(--dim)", "--ui-line": "var(--edge)",
  "--ui-soft": "var(--glass-hi)", "--ui-accent": "var(--teal)", "--ui-accent-soft": "var(--teal-soft)", "--ui-on-accent": "var(--on-teal)",
  "--ui-scrim": "var(--scrim)", "--ui-radius": "12px", "--ui-radius-sm": "8px", "--ui-border": "1px", "--ui-font": "var(--font)", "--ui-font-head": "var(--font)",
  "--ui-toast-bg": "var(--glass)", "--ui-toast-ink": "var(--ink)", "--ui-shadow": "var(--lift)",
};
/** The eqosys surfaces in that glass, plus what the panels have that tokens can't say: the toast's teal edge like the game's
 * own toast, the report form on the scanner grid with an amber heading, the chip's name in the readout's mono. */
export const SKIN = { theme: THEME, css: `
.eq-toasts{top:64px}
.eq-toast{background:var(--panel-art-solid);box-shadow:inset 3px 0 0 var(--teal),var(--lift)}
.eq-toast small{color:var(--amber);font-family:var(--mono)}
.eq-form{background:var(--panel-art-solid)}
.eq-title{color:var(--amber);font-size:14px;text-transform:uppercase;letter-spacing:.08em}
.eq-who{font-family:var(--mono);font-weight:600;font-size:13px}
.eq-coach{top:auto;bottom:58px;left:12px;right:auto;margin:0;width:min(340px,calc(100vw - 380px))}
@media (max-width:720px){.eq-toasts{top:96px}.eq-coach{top:112px;bottom:auto;left:0;right:0;margin:0 auto;width:calc(100vw - 24px)}}
` };

export const { signIn, finishSignIn, login, signOut, canSignIn, accountChip, reportButton, achieve, achievements } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "adg", skin: SKIN });
