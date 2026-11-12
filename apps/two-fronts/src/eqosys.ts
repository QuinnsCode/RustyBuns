// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// Campaigns are played from secret seat links. A party (With friends) seat belongs to the eqosys account that claimed it:
// the Worker checks the login, and the same account claims it again from any device.
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS } from "./account.ts";

export { APP, EQOSYS };
/** The origin eqosys sends players back to. A local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://two-fronts.notryanquinn.workers.dev"];

/**
 * The warship's plates on every eqosys surface (the account chip as a bolted brass tag, achievement toast, report form, lobby, spaces), from the
 * same tokens the menus wear in styles.css: --steel and --bolts (the baked public/plates), the worn rim --edge,
 * --bevel, brass for the action and the stencil face for titles and labels.
 */
export const SKIN = {
  theme: {
    "--ui-bg": "var(--plate)", "--ui-ink": "#eef1f5", "--ui-dim": "var(--stencil)", "--ui-line": "#2b3440", "--ui-soft": "#11151b",
    "--ui-accent": "var(--brass)", "--ui-accent-soft": "#3a2f18", "--ui-on-accent": "#1d1405", "--ui-scrim": "#000b",
    "--ui-radius": "0", "--ui-radius-sm": "2px", "--ui-border": "1px",
    "--ui-font": "var(--f-readout)", "--ui-font-head": "var(--f-stencil)",
    "--ui-toast-bg": "var(--plate)", "--ui-shadow": "var(--bevel), 0 4px 0 #05070a, 0 14px 34px rgb(0 0 0 / 0.6)",
  },
  css: `.eq-form,.eq-toast,.rb-lobby,.rb-spaces{background:var(--bolts),var(--steel);background-color:var(--plate);border:8px solid transparent;border-image:var(--edge) 10 round;background-clip:padding-box;padding-inline:18px}
.eq-chip.in{padding:2px 18px;background:url("/plates/bolt.webp") left 5px center/9px no-repeat,url("/plates/bolt.webp") right 5px center/9px no-repeat,linear-gradient(180deg,#f6d27a,#d8a83f 48%,#a8781f 52%,#8a6118);border:1px solid #5c3f0c;border-radius:2px;box-shadow:inset 0 1px 0 #fff7dcb3,inset 0 -2px 0 #3c260673,0 2px 0 #05070a,0 3px 6px #000a}
.eq-chip.in .eq-who{color:#24180a;text-shadow:0 1px 0 #fff0c866}
.eq-chip.in .eq-btn{min-height:26px;min-width:26px}
.eq-title,.eq-who,.eq-toast b:not(.eq-badge *),.eq-toast small,.eq-btn{font-family:var(--f-stencil);font-weight:400;text-transform:uppercase;letter-spacing:.1em}
.eq-title,.eq-toast b:not(.eq-badge *){background:linear-gradient(180deg,var(--brass-hi),var(--brass) 60%,#b07f22);-webkit-background-clip:text;background-clip:text;color:transparent}
.account .eq-who{font-size:11px;max-width:7em}.eq-toast small{color:var(--readout);font-family:var(--f-readout);letter-spacing:.14em;white-space:nowrap}.eq-toast svg{filter:drop-shadow(0 0 4px #d8a83f66)}
.eq-btn{background:linear-gradient(#ffffff12,#00000040),var(--steel);background-color:#222831;border-color:#07090c;box-shadow:inset 0 1px 0 #ffffff1f,inset 0 -2px 0 #00000073,0 2px 0 #05070a}
.eq-btn.primary{background:var(--brass-btn);border-color:#5c3f0c;color:var(--ui-on-accent);text-shadow:0 1px 0 #fff0c873;box-shadow:inset 0 1px 0 #fff7dcb3,inset 0 -2px 0 #3c260673,0 2px 0 #3a2706}
.eq input,.eq select,.eq textarea{background:repeating-linear-gradient(0deg,#8fd3ff08 0 1px,transparent 1px 3px),var(--inset);background-color:#11151b;border-color:#05070a;box-shadow:inset 0 2px 7px #000000bf}
.eq-coach{top:120px}@media (max-width:760px){.eq-coach{top:196px}}`,
};

export type { Login } from "@rustybuns/util/eqosys";
const account = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "tf", skin: SKIN });
export const { signIn, finishSignIn, login, fresh, signOut, canSignIn, accountChip, reportButton, achieve, achievements, space } = account;
let partyClient: ReturnType<typeof account.party> | undefined;
/** The page's one party client: eqosys seats a player once per party, so the lobby keeps one socket. */
export const party = () => (partyClient ??= account.party());
