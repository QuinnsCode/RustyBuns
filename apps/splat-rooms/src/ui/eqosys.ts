// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// Splat Rooms has no server of its own that knows players (the edge build is a viewer shell and scenes
// live on the player's disk), so the sign-in gives the menu a name and nothing more: the token is kept
// for when a Worker wants it (check it with TokenChecker from @rustybuns/util/token).
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "splat-rooms";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. The desktop app and local pages keep playing as a guest. */
export const SIGN_IN_FROM = ["https://splat-rooms.notryanquinn.workers.dev"];

/**
 * The gadget lab's look on every eqosys surface (account chip, report form, achievement toast) and on the cog's
 * Controls sheet (controls.ts): dark glass with a hairline, the one cyan glow, condensed uppercase heads, the red trim
 * along the top of a toast and the report form (a riveted secure terminal with a stamped hairline and a red serial under its
 * title: its fields are inset glass with a worn rust foot, typed in the lab mono, and Send carries the glow; on a phone a toast
 * drops below the hunt HUD on one line), and the signed-in
 * name as an agent's callsign (--panel, --edge, --accent, --red, --cream, --glow, --mono in app.css).
 */
export const SKIN = {
  theme: {
    "--ui-bg": "var(--panel)", "--ui-ink": "var(--ink)", "--ui-dim": "var(--dim)", "--ui-line": "var(--edge-hi)", "--ui-soft": "var(--accent-soft)",
    "--ui-accent": "var(--accent)", "--ui-accent-soft": "var(--accent-soft)", "--ui-on-accent": "var(--accent-ink)",
    "--ui-radius": "8px", "--ui-radius-sm": "6px", "--ui-border": "1px", "--ui-font": "var(--body)", "--ui-font-head": "var(--silk)",
    "--ui-shadow": "var(--glow), 0 24px 60px -20px #000", "--ui-scrim": "rgb(2 5 8 / 0.7)",
  },
  css: `.eq-chip{justify-self:start}.eq-chip:empty{display:none}.eq-btn{font-family:var(--silk);letter-spacing:.06em;text-transform:uppercase}.eq-who,.eq-title,.eq-toast b{font-weight:600}
.eq-note{color:var(--warn)}.eq-btn:hover{border-color:var(--accent);box-shadow:var(--glow)}
.eq-toast,.eq-form{border-top:3px solid var(--red);box-shadow:var(--glow),0 18px 40px -16px #000;background:var(--rivets),var(--wear),var(--panel);outline:1px solid rgb(239 228 201 / .06);outline-offset:-5px}
.eq-form input,.eq-form select{font-family:var(--mono);font-size:.85rem;letter-spacing:.02em}
.eq-form input,.eq-form select,.eq-form textarea{border:1px solid var(--edge-hi);border-bottom-color:rgb(154 90 54 / .7);border-radius:5px;color:var(--ink);background:var(--wear),linear-gradient(180deg,rgb(255 255 255 / .035),transparent 45%),rgb(4 9 12 / .82);box-shadow:inset 0 1px 3px rgb(0 0 0 / .6),inset 0 0 0 1px rgb(239 228 201 / .04)}
.eq-form input:focus,.eq-form select:focus,.eq-form textarea:focus{outline:none;border-color:var(--accent);box-shadow:var(--glow)}
.eq-form .eq-title::after{content:"SR-RPT \\00b7  04";display:block;margin-top:3px;font:800 .66rem var(--mono);letter-spacing:.14em;color:var(--red)}
.eq-form .eq-btn[type=submit]{box-shadow:var(--glow),inset 0 0 0 1px rgb(4 18 24 / .3)}
.eq-who{font-family:var(--silk);letter-spacing:.05em;text-transform:uppercase}
@media (max-width:600px){.eq-toasts{top:calc(max(16px,env(safe-area-inset-top)) + 150px)}.eq-toast{width:100%;padding:8px 12px}.eq-toast svg{width:24px;height:24px}
.eq-toast span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.eq-toast>div{min-width:0;flex:1}}`,
};

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, signOut, canSignIn, accountChip, reportButton, achieve, achievements, celebrate } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "splat-rooms", skin: SKIN });
