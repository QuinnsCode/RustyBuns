// The first minute: what to do next, in a few words, and the piece of gear it is about (the page floats a marker
// over it). Read from the level as it stands, so it moves on by itself as you work: bring in what's outside, run a
// cable, switch the speaker on. Null once there's nothing obvious left, and the venue's own card takes over. A list of
// steps on @rustybuns/gear's checker, the one Qollab Studio's setup lessons use.
import { gear, nextOf, type Step } from "@rustybuns/gear";
import { heldItem, type Item, type World } from "./sim.ts";
import { inHand, type Cables } from "./cables/cables.ts";
import { hasSwitch, type Switches } from "./audio/hear.ts";
import { strikeState, striking } from "./strike.ts";

/** `text` the line, `key` the piece it is about (the marker), `to` where that piece goes: the free stand, lit on the
 * floor so the thin tripod reads from the door; `at` a spot on the floor it goes instead (a stand's tape mark). */
export type Next = { text: string; key?: string; to?: string; at?: { x: number; z: number } };

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
// Where the level tapes a spot for a stand, the stand goes there first: the one nearest the door you came in by, not
// nearest you, so the job stays the same stand as you walk until it is on its tape.
const markOf = (w: World, key: string) => w.level.marks?.find((m) => m.key === key);
const offMark = (w: World, i: Item) => { const m = markOf(w, i.key); return !!m && Math.hypot(i.x - m.x, i.z - m.z) > 0.5; };
const fromDoor = (w: World, i: Item) => Math.hypot(i.x - w.level.start.x, i.z - w.level.start.z);
const strayStand = ({ w }: At) => stands(w).filter((s) => offMark(w, s)).sort((a, b) => fromDoor(w, a) - fromDoor(w, b))[0];
/** A top in your hands whose own stand is still off its tape: that stand is the job, so the top waits. */
const ownStray = (w: World, h: Item | null | undefined) => { const s = h && isTop(h) ? stands(w).find((x) => x.key === h.key.replace(/^top-/, "stand-")) : undefined; return s && offMark(w, s) ? s : undefined; };
/** A stand by its key: stand-r -> stand R. */
const standName = (key: string) => key.replace(/^stand-(\w+)$/, (_, s: string) => `stand ${s.toUpperCase()}`);
/** The stand a top goes on: its own (TOP R on stand R) while that one is free, else the nearest free one. */
const standFor = (w: World, top: Item | null | undefined) => { const free = freeStand(w), own = top && stands(w).find((s) => s.key === top.key.replace(/^top-/, "stand-") && !w.items.some((i) => isTop(i) && over(s, i))); return own || free; };
const bareTop = ({ w }: At) => freeStand(w) && nearest(w, w.items.filter((i) => isTop(i) && i.key !== w.held?.key && !stands(w).some((s) => over(s, i))));

/** The crew's tape on a piece: its key in caps (top-l -> TOP L). Cases carry a stencil already and stands have no face.
 *  The Next line names a speaker by it too, so the words on screen are the words on the box. */
export function tapeLabel(key: string, id: string): string | undefined {
  if (id.startsWith("road-case") || id.startsWith("stand") || id === "distro-box") return undefined;
  return key.split("-").join(" ").toUpperCase();
}

/** What the edge arrow calls the piece it points at, and how far it is: a speaker by its tape, the stand you carry a
 *  speaker to as that speaker's ("stand for TOP R, 3 m"), anything else by its name. */
/** The edge arrow's words for a tape mark: the stand in your hands goes there. */
export function towardMark(w: World, at: { x: number; z: number }): string {
  const h = heldItem(w), m = Math.max(1, Math.round(Math.hypot(at.x - w.you.x, at.z - w.you.z)));
  return `tape for ${h ? standName(h.key) : "it"}, ${m} m`;
}

export function towardName(w: World, c: Cables, key: string): string {
  const i = w.items.find((x) => x.key === key), h = heldItem(w);
  if (!i) return "";
  const held = h && tapeLabel(h.key, h.gear), m = Math.max(1, Math.round(Math.hypot(i.x - w.you.x, i.z - w.you.z)));
  const name = tapeLabel(i.key, i.gear) ?? (held && i.gear.startsWith("stand") && !offMark(w, i) ? `stand for ${held}` : markOf(w, key) ? standName(key) : callName(w, c, key));
  return `${name}, ${m} m`;
}

// One thing at a time: first lift the speaker (named by the tape on it), then, in your hands, carry it to the stand.
const grabTop = (s: At) => { const t = bareTop(s)!; return `Grab ${tapeLabel(t.key, t.gear) ?? "the speaker"}: F`; };

/** Each step is done while its job doesn't apply: the first one that does is what to do next. */
const FIRST_MINUTE: Step<At>[] = [
  { job: ({ w, c }) => { const h = heldItem(w)!; return outside(w, w.you.z) ? `Carry the ${callName(w, c, h.key)} inside` : offMark(w, h) ? "Set it on its tape on the stage: F" : ownStray(w, h) ? `Set ${tapeLabel(h.key, h.gear)} down: ${standName(ownStray(w, h)!.key)} goes on its tape first` : isTop(h) && freeStand(w) ? "Carry it to the stand: F sets it on" : "Set it down where it goes: F"; }, done: ({ w }) => !heldItem(w), key: ({ w }) => { const h = heldItem(w); return h && isTop(h) && !outside(w, w.you.z) ? (ownStray(w, h) ?? standFor(w, h))?.key : undefined; } },
  { job: "Plug it in: look at a jack and press F", done: ({ c }) => !inHand(c) },
  { job: (s) => `Bring the ${callName(s.w, s.c, outdoors(s)!.key)} in`, done: (s) => !outdoors(s), key: (s) => outdoors(s)?.key },
  { job: (s) => `Take ${standName(strayStand(s)!.key)} to its tape on the stage: F`, done: (s) => !strayStand(s), key: (s) => strayStand(s)?.key },
  { job: grabTop, done: (s) => !bareTop(s), key: (s) => bareTop(s)?.key },
  { job: "Take a cable from the cable case: F", done: ({ c }) => !c.caseKey || c.runs.some((r) => "plug" in r.a || "plug" in r.b), key: ({ c }) => c.caseKey ?? undefined },
  { job: (s) => `Switch on the ${callName(s.w, s.c, switchedOff(s)!.key)}: look at it, press P`, done: (s) => !switchedOff(s), key: (s) => switchedOff(s)?.key },
];

export function nextStep(w: World, c: Cables, on: Switches): Next | null {
  const at = { w, c, on }, n = nextOf(FIRST_MINUTE, at);
  if (!n) return null;
  const h = heldItem(w), stray = n.key ? ownStray(w, h) ?? strayStand(at) : undefined;
  // A stand off its tape (in your hands, or the one to take) goes to the tape, not onto another stand.
  const going = h && !n.key && offMark(w, h) ? h : stray?.key === n.key ? stray : undefined, mark = going && markOf(w, going.key);
  if (mark) return { text: n.job, ...(n.key ? { key: n.key } : {}), at: { x: mark.x, z: mark.z } };
  const top = bareTop(at), stand = standFor(w, h && isTop(h) ? h : top), to = (top && n.job === grabTop(at)) || (n.key && n.key === stand?.key) ? stand?.key : undefined;
  return { text: n.job, ...(n.key ? { key: n.key } : {}), ...(to ? { to } : {}) };
}
/** The centre prompt when your hands are free and you look at nothing. While there's setting up left it says nothing (the
 * Next line has it); L strike only once the show is over (the doors opened, or, where there are no doors, nothing left to
 * set up), then T to shut the truck, then nothing. */
export function idlePrompt(w: World, c: Cables, on: Switches, show: { doors: boolean; open: boolean }): string {
  if (!w.level.truck) return "";
  if (striking(w)) return strikeState(w, c)?.tally ? "" : "T shut the truck";
  return (show.doors ? show.open : !nextStep(w, c, on)) ? "L strike and load out" : "";
}
