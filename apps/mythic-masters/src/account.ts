// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id and its tome
// skin; the title's account row is the shared chip. The game and its save stay in the page; the one place a token is
// checked is walking the world together (#3663): the page sends it to /ws and the Worker checks it (`whoIs` in @rustybuns/util/token).
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
    "--ui-bg": "var(--paper)", "--ui-ink": "var(--ink-b)", "--ui-dim": "var(--ink-faded)", "--ui-line": "var(--ink-faded)", "--ui-soft": "var(--paper-hi)",
    "--ui-accent": "var(--blood)", "--ui-accent-soft": "var(--paper-lo)", "--ui-on-accent": "var(--paper-hi)", "--ui-scrim": "#1a0e0699",
    "--ui-radius": "3px", "--ui-radius-sm": "3px", "--ui-border": "1.5px",
    "--ui-font": "var(--f-book)", "--ui-font-head": "var(--f-title)", "--ui-shadow": "0 16px 32px -14px rgba(40, 20, 6, 0.75)",
    "--ui-top": "52px", // under the cog and the field chart, top right
  },
  css: `.eq-form,.eq-toast,.eq-chip.in{background:var(--grain),linear-gradient(170deg,var(--paper-hi),var(--paper) 45%,var(--paper-lo))}
.eq-who{font-family:var(--f-hand);font-size:20px;font-weight:400}.eq-title,.eq-toast b{font-weight:600;font-size:19px}
.eq-toast span{font-family:var(--f-hand);font-size:17px;opacity:1;color:var(--ink-faded)}.eq-toast small{font-family:var(--f-book);font-style:italic;letter-spacing:.04em;text-transform:none;font-size:13px}
.eq input,.eq select,.eq textarea{background:var(--paper-hi)}
.eq-coach{top:104px;background:var(--grain),linear-gradient(170deg,var(--paper-hi),var(--paper) 45%,var(--paper-lo))}.eq-coach b{font-size:19px}.eq-coach p{font-family:var(--f-book)}`,
};

const account = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "mm", skin: SKIN });
export const { signIn, finishSignIn, login, fresh, signOut, canSignIn, accountChip, reportButton, achieve, achievements, hub } = account;
let partyClient: ReturnType<typeof account.party> | undefined;
/** The page's one party client: eqosys seats a player once per party, so the world's lobby and the Book's readers
 *  (both at `?party=`) listen on one socket, or each knocks the other out. */
export const party = () => (partyClient ??= account.party());
