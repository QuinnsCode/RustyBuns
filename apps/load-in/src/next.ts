// The first minute: what to do next, in a few words, and the piece of gear it is about (the page floats a marker
// over it). Read from the level as it stands, so it moves on by itself as you work: bring in what's outside, run a
// cable, switch the speaker on. Null once there's nothing obvious left, and the venue's own card takes over. A list of
// steps on @rustybuns/gear's checker, the one Qollab Studio's setup lessons use.
import { gear, nextOf, type Step } from "@rustybuns/gear";
import { heldItem, type World } from "./sim.ts";
import { inHand, type Cables } from "./cables/cables.ts";
import { hasSwitch, type Switches } from "./audio/hear.ts";
import { strikeState, striking } from "./strike.ts";

export type Next = { text: string; key?: string };

type At = { w: World; c: Cables; on: Switches };

const outside = (w: World, z: number) => !w.level.outdoor && z > w.level.room.z1;
const outdoors = ({ w }: At) => w.items.find((i) => outside(w, i.z));
// A passive box has no switch of its own: once a cable is in it, the amp feeding it decides.
const switchedOff = ({ w, c, on }: At) => {
  const cabled = new Set(c.runs.flatMap((r) => [r.a, r.b].flatMap((e) => ("plug" in e ? [e.plug[0]] : []))));
  return w.items.find((i) => hasSwitch(i.gear) && !on.has(i.key) && !(cabled.has(i.key) && gear(i.gear).speaker?.ohms));
};

/** Each step is done while its job doesn't apply: the first one that does is what to do next. */
const FIRST_MINUTE: Step<At>[] = [
  { job: ({ w }) => { const h = heldItem(w)!; return outside(w, w.you.z) ? `Carry the ${gear(h.gear).what} inside` : "Set it down where it goes: F"; }, done: ({ w }) => !heldItem(w) },
  { job: "Plug it in: look at a jack and press F", done: ({ c }) => !inHand(c) },
  { job: (s) => `Bring the ${gear(outdoors(s)!.gear).what} in`, done: (s) => !outdoors(s), key: (s) => outdoors(s)?.key },
  { job: "Take a cable from the road case: F", done: ({ c }) => !c.caseKey || c.runs.some((r) => "plug" in r.a || "plug" in r.b), key: ({ c }) => c.caseKey ?? undefined },
  { job: (s) => `Switch on the ${gear(switchedOff(s)!.gear).what}: look at it, press P`, done: (s) => !switchedOff(s), key: (s) => switchedOff(s)?.key },
];

export function nextStep(w: World, c: Cables, on: Switches): Next | null {
  const n = nextOf(FIRST_MINUTE, { w, c, on });
  return n && { text: n.job, ...(n.key ? { key: n.key } : {}) };
}
/** The centre prompt when your hands are free and you look at nothing. While there's setting up left it says nothing (the
 * Next line has it); L strike only once the show is over (the doors opened, or, where there are no doors, nothing left to
 * set up), then T to shut the truck, then nothing. */
export function idlePrompt(w: World, c: Cables, on: Switches, show: { doors: boolean; open: boolean }): string {
  if (!w.level.truck) return "";
  if (striking(w)) return strikeState(w, c)?.tally ? "" : "T shut the truck";
  return (show.doors ? show.open : !nextStep(w, c, on)) ? "L strike and load out" : "";
}
