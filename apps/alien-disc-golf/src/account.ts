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
/** The globe's dark glass on every eqosys surface (account chip, achievement toast, report form): styles.css's own colours. */
export const SKIN = { theme: {
  "--ui-bg": "var(--panel)", "--ui-ink": "var(--ink)", "--ui-line": "var(--line)", "--ui-dim": "var(--dim)", "--ui-soft": "var(--panel)",
  "--ui-accent": "var(--teal)", "--ui-on-accent": "#04121a", "--ui-border": "1px", "--ui-radius": "10px", "--ui-radius-sm": "6px",
} };

export const { signIn, finishSignIn, login, signOut, canSignIn, accountChip, reportButton, achieve } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "adg", skin: SKIN });
