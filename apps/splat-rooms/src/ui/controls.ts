// The cog in the corner: look speeds, invert Y and the key list, shared by every screen and read by the game view.
import { DEFAULTS, mountControls } from "@rustybuns/game-controls";
import { SKIN } from "./eqosys.ts";

/** The Controls sheet as the gadget watch's settings face: glass card, glowing edge, the trim along its top. */
const LAB_CSS = `.ui-house .gc-card{box-shadow:var(--glow),0 30px 80px -30px #000;border-top:3px solid var(--red);backdrop-filter:blur(8px)}
.gc-head h2{font:600 1.5rem/1 var(--silk);letter-spacing:.06em;text-transform:uppercase}
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
