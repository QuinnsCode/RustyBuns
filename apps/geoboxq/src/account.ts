// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this app's id.
// GeoBoxQ keeps everything in the browser and its Worker has no notion of who is asking, so signing in
// only gives the page a name to show; the token is kept for when something server-side needs one.
import { eqosys } from "@rustybuns/util/eqosys";

/** This app's id in eqosys's APPS. */
export const APP = "geoboxq";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends people back to. A local page or the desktop build stays signed out. */
export const SIGN_IN_FROM = ["https://geoboxq-worker-live-ryanquinn-tjhne4lpmumy6kz5.notryanquinn.workers.dev", "https://geoboxq.qntbr.com"];
/** The page's paper and orange on every eqosys surface (account chip, achievement toast, report form): style.css's own colours. */
export const SKIN = { theme: {
  "--ui-bg": "var(--card)", "--ui-ink": "var(--ink)", "--ui-line": "var(--line)", "--ui-dim": "var(--soft)", "--ui-soft": "var(--bg)", "--ui-accent": "var(--accent)",
} };

export const { signIn, finishSignIn, login, signOut, canSignIn, accountChip, reportButton } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "geoboxq", skin: SKIN });
