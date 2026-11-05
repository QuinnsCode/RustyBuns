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
 * Controls sheet (controls.ts passes the same theme): dark glass with a hairline and one ice-blue glow, condensed
 * silk-screen heads, and the red-and-cream Cold War trim on top of each card (tokens in app.css).
 */
export const LAB_THEME = {
  "--ui-bg": "#0f171d", "--ui-panel": "linear-gradient(160deg,#111b22f5,#070b0ef5)", "--ui-ink": "var(--ink)", "--ui-dim": "var(--dim)",
  "--ui-line": "var(--edge)", "--ui-soft": "#16222a", "--ui-scrim": "#000000b3",
  "--ui-accent": "var(--accent)", "--ui-accent-soft": "#66e0ff1f", "--ui-on-accent": "var(--on-accent)",
  "--ui-toast-bg": "#0c1217f2", "--ui-toast-ink": "var(--ink)", "--ui-toast-radius": "6px",
  "--ui-radius": "8px", "--ui-radius-sm": "4px", "--ui-border": "1px", "--ui-font": "var(--body)", "--ui-font-head": "var(--silk)",
  "--ui-shadow": "0 0 0 1px var(--hair), 0 0 22px -10px var(--glow), 0 24px 48px -16px #000",
};
/** The trim and glow, written once for the eqosys cards and the Controls card alike. */
const TRIM = "repeating-linear-gradient(-55deg,var(--red) 0 10px,var(--cream) 10px 14px)";
export const SKIN = {
  theme: LAB_THEME,
  css: `.eq-chip{justify-self:start}.eq-btn{font-family:var(--silk);letter-spacing:.06em;text-transform:uppercase}.eq-who{font:600 1rem var(--mono)}.eq-title,.eq-toast b{font-weight:600;letter-spacing:.04em}
.eq-note{color:var(--warn)}.eq-btn:hover{border-color:var(--accent);box-shadow:0 0 12px -4px var(--glow)}
.eq-toast{padding-top:14px;background:${TRIM} top/100% 4px no-repeat,var(--ui-toast-bg)}`,
};
/** The Controls sheet's own touches on the house skin: the trim strip, the glow edge, uppercase silk heads. */
export const CONTROLS_CSS = `.ui-house .gc-card{position:relative;box-shadow:var(--ui-shadow);padding-top:26px}
.ui-house .gc-card::before{content:"";position:absolute;inset:0 0 auto;height:5px;border-radius:8px 8px 0 0;background:${TRIM}}
.ui-house .gc-head h2{font:600 26px/1 var(--silk);letter-spacing:.06em;text-transform:uppercase}
.ui-house .gc-tab[aria-selected=true],.ui-house .gc-prof[aria-pressed=true],.ui-house .gc-key.on{box-shadow:0 0 14px -4px var(--glow)}
.gc-cog.ui-house{background:#0c1217cc;box-shadow:0 0 0 1px var(--hair),0 0 18px -8px var(--glow);backdrop-filter:blur(6px)}
.gc-cog.ui-house:hover{border-color:var(--accent)}`;

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, signOut, canSignIn, accountChip, reportButton, achieve } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "splat-rooms", skin: SKIN });
