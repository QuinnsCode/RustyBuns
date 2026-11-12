// The cog in the corner: look speeds, invert Y and the key list, shared by every screen and read by the game view.
import { DEFAULTS, mountControls } from "@rustybuns/game-controls";
import { SKIN } from "./eqosys.ts";

/**
 * The Controls sheet as the gadget watch's settings plate: riveted glass with a stamped hairline inside the edge, the
 * red-and-cream hatched trim along its top, a stencilled serial beside the title, and each section an inset panel.
 */
const LAB_CSS = `.ui-house .gc-card{box-shadow:var(--glow),0 30px 80px -30px #000;border-top:0;backdrop-filter:blur(8px);position:relative;padding-top:26px;
background:var(--rivets),var(--wear),var(--panel);outline:1px solid rgb(239 228 201 / .06);outline-offset:-5px}
.ui-house .gc-card::before{content:"";position:absolute;left:0;right:0;top:0;height:7px;
background:linear-gradient(100deg,var(--red) 0 132px,transparent 132px),repeating-linear-gradient(-55deg,rgb(239 228 201 / .45) 0 3px,transparent 3px 8px)}
.gc-head h2{font:600 1.5rem/1 var(--silk);letter-spacing:.06em;text-transform:uppercase}
.gc-head h2::after{content:"SR-CTL · 0417";margin-left:12px;padding:2px 7px;vertical-align:middle;border:1px solid var(--oxide);border-radius:2px;
font:.62rem var(--mono);letter-spacing:.18em;color:var(--cream);background:rgb(0 0 0 / .3)}
.ui-house .gc-sec{background:var(--wear),rgb(0 0 0 / .22);border-color:var(--oxide);box-shadow:inset 0 1px 4px rgb(0 0 0 / .5)}
.gc-cog.ui-house{background:var(--glass);border-color:var(--edge-hi);color:var(--accent);box-shadow:var(--glow)}
.ui-house .gc-tab[aria-selected=true]{box-shadow:var(--glow)}
.ui-house .gc-keys dt{font-family:var(--mono);font-size:.85em;color:var(--accent)}`;

/** The saved look settings; GameView reads this on every drag. */
export const look = { ...DEFAULTS };
const openers = new Set<(open: boolean) => void>();
/** Hear the dialog open or close (the hunt pauses while it is up). */
export const onControlsToggle = (f: (open: boolean) => void) => { openers.add(f); return () => { openers.delete(f); }; };

export function mountCog(parent: HTMLElement) {
  mountControls({
    key: "splat-rooms.controls", parent,
    skin: "house", theme: SKIN.theme, css: LAB_CSS,
    keys: [["Drag", "Look around"], ["Space", "One splat"], ["Shift + Space", "Spray twenty"], ["P", "Pick mode"], ["Esc", "Pause"]],
    onChange: (s) => Object.assign(look, s),
    onToggle: (open) => openers.forEach((f) => f(open)),
  });
}
