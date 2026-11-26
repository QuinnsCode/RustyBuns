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
 * Every eqosys surface is a die-cut sticker slapped on a deck: a print colour of its own (yellow toast, hot chip, cyan
 * lobby, lime spaces with its chat on a white label, pink form), the ink line, a white cut edge round it and a soft lift off the board, a halftone that
 * fades in from one corner, heavy italic capitals on the headings like a brand's print, and each sticker set at its own tilt, overlapping the
 * one before. The controls are small stickers too (a white cut, an uneven corner, each at a slant), not the house's even
 * pills; the tab you are on is an ink sticker. The park is paper in a dark system too, so the skin names every token the house's dark set changes
 * (packages/util/src/skin.ts DARK), or its fields and Send text would go dark on the sticker.
 */
export const SKIN = { theme: {
  "--ui-bg": "var(--paper)", "--ui-line": "var(--ink)", "--ui-ink": "var(--ink)", "--ui-accent": "var(--hot)", "--ui-shadow": "0 0 0 6px #fff,0 0 0 7px #1b1b1f2e,3px 7px 10px 5px #1b1b1f47",
  "--ui-soft": "#fff", "--ui-dim": "#1b1b1fb3", "--ui-accent-soft": "#fde9df", "--ui-on-accent": "#fff", "--ui-scrim": "#1b1b1f66",
  "--ui-font": "system-ui, sans-serif", // the park's own face (styles.css), not the house's rounded one
  "--ui-font-head": "system-ui, sans-serif", "--ui-radius": "16px", "--ui-radius-sm": "8px", "--ui-toast-bg": "#ffd23f", "--ui-toast-ink": "var(--ink)",
},
css: `.eq-form,.eq-toast,.rb-lobby,.rb-spaces,.eq-coach,.eq-chip.in,.rb-report>.eq-btn{--stk:var(--paper);background:linear-gradient(150deg,var(--stk) 48%,transparent 88%),radial-gradient(circle,#1b1b1f45 1.7px,transparent 2.2px) 0 0/7px 7px,var(--stk)}
.eq-toast{--stk:#ffd23f;rotate:2deg}.eq-coach{--stk:#ff9ec2;rotate:-1.5deg}.rb-lobby{--stk:#7fd0ea;rotate:1.3deg}.rb-spaces{--stk:#b7ec5d;rotate:-.6deg;margin-top:-6px}
.eq-form{--stk:#ff9ec2;rotate:-1deg}.eq-coach{--stk:#c3b1ff}
.rb-spaces-body{padding:6px 8px;border:2px solid var(--ink);border-radius:5px 9px 6px 10px;background:#fff;rotate:.5deg;box-shadow:2px 3px 0 #1b1b1f33}.rb-report>.eq-btn{--stk:#ffd23f;rotate:4deg;box-shadow:0 0 0 4px #fff,0 0 0 5px #1b1b1f2e,2px 4px 6px 3px #1b1b1f47}
.eq-chip.in{--stk:var(--hot);transform:rotate(-2.5deg);transform-origin:left center;margin:4px 0 4px 6px}
.eq-chip.in .eq-who{color:#fff;padding:2px 0 2px 3px;font-weight:800}.eq-chip.in .eq-who::before{content:"";display:inline-block;width:15px;height:12px;margin-right:7px;vertical-align:-1px;border-radius:3px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ffd23f'%3E%3Cpath d='M13 2 3 14h9l-1 8 10-12h-9z'/%3E%3C/svg%3E") center/9px no-repeat,var(--ink);box-shadow:0 0 0 1.5px #fff;transform:rotate(9deg)}
.eq-toast small{color:var(--ink);font-weight:800}.eq-toast svg{color:var(--ink)}.eq-title,.eq-toast b,.rb-spaces h2{font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:-.01em}.rb-spaces-log b{font-weight:800}
.eq-btn{font-weight:800;border-radius:11px 6px 12px 7px/8px 12px 6px 11px;background:#fff;box-shadow:0 0 0 3px #fff,0 0 0 4px #1b1b1f2e,1px 3px 4px 1px #1b1b1f47;rotate:-1.5deg}
.eq-btn:nth-child(even){rotate:1.5deg;border-radius:6px 12px 7px 11px/12px 7px 11px 6px}.eq-btn:active{translate:0 2px;box-shadow:0 0 0 3px #fff,0 0 0 4px #1b1b1f2e}
.eq-btn.primary{font-style:italic;font-weight:900;text-transform:uppercase}.rb-spaces-tabs .eq-btn.on{background:var(--ink);border-color:var(--ink);color:#ffd23f}
.eq input,.eq select,.eq textarea{background:#fff;border-radius:3px;box-shadow:inset 0 2px 0 #1b1b1f14}
.rb-lobby-code{background:#fff}.rb-spaces-online{border-left-style:dashed}
:where(.eq-toast){position:relative}
.eq-toast::after{content:"";position:absolute;right:-7px;bottom:-7px;width:24px;height:24px;pointer-events:none;background:linear-gradient(135deg,transparent 50%,#fff 50%,#eee 68%,#c9c9c9);border-top-left-radius:3px 16px;filter:drop-shadow(-2px -1px 1.5px #1b1b1f59)}
.rb-spaces-log{padding:5px 7px 5px 3px}.eq-chip.in .eq-btn{margin:4px 5px 4px 0}
.eq-form .eq-status:not(:empty){justify-self:start;padding:4px 8px;border:2px solid var(--ink);border-radius:4px 8px 5px 7px;background:#fff;color:var(--ink);font-weight:600;rotate:-.8deg}.eq-form .eq-status a{color:var(--ink);font-weight:800;text-decoration:underline 2px var(--hot)}
.eq select{appearance:none;padding-right:34px;font-weight:800;background:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%231b1b1f%27 stroke-width=%273%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E") right 10px center/16px no-repeat,#fff}
@media (max-width:600px){.rb-report .eq-form{rotate:none}}
@media (max-width:720px){.eq-coach{top:140px}}` }; // on a phone the tutorial's card sits under the HUD's buttons and park picker

export const { signIn, signInHere, finishSignIn, login, fresh, signOut, who, canSignIn, accountChip, reportButton, party, space, hub, achieve, achievements } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "stp", skin: SKIN });
