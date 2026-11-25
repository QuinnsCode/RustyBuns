// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id and its tome
// skin; the title's account row is the shared chip. The game and its save stay in the page; the one place a token is
// checked is walking the world together (#3663): the page sends it to /ws and the Worker checks it (`whoIs` in @rustybuns/util/token).
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "mythic-masters";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origins eqosys sends players back to (#2994). Anywhere else, only a local eqosys (the `mm.eqosys` setting) can sign
 * anyone in, and everyone else sees no sign-in control. */
export const SIGN_IN_FROM: string[] = ["https://mythic-masters.notryanquinn.workers.dev"];

/** A leaf's deckled edge, as a mask the size of the leaf: its outline pulled in a little and pushed about by slow noise. */
const DECKLE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Cfilter id='d' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.05 .07' numOctaves='2' seed='7' result='n'/%3E%3CfeMorphology in='SourceGraphic' operator='erode' radius='4' result='e'/%3E%3CfeDisplacementMap in='e' in2='n' scale='14' xChannelSelector='R' yChannelSelector='G'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23d)'/%3E%3C/svg%3E") 0 0/100% 100% no-repeat`;
const LEAF = ".eq-form,.eq-toast,.rb-lobby,.rb-spaces,.eq-coach,.eq-chip.in,.rb-report>.eq-btn", leaf = (after: string) => LEAF.split(",").map((p) => p + after).join(",");

/**
 * The tome's look on every eqosys surface (account chip, achievement toast, report form, party lobby, spaces panel):
 * each panel is a loose leaf of the book, parchment with a deckled edge (the paper is a layer behind the panel, cut by
 * DECKLE, so the leaf's shadow follows the torn edge), a double ink rule inside it with a red point at each corner, and
 * a rubricated first letter on its heading. What you write goes on ruled lines in the Book's hand, buttons are inked
 * by hand, and the one that matters is pressed in red wax. The fonts and paper are tome.css's.
 */
export const SKIN = {
  theme: {
    "--ui-bg": "var(--paper)", "--ui-ink": "var(--ink-b)", "--ui-dim": "var(--ink-faded)", "--ui-line": "var(--ink-faded)", "--ui-soft": "var(--paper-hi)",
    "--ui-accent": "var(--blood)", "--ui-accent-soft": "var(--paper-lo)", "--ui-on-accent": "var(--paper-hi)", "--ui-scrim": "#1a0e0699",
    "--ui-radius": "3px", "--ui-radius-sm": "3px", "--ui-border": "1.5px",
    "--ui-font": "var(--f-book)", "--ui-font-head": "var(--f-title)", "--ui-shadow": "0 16px 32px -14px rgba(40, 20, 6, 0.75)",
    "--ui-top": "52px", // under the cog and the field chart, top right
  },
  css: `
:where(${LEAF}){position:relative}
${LEAF}{isolation:isolate;border-color:transparent;background:none;box-shadow:none;padding:17px 19px;filter:drop-shadow(0 1px 0 #2814068c) drop-shadow(0 12px 12px #28140673)}
${leaf("::before")}{content:"";position:absolute;inset:0;z-index:-1;background:var(--wear),var(--grain),linear-gradient(170deg,var(--paper-hi),var(--paper) 45%,var(--paper-lo));-webkit-mask:${DECKLE};mask:${DECKLE}}
${leaf("::after")}{content:"";position:absolute;inset:8px;z-index:-1;pointer-events:none;border:3px double var(--ink-line);border-radius:2px;background:radial-gradient(circle,var(--blood) 0 2.4px,transparent 3px) left -7px top -7px/11px 11px no-repeat,radial-gradient(circle,var(--blood) 0 2.4px,transparent 3px) right -7px top -7px/11px 11px no-repeat,radial-gradient(circle,var(--blood) 0 2.4px,transparent 3px) left -7px bottom -7px/11px 11px no-repeat,radial-gradient(circle,var(--blood) 0 2.4px,transparent 3px) right -7px bottom -7px/11px 11px no-repeat}
.eq-toast{padding:15px 22px 15px 18px}.eq-chip.in{padding:9px 11px 9px 12px}.rb-report>.eq-btn{padding:6px 14px;min-height:44px}.eq-chip.in::after,.rb-report>.eq-btn::after{inset:4px;border-style:solid;border-width:1px;background:none}
.eq-title::first-letter,.eq-toast div>b::first-letter,.rb-spaces h2::first-letter,.rb-lobby-who::first-letter,.eq-coach b::first-letter{color:var(--blood);font-family:var(--f-title);font-size:1.5em;line-height:.8}
.eq-head,.rb-spaces-head{padding-bottom:7px;background:linear-gradient(90deg,transparent,var(--ink-faded) 10%,var(--ink-faded) 90%,transparent) bottom/100% 1px no-repeat}
.eq-who{font-family:var(--f-hand);font-size:20px;font-weight:400}
.eq-chip.in .eq-who::before{content:"";display:inline-block;width:15px;height:15px;margin:0 6px 0 2px;vertical-align:-1px;border-radius:47% 53% 50% 46%;background:radial-gradient(circle at 50% 50%,transparent 3px,#00000038 3.5px,transparent 4.5px),radial-gradient(circle at 34% 30%,#d4574c,var(--blood) 55%,#3e0b08);box-shadow:0 1px 1px #2814064d}.eq-title,.eq-toast b{font-weight:600;font-size:19px}
.eq-toast span{font-family:var(--f-hand);font-size:17px;opacity:1;color:var(--ink-faded)}.eq-toast small{font-family:var(--f-book);font-style:italic;letter-spacing:.04em;text-transform:none;font-size:13px}
.eq input,.eq select,.eq textarea{border:0;border-bottom:1.5px solid var(--ink-faded);border-radius:0;background:#f1e5c659;font-family:var(--f-hand);font-size:17px;padding:5px 6px 3px}
.eq textarea{border:1px solid var(--ink-line);line-height:26px;background:repeating-linear-gradient(transparent 0 25px,var(--ink-line) 25px 26px) 0 5px,#f1e5c659}
.eq ::placeholder{font-family:var(--f-book);font-style:italic;font-size:15px}
.eq-btn{border:1.5px solid var(--ink-b);border-radius:255px 14px 225px 14px/14px 225px 14px 255px;background:#f1e5c680;box-shadow:1px 2px 0 -.5px var(--ink-line)}
.eq-btn:hover{background:var(--paper-hi)}
.eq-btn.primary,.rb-spaces-tabs .eq-btn.on{border-color:#3e0b08;background:radial-gradient(120% 90% at 30% 20%,#b8433a,var(--blood) 55%,#4a0f0a);color:var(--paper-hi);text-shadow:0 1px 0 #00000066;box-shadow:inset 0 1px 0 #ffffff40,inset 0 -2px 3px #00000059,0 2px 3px #28140666}
.rb-report>.eq-btn{box-shadow:0 6px 12px -6px #281406bf}.rb-report>.eq-btn svg{color:var(--blood)}
.rb-lobby-code{border:0;border-bottom:1.5px solid var(--blood);border-radius:0;background:none;color:var(--blood)}
.eq-coach{top:104px}.eq-coach b{font-size:19px}.eq-coach p{font-family:var(--f-book)}`,
};

const account = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "mm", skin: SKIN });
export const { ready, signIn, signInHere, finishSignIn, login, fresh, signOut, canSignIn, accountChip, reportButton, achieve, achievements, hub } = account;
let partyClient: ReturnType<typeof account.party> | undefined;
/** The page's one party client: eqosys seats a player once per party, so the world's lobby and the Book's readers
 *  (both at `?party=`) listen on one socket, or each knocks the other out. */
export const party = () => (partyClient ??= account.party());
