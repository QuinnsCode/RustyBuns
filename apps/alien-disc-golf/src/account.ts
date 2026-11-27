// Signing in through eqosys, so the scorecard can carry the player's name and achievements land on the eqosys
// account (the catalog is "alien-disc-golf" in apps/eqosys/src/achievements.ts). The game has no server-side players
// (its Worker only relays NOAA's wind), so this is just the sign-in and the name: the token is kept for
// when a leaderboard needs a Worker to check it with `TokenChecker`.
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "alien-disc-golf";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A local page or the desktop window plays as a guest. */
export const SIGN_IN_FROM = ["https://alien-disc-golf.notryanquinn.workers.dev"];
/** The scanner's glass, from styles.css's own colours: the Controls card wears it (main.ts), and so does every eqosys
 * surface (account chip, achievement toast, report form), so a toast reads as one more panel of the weather board. */
export const THEME = {
  "--ui-bg": "var(--glass)", "--ui-panel": "var(--panel-art-solid)", "--ui-ink": "var(--ink)", "--ui-dim": "var(--dim)", "--ui-line": "var(--edge)",
  "--ui-soft": "var(--glass-hi)", "--ui-accent": "var(--teal)", "--ui-accent-soft": "var(--teal-soft)", "--ui-on-accent": "var(--on-teal)",
  "--ui-scrim": "var(--scrim)", "--ui-radius": "12px", "--ui-radius-sm": "8px", "--ui-border": "1px", "--ui-font": "var(--font)", "--ui-font-head": "var(--font)",
  "--ui-toast-bg": "var(--glass)", "--ui-toast-ink": "var(--ink)", "--ui-shadow": "var(--lift)",
};
/** The title's disc-in-orbit (board.ts `orbitMark`) flattened to fills, for a corner a stylesheet can paint. */
const ORBIT = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-70 -70 140 140"><circle r="34" fill="none" stroke="#5ee6c8" stroke-width="3"/><path d="M-34 0h68M0-34v68M-30-16q30 8 60 0M-30 16q30-8 60 0" fill="none" stroke="#5ee6c8" stroke-opacity=".35" stroke-width="2"/><ellipse rx="62" ry="20" transform="rotate(-18)" fill="none" stroke="#ffb347" stroke-width="7"/><circle cx="52" cy="-30" r="10" fill="#ffd791" stroke="#ffb347" stroke-width="4"/></svg>`)}")`;
/** The eqosys surfaces in that glass, plus what the panels have that tokens can't say: the toast's teal edge like the game's
 * own toast (the disc-in-orbit in a bezelled well where the trophy was, a frond in its corner), the chip's name in the readout's mono, and the report form as one more instrument of the weather board: the
 * forecast board's lit header strip with the disc-in-orbit, fields as its dark bezelled wells in the scanner's mono, Send as a
 * lit plate, and a frond from the course grown up in its corner. On a phone the chip right above already carries eqosys's
 * badge, so the toast leaves its own off. */
export const SKIN = { theme: THEME, css: `
.eq-toasts{top:64px}
.eq-toast{position:relative;overflow:hidden;max-width:min(480px,calc(100vw - 32px));padding-right:60px;background:var(--flora-faint,none) right -10px bottom 0/260px auto no-repeat,var(--panel-art-solid);box-shadow:inset 3px 0 0 var(--teal),var(--lift)}
.eq-toast>svg:first-child{display:none}
.eq-toast::before{content:"";flex:none;width:46px;height:46px;border-radius:50%;background:${ORBIT} center/34px no-repeat,radial-gradient(#0b1b2c,#040a12 70%);
box-shadow:inset 0 0 0 2px #030810,inset 0 0 0 3px rgba(94,230,200,.18),0 0 14px rgba(255,179,71,.28)}
.eq-toast small{color:var(--amber);font-family:var(--mono)}
.eq .eq-form{background:var(--flora-faint,none) right -6px bottom -4px/440px auto no-repeat,var(--panel-art-solid);gap:10px}
.eq-form .eq-head{margin:-14px -14px 2px;padding:9px 10px 8px 12px;border-bottom:1px solid var(--edge);border-radius:11px 11px 0 0;background:linear-gradient(rgba(94,230,200,.1),rgba(94,230,200,.02))}
.eq-form .eq-head::before{content:"";flex:none;width:26px;height:26px;background:${ORBIT} center/contain no-repeat;filter:drop-shadow(0 0 4px rgba(255,179,71,.45))}
.eq .eq-form input,.eq .eq-form select,.eq .eq-form textarea{border:1px solid var(--edge);border-radius:8px;color:var(--ink);font:13px/1.4 var(--mono);
background:repeating-linear-gradient(transparent 0 2px,rgba(94,230,200,.025) 2px 3px),linear-gradient(#071321,#040a12);
box-shadow:inset 0 0 0 2px #030810,inset 0 0 0 3px rgba(94,230,200,.12),inset 0 10px 22px -12px rgba(94,230,200,.18)}
.eq .eq-form select{color:var(--teal);font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.eq .eq-form ::placeholder{color:var(--dim);opacity:1;font-family:var(--font)}
.eq .eq-form input:focus,.eq .eq-form textarea:focus{border-color:var(--teal)}
.eq .eq-form button[type=submit]{min-height:40px;font:600 15px var(--font);border-radius:8px;
box-shadow:inset 0 0 0 2px var(--teal),inset 0 0 0 3px rgba(4,34,28,.45),0 0 16px rgba(94,230,200,.35)}
.eq-form .eq-status{font-size:12px;color:var(--dim)}.eq-form .eq-status:last-child{padding-right:96px}
.eq-title{color:var(--amber);font-size:13px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
.eq-who{font-family:var(--mono);font-weight:600;font-size:13px}
.eq-coach{top:auto;bottom:58px;left:12px;right:auto;margin:0;width:min(340px,calc(100vw - 380px))}
@media (max-width:720px){.eq-toasts{top:96px}.eq .eq-toast .eq-badge{display:none}.eq-coach{top:112px;bottom:auto;left:0;right:0;margin:0 auto;width:calc(100vw - 24px)}}
` };

export const { signIn, finishSignIn, login, signOut, canSignIn, accountChip, reportButton, achieve, achievements } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "adg", skin: SKIN });
