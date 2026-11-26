// Q Instruments' lesson (#6172, PATHWAYS.md's LEARN), on /decks.html: mix one track into the next. A track on each
// deck, play A, match B's tempo to A's, start B on A's beat in the headphones, then cross the fader over to B. Every
// step reads the decks' own state (engine.ts's DeckState, mixer.ts's crossfader, curve, assigns, faders and cues), so
// the card can say why when B runs at another tempo, drifts or starts off the beat, or the room heard B start.
// Pure: no DOM, no Web Audio.
import type { Step } from "@rustybuns/gear";
import { faderGain, type Grid } from "./analyze.ts";
import { DECK_CHANNEL, xfGain, type ChannelState, type Curve } from "./mixer.ts";
import type { DeckState } from "./engine.ts";
import type { PageLessonDef } from "../studio/page-lesson.ts";

/** A deck as the lesson reads it: its track, whether it plays, where it is and its tempo now. */
type DeckAt = Pick<DeckState, "name" | "playing" | "pos" | "bpm" | "grid">;
/** The decks now: open or not, each deck, deck B's headphone cue, and how loud each deck is in the room (0 to 1, its
 *  channel fader times its side of the crossfader). */
export type DecksNow = { open: boolean; a: DeckAt; b: DeckAt; cueB: boolean; faderB: number; roomA: number; roomB: number };
/** And how B last started: in the headphones, and whether the room could already hear it. */
export type DecksAt = DecksNow & { bStart: { phones: boolean; floor: boolean } | null };

/** The decks' state as `Decks.state()` gives it, cut to what the lesson reads (null: the decks aren't open yet). */
type DecksState = { decks: DeckAt[]; channels: Pick<ChannelState, "cue" | "fader" | "xf">[]; xfader: number; curve: Curve };

const EMPTY: DeckAt = { name: null, playing: false, pos: 0, bpm: null, grid: null };

export function decksNow(s: DecksState | null): DecksNow {
  if (!s) return { open: false, a: EMPTY, b: EMPTY, cueB: false, faderB: 0, roomA: 0, roomB: 0 };
  const room = (side: 0 | 1) => { const c = s.channels[DECK_CHANNEL[side]]!; return faderGain(c.fader) / faderGain(0.8) * xfGain(c.xf, s.xfader, s.curve); };
  return { open: true, a: s.decks[0] ?? EMPTY, b: s.decks[1] ?? EMPTY, cueB: s.channels[DECK_CHANNEL[1]]!.cue, faderB: s.channels[DECK_CHANNEL[1]]!.fader, roomA: room(0), roomB: room(1) };
}

/** A reader that keeps how B last started (the moment it went from stopped to playing), for the lesson to judge. */
export function watchDecks(): (now: DecksNow) => DecksAt {
  let was = false, bStart: DecksAt["bStart"] = null;
  return (now) => {
    if (now.b.playing && !was) bStart = { phones: now.cueB, floor: now.roomB > HEARD };
    was = now.b.playing;
    return { ...now, bStart };
  };
}

/** A deck is heard in the room above this gain (out of 1), and out front at or above OUT. */
const HEARD = 0.1, OUT = 0.9;
/** Tempos this close (BPM) are matched; beats this close (ms) are in step: under a flam the ear hears as one kick. */
export const SAME_BPM = 0.15, IN_STEP_MS = 25;

const r1 = (n: number) => Math.round(n * 10) / 10;
/** B's tempo against A's: the ratio (1, or 2 and a half for a half-time or double-time track) and how far apart. */
function tempo({ a, b }: DecksAt): { k: number; gap: number } | null {
  if (a.bpm === null || b.bpm === null) return null;
  const k = [1, 2, 0.5].reduce((best, k) => (Math.abs(a.bpm! * k - b.bpm!) < Math.abs(a.bpm! * best - b.bpm!) ? k : best), 1);
  return { k, gap: b.bpm - a.bpm * k };
}
const matched = (s: DecksAt) => { const t = tempo(s); return !!t && Math.abs(t.gap) <= SAME_BPM; };
/** How far B's beat is from A's, in ms (positive: B lands late), the shortest way. */
export function offMs({ a, b }: DecksAt, k = 1): number | null {
  const ga: Grid | null = a.grid, gb: Grid | null = b.grid;
  if (!ga || !gb || !b.bpm) return null;
  let d = ((b.pos - gb.offset) * gb.bpm) / 60 - (((a.pos - ga.offset) * ga.bpm) / 60) * k; // B's beats against A's
  d = -(d - Math.round(d));
  return (d * 60_000) / b.bpm;
}
const inStep = (s: DecksAt) => { const o = offMs(s, tempo(s)?.k ?? 1); return o !== null && Math.abs(o) <= IN_STEP_MS; };
/** B is out front and A is gone from the room: the mix is over. */
const over = (s: DecksAt) => s.b.playing && s.roomB >= OUT && s.roomA < HEARD;
/** With A still playing, B must keep A's tempo and beat; with A stopped, nothing to keep to. */
const together = (s: DecksAt) => !s.a.playing || (matched(s) && inStep(s));

const STEPS: Step<DecksAt>[] = [
  {
    job: "A track on each deck: drop one on, or pick one from the library",
    done: (s) => !!s.a.name && !!s.b.name,
    why: (s) => (!s.open ? "The decks aren't open yet: press Open the decks" : !s.a.name ? "Deck A is empty: put the track the room is dancing to on it" : !s.b.name ? "Deck B is empty: put the next track on it" : null),
  },
  {
    job: "Play deck A: the track the room hears",
    done: (s) => s.a.playing || over(s),
    why: (s) => (s.a.playing && s.roomA < HEARD ? "Deck A plays but the room can't hear it: its channel fader is down or the crossfader is over on B" : null),
  },
  {
    job: "Match B's tempo to A's: its tempo fader, or SYNC",
    done: (s) => matched(s) || (over(s) && !s.a.playing),
    why: (s) => {
      const t = tempo(s);
      if (!t) return s.b.name ? "One deck has no tempo: no steady beat was found in its track. Pick a track with a beat" : null;
      const every = Math.round(60 / Math.abs(t.gap)); // seconds for B to slip one whole beat
      return `B runs at ${r1(s.b.bpm!)} BPM and A at ${r1(s.a.bpm! * t.k)}: B ${t.gap > 0 ? "pulls ahead of" : "falls behind"} A by a whole beat every ${every} s, so two kicks gallop. Move B's tempo fader ${t.gap > 0 ? "down" : "up"} ${r1((Math.abs(t.gap) / s.b.bpm!) * 100)} %, or press SYNC`;
    },
  },
  {
    job: "Start B on A's beat, in the headphones: press B's cue, then play it on a kick",
    done: (s) => (s.b.playing && !!s.bStart && !s.bStart.floor && (s.bStart.phones || s.cueB) && together(s)) || (over(s) && together(s)),
    why: (s) => {
      if (!s.b.playing) return s.roomB >= HEARD ? "The room can hear deck B as it stands: slide the crossfader over to A before you start B" : null;
      if (s.bStart?.floor) return "B started where the room could hear it, so the floor heard you find the beat. Stop B, slide the crossfader over to A, press B's headphone cue and start it again";
      if (!s.bStart?.phones && !s.cueB) return "B is playing but not in your headphones: you can't hear whether it lands on A's beat until the room does. Press B's cue";
      if (!matched(s)) return null; // the tempo step says why
      const o = offMs(s, tempo(s)?.k ?? 1)!;
      return `B's kick lands ${Math.round(Math.abs(o))} ms ${o > 0 ? "after" : "before"} A's: it started off the beat, or drifted. ${o > 0 ? "Push B's jog on" : "Hold B's jog back"} a touch, or press SYNC, until the two kicks are one`;
    },
  },
  {
    job: "Cross the fader over to B",
    done: (s) => over(s) && together(s),
    why: (s) => (s.b.playing && s.faderB < 0.05 ? "B's channel fader is down: the crossfader brings over a deck nobody hears. Push it up" : null),
  },
];

export const MIX_LESSON: PageLessonDef<DecksAt> = {
  id: "mix", title: "Mix one track into the next", blurb: "Both decks loaded, B's tempo matched to A's, B started on the beat in the headphones, then the crossfader across", steps: STEPS,
};
