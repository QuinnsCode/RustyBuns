// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// Online, the token it keeps rides to /ws in place of the tab's uid, and the Worker checks it (`whoIs` in @rustybuns/util/token).
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "git-recon";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A LAN battle, a local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://git-recon.notryanquinn.workers.dev"];

/**
 * The briefing's look on every eqosys surface (report form, achievement toast): a white sheet in a black frame with the
 * hot orange edge on its left, the scope's corner brackets, stencil heads (the --br-* tokens in src/ui/styles.css, which
 * reach `.eq` too). The menu's own account button stays, since it hands the name box over to the account.
 */
export const SKIN = {
  theme: {
    "--ui-bg": "#fff", "--ui-ink": "var(--br-ink)", "--ui-dim": "var(--br-dim)", "--ui-line": "var(--br-ink)", "--ui-soft": "var(--br-sheet)",
    "--ui-accent": "var(--br-hot)", "--ui-accent-soft": "var(--accent-soft)", "--ui-on-accent": "#fff",
    "--ui-radius": "0", "--ui-radius-sm": "0", "--ui-font": "var(--sans)", "--ui-font-head": "var(--br-stencil)",
    "--ui-shadow": "8px 8px 0 #1414141a",
  },
  css: `.eq-form,.eq-toast,.rb-lobby,.rb-spaces{border-left:8px solid var(--br-hot);background:var(--br-brackets),#fff;background-repeat:no-repeat;padding-inline:22px}
.eq-title,.eq-toast b{text-transform:uppercase;letter-spacing:.06em}.eq-toast small{letter-spacing:.18em}
.eq-coach{top:120px;left:12px;right:auto;margin:0;border-left:8px solid var(--br-hot);box-shadow:var(--ui-shadow)}`,
};

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, signInHere, finishSignIn, login, fresh, signOut, canSignIn, reportButton, achieve, achievements, party, hub } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "git-recon", skin: SKIN });
