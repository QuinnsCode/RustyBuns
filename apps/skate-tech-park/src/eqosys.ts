// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// The token it keeps rides to /ws in place of the browser-made uid, and the Worker checks it (edge/eqosys.ts).
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "skate-tech-park";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends riders back to. A local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://skate-tech-park.notryanquinn.workers.dev"];

export type { Login } from "@rustybuns/util/eqosys";
/** The house look on every eqosys surface, on the park's warm paper with its hard ink shadow. */
export const SKIN = { theme: { "--ui-bg": "#fbf7f0", "--ui-line": "#1b1b1f", "--ui-ink": "#1b1b1f", "--ui-accent": "#e2572b", "--ui-shadow": "3px 3px 0 #1b1b1f" } };

export const { signIn, finishSignIn, login, fresh, signOut, canSignIn, accountChip, reportButton, party, space, achieve } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "stp", skin: SKIN });
