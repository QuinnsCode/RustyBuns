// What you hear by where you stand (#6551). People fade with distance: a guitar or mic heard "now" is placed by
// guitar-line.ts's panner with NEAR, and out on the grounds one heard a loop late (stamped slices, which have no
// panner) is faded here by the same curve. The stage is the one thing you can tune in to: then the set is heard as
// from the floor's middle, at the level it was played, wherever you stand.
import type { ToWorklet } from "../engine/messages.ts";
import { floorMiddle, type Ears, type Speaker } from "./pa-room.ts";

/** A person's fade, as a PannerNode takes it: whole up to 1.5 m, then falling with distance. */
export const NEAR = { distanceModel: "inverse", refDistance: 1.5, rolloffFactor: 0.7 } as const;

/** How loud someone `m` metres off is, 0 to 1: the panner's "inverse" curve with NEAR. */
export const nearGain = (m: number) => NEAR.refDistance / (NEAR.refDistance + NEAR.rolloffFactor * (Math.max(m, NEAR.refDistance) - NEAR.refDistance));

/**
 * A slice of someone's sound on its way to the audio thread, as loud as they are from where you stand. A copy: Rec holds
 * the slice as it was played.
 */
export function fadeSlice(m: ToWorklet, from: readonly [number, number] | undefined, me: { x: number; z: number }): ToWorklet {
  if (m.t !== "sound" || !from) return m;
  const g = nearGain(Math.hypot(from[0] - me.x, from[1] - me.z));
  return g === 1 ? m : { ...m, pcm: m.pcm.map((v) => v * g) };
}

// lucide's radio (ISC)
const RADIO = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>';

/** The tune-in button on the HUD (none in a room with no speakers: its set plays everywhere already). */
export function mountTune(speakers: readonly Speaker[]) {
  const floor = speakers.length ? floorMiddle(speakers) : null;
  let on = false, shown = false;
  const b = document.createElement("button");
  b.id = "tune-in"; b.type = "button"; b.className = "hud-symbol"; b.innerHTML = RADIO; b.hidden = true;
  const draw = () => {
    const words = on ? "Tuned in to the stage: back to hearing it from where you stand" : "Tune in to the stage";
    b.title = words; b.setAttribute("aria-label", words); b.setAttribute("aria-pressed", String(on));
    b.hidden = !shown || !floor;
  };
  const set = (to = !on) => { on = !!floor && to; draw(); return on; };
  b.addEventListener("click", () => { set(); b.blur(); });
  draw();
  document.body.append(b);
  return {
    /** Where the stage is heard from: your own ears, or the floor's middle while tuned in. */
    ears: (me: Ears): Ears => (on && floor ? floor : { x: me.x, z: me.z, yaw: me.yaw }),
    set,
    on: () => on,
    show: (to: boolean) => { shown = to; draw(); },
  };
}
