// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// The token it keeps rides to the online /ws in place of the browser-made uid, and the Worker checks it (`whoIs` in @rustybuns/util/token).
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS, SIGN_IN_FROM } from "../eqosys.ts";

/**
 * The oil barons' look on every eqosys surface (account chip, report form, achievement toast): the menu card's frosted
 * dark glass, a gold-to-pink gilt on the main button, the menu title's Didone letters (--glass, --gold, --pink, --didone,
 * --r in src/client/style.css).
 */
export const SKIN = {
  theme: {
    "--ui-bg": "var(--glass)", "--ui-ink": "var(--text)", "--ui-dim": "var(--dim)", "--ui-line": "var(--line)", "--ui-soft": "var(--glass2)",
    "--ui-accent": "var(--gold)", "--ui-accent-soft": "rgba(255, 203, 71, 0.14)", "--ui-on-accent": "#1a0610",
    "--ui-radius": "var(--r)", "--ui-radius-sm": "12px", "--ui-border": "1px",
    "--ui-font": "var(--sans)", "--ui-font-head": "var(--didone)",
    "--ui-shadow": "0 30px 80px rgba(0, 0, 0, 0.55)",
  },
  css: `.eq-form,.eq-toast,.rb-lobby,.rb-spaces{backdrop-filter:blur(24px) saturate(1.4)}.eq-chip{justify-self:start}.eq-chip:empty{display:none}
.eq-btn.primary{background:linear-gradient(135deg,var(--pink),var(--gold2));border-color:transparent}
.eq-title,.eq-toast b{letter-spacing:.07em;text-transform:uppercase}.eq-toast small{color:var(--pink)}
.eq-coach{top:auto;bottom:64px;left:auto;right:16px;margin:0}@media (max-width:720px){.eq-coach{top:230px;bottom:auto;left:0;right:0;margin:0 auto}}`,
};

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, fresh, signOut, canSignIn, accountChip, reportButton, achieve, achievements } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "hippo", skin: SKIN });
