// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// Campaigns are played from secret seat links and have no player accounts, so the login is the name shown
// in the panel and nothing the Worker checks yet.
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "two-fronts";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://two-fronts.notryanquinn.workers.dev"];

// Worn plate for the skin below: a fine grit, a few long scratches, brass rivets in the corners, and chamfered corners
// with a brass line where the edge was cut. Plain CSS images, so nothing to load.
const GRIT = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .85 0 0 0 0 .8 0 0 0 0 .65 0 0 0 .1 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
const SCRATCHES = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='190' fill='none' stroke='%23efe4c4' stroke-opacity='.09' stroke-width='.7' stroke-linecap='round'%3E%3Cpath d='M14 42l62-15M92 158l112-31M31 122l44 7M152 18l74 23M186 92l-52 61M9 176l52-41M122 71l33-5M210 140l38-9M60 90l3 26'/%3E%3C/svg%3E")`;
const rivet = (x: string, y: string) => `radial-gradient(circle at ${x} ${y},#f0cf78 0 1px,#b8922e 1.6px,#3b2c0e 2.4px,transparent 3px)`;
const RIVETS = [rivet("10px", "10px"), rivet("calc(100% - 10px)", "10px"), rivet("10px", "calc(100% - 10px)"), rivet("calc(100% - 10px)", "calc(100% - 10px)")].join(",");
const cut = (c: number) => `polygon(${c}px 0,calc(100% - ${c}px) 0,100% ${c}px,100% calc(100% - ${c}px),calc(100% - ${c}px) 100%,${c}px 100%,0 calc(100% - ${c}px),0 ${c}px)`;
const corner = (deg: number, at: string, c: number) => `linear-gradient(${deg}deg,transparent ${c * 0.7 - 0.6}px,#9c7a2a ${c * 0.7 - 0.6}px ${c * 0.7 + 0.6}px,transparent ${c * 0.7 + 0.6}px) ${at}/${c * 2}px ${c * 2}px no-repeat`;
const CORNERS = (c: number) => [corner(135, "0 0", c), corner(225, "100% 0", c), corner(45, "0 100%", c), corner(315, "100% 100%", c)].join(",");
const PLATE = "linear-gradient(172deg,#2c333d,#1d2229 55%,#15191e)";

/**
 * The war room's look on every eqosys surface (account chip, achievement toast, report form, lobby, spaces): worn
 * brass-riveted gunmetal, square cut corners, the imperial lettering (--imperial, --imperial-text in styles.css).
 */
export const SKIN = {
  theme: {
    "--ui-bg": "#1c2128", "--ui-ink": "#ece2c6", "--ui-dim": "#a39a82", "--ui-line": "#9c7a2a", "--ui-soft": "#13171c",
    "--ui-accent": "#d4a63a", "--ui-accent-soft": "#3a3220", "--ui-on-accent": "#14171c", "--ui-scrim": "#000b",
    "--ui-radius": "0", "--ui-radius-sm": "0", "--ui-border": "1px",
    "--ui-font": "var(--imperial-text)", "--ui-font-head": "var(--imperial)",
    "--ui-toast-bg": "#1c2128", "--ui-shadow": "0 14px 30px -12px #000e",
  },
  css: `.eq-form,.eq-toast,.rb-lobby,.rb-spaces{background:${CORNERS(7)},${RIVETS},${SCRATCHES},${GRIT},${PLATE};clip-path:${cut(7)};box-shadow:inset 1px 1px 0 #ffffff1c,inset -1px -1px 0 #000a,inset 0 0 0 4px #1c212880,inset 0 0 0 5px #d4a63a26;padding-inline:20px}
.eq-chip.in{background:${CORNERS(4)},${GRIT},${PLATE};clip-path:${cut(4)};box-shadow:inset 1px 1px 0 #ffffff1c,inset -1px -1px 0 #000a}
.eq-title,.eq-who,.eq-toast b,.eq-btn{text-transform:uppercase;letter-spacing:.12em}.eq-title,.eq-toast b{text-shadow:0 1px 0 #000,0 0 6px #d4a63a40}
.account .eq-who{font-size:11px;max-width:8em}.eq-toast small{color:var(--ui-accent)}.eq-toast svg{filter:drop-shadow(0 0 4px #d4a63a66)}
.eq-btn{background:${GRIT},linear-gradient(#2e353f,#1a1f26);box-shadow:inset 1px 1px 0 #ffffff1f,inset -1px -1px 0 #0009;clip-path:${cut(3)}}
.eq-btn.primary{background:${GRIT},linear-gradient(#e6bd55,#a07a24);color:var(--ui-on-accent);text-shadow:0 1px 0 #f3d78c}
.eq input,.eq select,.eq textarea{background:${GRIT},#0f1216;border-color:#3d3a2e;box-shadow:inset 0 2px 4px #0009}`,
};

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, fresh, signOut, canSignIn, accountChip, reportButton, achieve } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "tf", skin: SKIN });
