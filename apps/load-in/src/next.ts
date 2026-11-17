// The first minute: what to do next, in a few words, and the piece of gear it is about (the page floats a marker
// over it). Read from the level as it stands, so it moves on by itself as you work: bring in what's outside, run a
// cable, switch the speaker on. Null once there's nothing obvious left, and the venue's own card takes over.
import { gear } from "@rustybuns/gear";
import { heldItem, type World } from "./sim.ts";
import { inHand, type Cables } from "./cables/cables.ts";
import { hasSwitch, type Switches } from "./audio/hear.ts";

export type Next = { text: string; key?: string };

const outside = (w: World, z: number) => !w.level.outdoor && z > w.level.room.z1;

export function nextStep(w: World, c: Cables, on: Switches): Next | null {
  const held = heldItem(w);
  if (held) return outside(w, w.you.z) ? { text: `Carry the ${gear(held.gear).what} inside` } : { text: "Set it down where it goes: F" };
  if (inHand(c)) return { text: "Plug it in: look at a jack and press F" };
  const out = w.items.find((i) => outside(w, i.z));
  if (out) return { text: `Bring the ${gear(out.gear).what} in`, key: out.key };
  const plugged = c.runs.some((r) => "plug" in r.a || "plug" in r.b);
  if (!plugged && c.caseKey) return { text: "Take a cable from the road case: F", key: c.caseKey };
  // A passive box has no switch of its own: once a cable is in it, the amp feeding it decides.
  const cabled = new Set(c.runs.flatMap((r) => [r.a, r.b].flatMap((e) => ("plug" in e ? [e.plug[0]] : []))));
  const off = w.items.find((i) => hasSwitch(i.gear) && !on.has(i.key) && !(cabled.has(i.key) && gear(i.gear).speaker?.ohms));
  if (off) return { text: `Switch on the ${gear(off.gear).what}: look at it, press P`, key: off.key };
  return null;
}
