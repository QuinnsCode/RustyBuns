// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id and its tome
// skin; the title's account row is the shared chip. Mythic Masters has no server and no player identity yet (a local 1v1 and a save in the
// page), so there is no token to check anywhere: signing in only gives the title a name to greet.
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "mythic-masters";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origins eqosys sends players back to (#2994). Anywhere else, only a local eqosys (the `mm.eqosys` setting) can sign
 * anyone in, and everyone else sees no sign-in control. */
export const SIGN_IN_FROM: string[] = ["https://mythic-masters.notryanquinn.workers.dev"];

/**
 * The tome's look on every eqosys surface (account chip, achievement toast, report form): parchment and ink, the book's
 * gothic headings and the Book's own hand for your name. The fonts and paper are tome.css's.
 */
export const SKIN = {
  theme: {
    "--ui-bg": "#e8d9b5", "--ui-ink": "#2a1b10", "--ui-dim": "#5e4630", "--ui-line": "rgba(70, 42, 18, 0.55)", "--ui-soft": "#f1e5c6",
    "--ui-accent": "#7b1d14", "--ui-accent-soft": "#ead2b0", "--ui-on-accent": "#f1e5c6", "--ui-scrim": "#1a0e0699",
    "--ui-radius": "3px", "--ui-radius-sm": "3px", "--ui-border": "1.5px",
    "--ui-font": "var(--f-book)", "--ui-font-head": "var(--f-title)", "--ui-shadow": "0 16px 32px -14px rgba(40, 20, 6, 0.75)",
  },
  css: `.eq-form,.eq-toast,.eq-chip.in{background:var(--grain),linear-gradient(170deg,var(--paper-hi),var(--paper) 45%,var(--paper-lo))}
.eq-who{font-family:var(--f-hand);font-size:20px;font-weight:400}.eq-title,.eq-toast b{font-weight:600;font-size:19px}
.eq-toast span{font-family:var(--f-hand);font-size:17px;opacity:1;color:var(--ink-faded)}.eq-toast small{font-family:var(--f-book);font-style:italic;letter-spacing:.04em;text-transform:none;font-size:13px}
.eq input,.eq select,.eq textarea{background:#f6edd4aa}`,
};

export const { signIn, finishSignIn, login, signOut, canSignIn, accountChip, reportButton, achieve, party } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "mm", skin: SKIN });
