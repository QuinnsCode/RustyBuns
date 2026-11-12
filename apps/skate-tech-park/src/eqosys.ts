// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// The token it keeps rides to /ws in place of the browser-made uid, and the Worker checks it (`whoIs` in @rustybuns/util/token).
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "skate-tech-park";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends riders back to. A local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://skate-tech-park.notryanquinn.workers.dev"];

export type { Login } from "@rustybuns/util/eqosys";
/**
 * The house look on every eqosys surface, on the park's warm paper with its hard ink shadow. The park is paper in a dark
 * system too, so the skin names every token the house's dark set changes (packages/util/src/skin.ts DARK), or its fields
 * and Send text would go dark on the paper.
 */
export const SKIN = { theme: {
  "--ui-bg": "var(--paper)", "--ui-line": "var(--ink)", "--ui-ink": "var(--ink)", "--ui-accent": "var(--hot)", "--ui-shadow": "3px 3px 0 var(--ink)",
  "--ui-soft": "#f3ece1", "--ui-dim": "#6e6e73", "--ui-accent-soft": "#fde9df", "--ui-on-accent": "var(--paper)", "--ui-scrim": "#1b1b1f66",
  "--ui-font": "system-ui, sans-serif", // the park's own face (styles.css), not the house's rounded one
},
// A sticker slapped on the deck: a white die-cut edge round the ink line, the park's offset ink shadow, a halftone grain on
// the paper, the chip set a touch askew, and buttons that press into their shadow like the HUD's (styles.css .icon-btn).
css: `.eq-form,.eq-toast,.rb-lobby,.rb-spaces,.eq-chip.in{background-image:radial-gradient(#1b1b1f12 1px,transparent 1.3px);background-size:5px 5px;box-shadow:0 0 0 3px #fff,5px 5px 0 2px var(--ink)}
.eq-chip.in{transform:rotate(-1.2deg);transform-origin:left center}
.eq-btn{box-shadow:2px 2px 0 var(--ink)}.eq-btn:active{transform:translate(2px,2px);box-shadow:0 0 0 var(--ink)}
@media (max-width:720px){.eq-coach{top:140px}}` }; // on a phone the tutorial's card sits under the HUD's buttons and park picker

export const { signIn, finishSignIn, login, fresh, signOut, who, canSignIn, accountChip, reportButton, party, space, achieve, achievements } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "stp", skin: SKIN });
