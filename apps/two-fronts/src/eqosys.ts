// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// Campaigns are played from secret seat links and have no player accounts, so the login is the name shown
// in the panel and nothing the Worker checks yet.
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "two-fronts";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://two-fronts.notryanquinn.workers.dev"];

/**
 * The war room's look on every eqosys surface (account chip, achievement toast, report form): brass on gunmetal, square
 * corners, the imperial lettering (--imperial, --imperial-text in styles.css).
 */
export const SKIN = {
  theme: {
    "--ui-bg": "#1c2128", "--ui-ink": "#ece2c6", "--ui-dim": "#a39a82", "--ui-line": "#9c7a2a", "--ui-soft": "#252b34",
    "--ui-accent": "#d4a63a", "--ui-accent-soft": "#3a3220", "--ui-on-accent": "#14171c", "--ui-scrim": "#000b",
    "--ui-radius": "1px", "--ui-radius-sm": "1px", "--ui-border": "1px",
    "--ui-font": "var(--imperial-text)", "--ui-font-head": "var(--imperial)",
    "--ui-toast-bg": "#1c2128", "--ui-shadow": "0 0 0 1px #000, 0 14px 30px -12px #000e",
  },
  // Riveted steel: a brushed grain, a brass hairline inside the edge, and stencilled capitals.
  css: `.eq-form,.eq-toast,.eq-chip.in{background:repeating-linear-gradient(90deg,#ffffff04 0 1px,transparent 1px 3px),linear-gradient(#262c35,#161a20);box-shadow:inset 0 0 0 3px #1c2128,inset 0 0 0 4px #d4a63a33,var(--ui-shadow)}
.eq-title,.eq-who,.eq-toast b,.eq-btn{text-transform:uppercase;letter-spacing:.12em}.eq-who{font-size:12px}.eq-toast small{color:var(--ui-accent)}
.eq-btn{background:linear-gradient(#2b323c,#1b2027)}.eq-btn.primary{background:linear-gradient(#e0b54c,#a9822a);color:var(--ui-on-accent)}
.eq input,.eq select,.eq textarea{background:#11151a;border-color:#3a3a32}`,
};

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, fresh, signOut, canSignIn, accountChip, reportButton, achieve } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "tf", skin: SKIN });
