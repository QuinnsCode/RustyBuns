// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// The token it keeps rides to /api/match and /ws in place of the tab's uid, and the Worker checks it (`whoIs` in @rustybuns/util/token).
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "splat-spray";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://supersplatspyshot.notryanquinn.workers.dev"];

/**
 * The spy file's look on every eqosys surface (account chip, report form, achievement toast): smoked glass over the dark
 * room with a thin paint-gold edge, poster capitals, and the toast as the manila dossier with its typed line (--glass,
 * --paint, --title, --manila, --type in src/styles.css).
 */
export const SKIN = {
  theme: {
    "--ui-bg": "rgba(18, 16, 14, 0.92)", "--ui-ink": "var(--ink)", "--ui-dim": "var(--dim)", "--ui-line": "rgba(224, 176, 74, 0.35)", "--ui-soft": "rgba(255, 255, 255, 0.08)",
    "--ui-accent": "var(--paint)", "--ui-accent-soft": "rgba(224, 176, 74, 0.15)", "--ui-on-accent": "var(--manila-ink)",
    "--ui-radius": "6px", "--ui-radius-sm": "6px", "--ui-border": "1px", "--ui-font-head": "var(--title)",
    "--ui-toast-bg": "var(--manila)", "--ui-toast-ink": "var(--manila-ink)", "--ui-shadow": "0 18px 40px rgba(0, 0, 0, 0.6)",
  },
  css: `.eq-form,.rb-lobby,.rb-spaces{backdrop-filter:blur(10px)}.eq-chip:empty{display:none}
.eq-title,.eq-toast b,.eq-who,.eq-btn{font-family:var(--title);font-weight:400;letter-spacing:.08em;text-transform:uppercase}.eq-title,.eq-toast b{font-size:1.4rem}
.eq-toast{border-radius:3px;font-family:var(--type);transform:rotate(-1.2deg)}.eq-toast small{color:var(--stamp)}.eq-toast svg{color:var(--stamp)}`,
};

export type { Login } from "@rustybuns/util/eqosys";
const account = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "splat-spray", skin: SKIN });
export const { signIn, finishSignIn, login, fresh, signOut, who, canSignIn, accountChip, reportButton, achieve } = account;

let partyClient: ReturnType<typeof account.party> | undefined;
/** The page's one party client: eqosys seats a player once per party, so the lobby keeps one socket. */
export const party = () => (partyClient ??= account.party());
