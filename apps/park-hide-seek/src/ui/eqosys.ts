// Park Hide & Seek's side of signing in through eqosys: the shared client (@rustybuns/util/eqosys) with this game's id.
// The token it keeps is what the Worker checks (`whoIs` in @rustybuns/util/token).
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS, SIGN_IN_FROM } from "../api.ts";

/**
 * The trailhead sign on every eqosys surface (the signed-in line, report form, toast, party lobby): grained paper, brown
 * ink, a rust edge under the main button, the sign-painter's letters (--paper, --brown, --rust, --sign in styles.css).
 * The signed-in line is the menu's own `#who` wearing the chip's classes, since signing in there carries the party along.
 */
export const SKIN = {
  theme: {
    "--ui-bg": "var(--paper)", "--ui-ink": "var(--ink)", "--ui-dim": "var(--muted)", "--ui-line": "var(--brown)", "--ui-soft": "var(--field)",
    "--ui-accent": "var(--rust)", "--ui-accent-soft": "var(--paper-2)", "--ui-on-accent": "var(--cream)",
    "--ui-radius": "4px", "--ui-radius-sm": "4px", "--ui-font-head": "var(--sign)", "--ui-shadow": "0 12px 30px rgba(20, 14, 8, 0.45)",
  },
  css: `.eq-form,.eq-toast,.rb-lobby,.rb-spaces,.eq-chip.in{background:var(--halftone) 0 0 repeat-x,var(--grain),var(--paper)}
.eq-btn.primary{background:var(--brown);border-color:var(--brown);box-shadow:inset 0 -4px 0 var(--rust)}
.eq-title,.eq-toast b,.eq-who{font-weight:400;letter-spacing:.02em;color:var(--brown)}
.eq-chip[hidden]{display:none}#who{margin:0 0 12px}`,
};

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, fresh, signOut, eqosysUrl, canSignIn, report, reportButton, party, achieve } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "phs", skin: SKIN });
