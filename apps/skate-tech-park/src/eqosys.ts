// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// The token it keeps rides to /ws in place of the browser-made uid, and the Worker checks it (`whoIs` in @rustybuns/util/token).
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "skate-tech-park";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends riders back to. A local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://skate-tech-park.notryanquinn.workers.dev"];

export type { Login } from "@rustybuns/util/eqosys";
/**
 * The house look on every eqosys surface, on the park's warm paper with its hard ink shadow. The park is paper in a dark
 * system too, so the skin names every token the house's dark set changes (packages/util/src/skin.ts DARK), or its fields
 * and Send text would go dark on the paper.
 */
export const SKIN = { theme: {
  "--ui-bg": "var(--paper)", "--ui-line": "var(--ink)", "--ui-ink": "var(--ink)", "--ui-accent": "var(--hot)", "--ui-shadow": "3px 3px 0 var(--ink)",
  "--ui-soft": "#f3ece1", "--ui-dim": "#6e6e73", "--ui-accent-soft": "#fde9df", "--ui-on-accent": "var(--paper)", "--ui-scrim": "#1b1b1f66",
} };

export const { signIn, finishSignIn, login, fresh, signOut, canSignIn, accountChip, reportButton, party, space, achieve } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "stp", skin: SKIN });
