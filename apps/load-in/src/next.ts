// The first minute: what to do next, in a few words, and the piece of gear it is about (the page floats a marker
// over it). Read from the level as it stands, so it moves on by itself as you work: bring in what's outside, run a
// cable, switch the speaker on. Null once there's nothing obvious left, and the venue's own card takes over. A list of
// steps on @rustybuns/gear's checker, the one Qollab Studio's setup lessons use.
import { gear, nextOf, type Step } from "@rustybuns/gear";
import { heldItem, type Item, type World } from "./sim.ts";
import { inHand, type Cables } from "./cables/cables.ts";
import { hasSwitch, type Switches } from "./audio/hear.ts";
import { strikeState, striking } from "./strike.ts";

export type Next = { text: string; key?: string };

/** What the crew calls a piece, the same on the Next line, the arrow and its stencil: the case with the cables is the
 * "cable case" (stencil CABLES), any other road case the "backline case" (stencil BACKLINE), the rest by catalog name. */
export function callName(w: World, c: Cables, key: string): string {
  const i = w.items.find((x) => x.key === key);
  if (!i) return "";
  if (i.gear === "road-case-m") return key === c.caseKey ? "cable case" : "backline case";
  return gear(i.gear).what;
}

/** Started: something in your hands, a piece moved from where the level left it, or a cable plugged in. Till then the
 * screen shows only the Next line. (The cords coiled by the door at the start are not a start.) */
export function begun(w: World, c: Cables): boolean {
  return !!w.held || !!inHand(c) || c.runs.some((r) => "plug" in r.a || "plug" in r.b) || w.items.some((i) => { const s = w.level.items.find((k) => k.key === i.key); return !s || Math.hypot(i.x - s.x, i.z - s.z) > 0.3; });
}

type At = { w: World; c: Cables; on: Switches };

const outside = (w: World, z: number) => !w.level.outdoor && z > w.level.room.z1;
const outdoors = ({ w }: At) => w.items.find((i) => outside(w, i.z));
// A passive box has no switch of its own: once a cable is in it, the amp feeding it decides.
const switchedOff = ({ w, c, on }: At) => {
  const cabled = new Set(c.runs.flatMap((r) => [r.a, r.b].flatMap((e) => ("plug" in e ? [e.plug[0]] : []))));
  return w.items.find((i) => hasSwitch(i.gear) && !on.has(i.key) && !(cabled.has(i.key) && gear(i.gear).speaker?.ohms));
};

// Speakers go up first where the level has stands for them: a top (a box that plays highs, not a sub) not yet on one,
// while a stand stands empty. The nearest to you, so the first view's own speakers are the first job.
const isTop = (i: Item) => !i.hung && (gear(i.gear).speaker?.highCut ?? 0) > 500;
const stands = (w: World) => w.items.filter((i) => i.gear === "stand-tripod" && i.key !== w.held?.key);
const over = (s: Item, i: Item) => s !== i && i.y > 0.9 && Math.hypot(s.x - i.x, s.z - i.z) < 0.45;
const nearest = (w: World, list: Item[]) => list.sort((a, b) => Math.hypot(a.x - w.you.x, a.z - w.you.z) - Math.hypot(b.x - w.you.x, b.z - w.you.z))[0];
const freeStand = (w: World) => nearest(w, stands(w).filter((s) => !w.items.some((i) => isTop(i) && over(s, i))));
const bareTop = ({ w }: At) => freeStand(w) && nearest(w, w.items.filter((i) => isTop(i) && i.key !== w.held?.key && !stands(w).some((s) => over(s, i))));

/** Each step is done while its job doesn't apply: the first one that does is what to do next. */
const FIRST_MINUTE: Step<At>[] = [
  { job: ({ w, c }) => { const h = heldItem(w)!; return outside(w, w.you.z) ? `Carry the ${callName(w, c, h.key)} inside` : isTop(h) && freeStand(w) ? "Set it on the stand: F" : "Set it down where it goes: F"; }, done: ({ w }) => !heldItem(w), key: ({ w }) => { const h = heldItem(w); return h && isTop(h) && !outside(w, w.you.z) ? freeStand(w)?.key : undefined; } },
  { job: "Plug it in: look at a jack and press F", done: ({ c }) => !inHand(c) },
  { job: (s) => `Bring the ${callName(s.w, s.c, outdoors(s)!.key)} in`, done: (s) => !outdoors(s), key: (s) => outdoors(s)?.key },
  { job: "Put a speaker on a stand: F to lift it", done: (s) => !bareTop(s), key: (s) => bareTop(s)?.key },
  { job: "Take a cable from the cable case: F", done: ({ c }) => !c.caseKey || c.runs.some((r) => "plug" in r.a || "plug" in r.b), key: ({ c }) => c.caseKey ?? undefined },
  { job: (s) => `Switch on the ${callName(s.w, s.c, switchedOff(s)!.key)}: look at it, press P`, done: (s) => !switchedOff(s), key: (s) => switchedOff(s)?.key },
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
