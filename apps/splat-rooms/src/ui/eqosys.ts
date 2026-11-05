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
 * The scanner rig's look on every eqosys surface (account chip, report form, achievement toast): the side rails' dark
 * panel and hairline edge, the green go light, condensed silk-screen heads (--panel, --edge, --accent, --silk in app.css).
 */
export const SKIN = {
  theme: {
    "--ui-bg": "var(--panel)", "--ui-ink": "var(--ink)", "--ui-dim": "var(--dim)", "--ui-line": "var(--edge)", "--ui-soft": "var(--bg)",
    "--ui-accent": "var(--accent)", "--ui-accent-soft": "#1c2026", "--ui-on-accent": "var(--bg)",
    "--ui-radius": "5px", "--ui-radius-sm": "5px", "--ui-border": "1px", "--ui-font": "var(--body)", "--ui-font-head": "var(--silk)",
    "--ui-shadow": "0 16px 40px -12px #000c",
  },
  css: `.eq-chip{justify-self:start}.eq-chip:empty{display:none}.eq-btn{font-family:var(--silk);letter-spacing:.02em}.eq-who,.eq-title,.eq-toast b{font-weight:600}
.eq-note{color:var(--warn)}.eq-btn:hover{border-color:#3a424a}`,
};

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, signOut, canSignIn, accountChip, reportButton, achieve } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "splat-rooms", skin: SKIN });
