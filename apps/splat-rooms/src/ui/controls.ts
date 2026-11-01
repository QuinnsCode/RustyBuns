// The cog in the corner: look speeds, invert Y and the key list, shared by every screen and read by the game view.
import { DEFAULTS, mountControls } from "@rustybuns/game-controls";

/** The saved look settings; GameView reads this on every drag. */
export const look = { ...DEFAULTS };
const openers = new Set<(open: boolean) => void>();
/** Hear the dialog open or close (the hunt pauses while it is up). */
export const onControlsToggle = (f: (open: boolean) => void) => { openers.add(f); return () => { openers.delete(f); }; };

export function mountCog(parent: HTMLElement) {
  mountControls({
    key: "splat-rooms.controls", parent,
    skin: "house",
    keys: [["Drag", "Look around"], ["Space", "One splat"], ["Shift + Space", "Spray twenty"], ["P", "Pick mode"], ["Esc", "Pause"]],
    onChange: (s) => Object.assign(look, s),
    onToggle: (open) => openers.forEach((f) => f(open)),
  });
}
