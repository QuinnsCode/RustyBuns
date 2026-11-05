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
 * Controls sheet (controls.ts): dark glass with a hairline, the one cyan glow, condensed uppercase heads, and the
 * red-and-cream trim on a toast (--panel, --edge, --accent, --red, --cream, --glow in app.css).
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
.eq-toast{border-top:3px solid var(--red);box-shadow:var(--glow),0 18px 40px -16px #000}`,
};

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, signOut, canSignIn, accountChip, reportButton, achieve } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "splat-rooms", skin: SKIN });
