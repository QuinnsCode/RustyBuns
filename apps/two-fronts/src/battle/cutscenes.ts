// The cutscenes themselves, as cue lists (cutscene.ts). Each is in its own frame: the hero stands
// at 0, 0 facing -z, towards the enemy, and the camera starts behind them. To add one, write its
// cues here and put it in CUTSCENES; the battle view plays INTROS before the first shot and the
// sting when a Mossback walks out of the trees.
import type { Faction, SectorKind } from "./contract.ts";
import type { Cue, Cutscene } from "./cutscene.ts";
import type { Trooper } from "./sim.ts";
import SCRIPT from "../../content/cutscenes.json";
import PLACES_SCRIPT from "../../content/places.json";
import DIALOG_STORIES from "../../content/dialogStories.json";

// The words live in content/ (bun run cms edits them); {detail}, {into} and {ours} take the place's.
const fill = (line: string, p: Place) => line.replace(/\{(\w+)\}/g, (m, k: string) => (k === "detail" || k === "into" || k === "ours" ? p[k] : m));

const BACK = Math.PI; // facing +z: back at the camera, or at the Thunder Marines

// Where the intros happen, in their words (and the briefing's): the title over the Thunder Marines, what
// they're there for, what the Wooka call theirs, and where they hide.
export interface Place { title: string; detail: string; into: string; ours: string; know: string; lurk: string }
export const PLACES: Record<SectorKind, Place> = PLACES_SCRIPT;

// The Thunder Marines' drop: the saga's title card, a dropship that is mostly flying, and two
// supply crates kicked out of it. One chute opens. The other crate had the snacks. It plays
// turned round: the squad looks back up at open sky, away from whatever they are here to hold,
// and the crates come down behind them where the hero's own ground is clear.
const marinesDrop = (p: Place): Cutscene => ({
  id: "marines-drop",
  faction: "marines",
  cues: [
    { at: 0, do: "actor", id: "sarge", as: { marine: "assault" }, x: 0, z: 0, face: BACK },
    { at: 0, do: "actor", id: "rook", as: { marine: "sniper" }, x: -2.6, z: -1.4, face: BACK },
    { at: 0, do: "actor", id: "diaz", as: { marine: "heavy" }, x: 2.8, z: -1.8, face: BACK },
    { at: 0, do: "actor", id: "ship", as: { prop: "dropship" }, x: -12, y: 26, z: 52 },
    { at: 0, do: "camera", from: [-4, 1.0, -6], to: [-3, 1.2, -5], look: [0, 14, 40], lookTo: [0, 12, 8], dur: 6 },
    { at: 0, do: "sound", noise: "rotor" },
    { at: 0, do: "fly", id: "ship", x: 0, y: 16, z: 6, dur: 6.2, wobble: 0.6 },
    { at: 0.3, do: "title", text: SCRIPT.drop.title, sub: fill(SCRIPT.drop.titleSub, p), dur: 3.2 },
    { at: 2.4, do: "sound", noise: "rotor" },
    { at: 2.6, do: "caption", who: SCRIPT.drop.whoPilot, text: SCRIPT.drop.pilotFlying, dur: 2.6 },
    { at: 3.4, do: "say", id: "sarge", text: SCRIPT.drop.sargeBoth, dur: 1.8 },
    { at: 4.4, do: "say", id: "diaz", text: SCRIPT.drop.diazPacked, dur: 1.6 },
    { at: 5.2, do: "say", id: "rook", text: SCRIPT.drop.rookHale, dur: 1.6 },
    { at: 4.8, do: "sound", noise: "rotor" },
    // Crates away. The ship carries on over the camera, still rattling.
    { at: 6.2, do: "actor", id: "crateA", as: { prop: "crate" }, x: -1.4, y: 15, z: 6, face: 0.4 },
    { at: 6.2, do: "actor", id: "crateB", as: { prop: "crate" }, x: 1.4, y: 15, z: 6, face: -0.3 },
    { at: 6.2, do: "fly", id: "ship", x: 9, y: 22, z: -44, dur: 5.5, wobble: 0.8 },
    { at: 6.2, do: "drop", id: "crateA", dur: 5.4, height: 15, x: -4.5, z: 5, chute: 0.9 },
    { at: 6.2, do: "drop", id: "crateB", dur: 1.6, height: 15, x: 3.6, z: 4.5 },
    { at: 6.2, do: "camera", from: [-8, 2.4, -2], to: [-7, 2, -1], look: [0, 13, 6], lookTo: [0, 1, 4.5], dur: 5.8 },
    { at: 6.5, do: "say", id: "diaz", text: SCRIPT.drop.diazChute, dur: 1.1 },
    { at: 7.1, do: "sound", noise: "warn" },
    { at: 7.2, do: "say", id: "rook", text: SCRIPT.drop.rookChute, dur: 1.0 },
    { at: 7.7, do: "sound", noise: "boom" },
    { at: 7.7, do: "shake", amount: 1.4 },
    { at: 8.0, do: "caption", who: SCRIPT.drop.whoDiaz, text: SCRIPT.drop.diazSnacks, dur: 2.2 },
    { at: 8.6, do: "say", id: "sarge", text: SCRIPT.drop.sargeHalesChute, dur: 1.6 },
    { at: 9.4, do: "say", id: "diaz", text: SCRIPT.drop.diazHale, dur: 1.4 },
    { at: 10.3, do: "caption", who: SCRIPT.drop.whoPilot, text: SCRIPT.drop.pilotOneChute, dur: 2.6 },
    { at: 11.6, do: "sound", noise: "thump" },
    { at: 11.6, do: "shake", amount: 0.3 },
    { at: 11.8, do: "say", id: "rook", text: SCRIPT.drop.rookFine, dur: 1.4 },
    { at: 12.2, do: "camera", from: [1, 3, -8], to: [0, 4.5, -11], look: [0, 1, 3], dur: 2.8 },
    { at: 12.4, do: "title", text: SCRIPT.drop.titleEnd, sub: SCRIPT.drop.titleEndSub, dur: 2.4 },
  ],
  end: 15,
});

// The Thunder Marines' briefing: one knee-high Wooka on a stump. Nobody is worried. They should be.
const marinesIntro = (p: Place): Cutscene => ({
  id: "marines-intro",
  faction: "marines",
  cues: [
    { at: 0, do: "actor", id: "sarge", as: { marine: "assault" }, x: 0, z: 0 },
    { at: 0, do: "actor", id: "rook", as: { marine: "sniper" }, x: -2.6, z: 1.4 },
    { at: 0, do: "actor", id: "diaz", as: { marine: "heavy" }, x: 2.8, z: 1.8 },
    { at: 0, do: "actor", id: "hale", as: { marine: "engineer" }, x: -1, z: 3.4 },
    { at: 0, do: "actor", id: "fluff", as: { wooka: "fodder" }, x: 0, z: -14, face: BACK },
    { at: 0, do: "camera", from: [6, 3, 9], to: [3, 2.2, 6], look: [0, 1.2, -6], lookTo: [0, 1, -10], dur: 4 },
    { at: 0.2, do: "title", text: p.title, sub: fill(SCRIPT.marines.titleSub, p), dur: 3.4 },
    { at: 3.4, do: "caption", who: SCRIPT.marines.whoMoreau, text: SCRIPT.marines.moreauContact, dur: 3 },
    { at: 4.2, do: "say", id: "rook", text: SCRIPT.marines.rookThat, dur: 2.4 },
    { at: 5, do: "say", id: "diaz", text: SCRIPT.marines.diazFace, dur: 1.8 },
    { at: 4.6, do: "camera", from: [1.4, 1.5, -9.5], to: [0.5, 1, -11.2], look: [0, 0.6, -14], dur: 3 },
    { at: 5.6, do: "sound", noise: "chatter", id: "fluff" },
    { at: 5.8, do: "hop", id: "fluff", dur: 0.8, height: 0.3 },
    { at: 6.4, do: "say", id: "hale", text: SCRIPT.marines.haleLittleFace, dur: 2.2 },
    { at: 6.8, do: "say", id: "sarge", text: SCRIPT.marines.sargeHale, dur: 1.4 },
    { at: 7.6, do: "caption", who: SCRIPT.marines.whoDiaz, text: SCRIPT.marines.diazBones, dur: 3 },
    { at: 8.2, do: "say", id: "fluff", text: SCRIPT.marines.fluffHooka, dur: 1.4 },
    { at: 8.2, do: "sound", noise: "chatter", id: "fluff" },
    { at: 9.6, do: "camera", from: [-5, 2.6, 6], look: [0, 1, -2], dur: 2.5 },
    { at: 9.8, do: "walk", id: "fluff", x: -1, z: 3, dur: 0.45 },
    { at: 9.9, do: "sound", noise: "squeal", id: "fluff" },
    { at: 10.25, do: "gone", id: "hale" },
    { at: 10.25, do: "sound", noise: "grunt", id: "hale" },
    { at: 10.25, do: "shake", amount: 1.2 },
    { at: 10.4, do: "say", id: "rook", text: SCRIPT.marines.rookGotHale, dur: 1.4 },
    { at: 10.5, do: "caption", who: SCRIPT.marines.whoMoreau, text: SCRIPT.marines.moreauHale, dur: 2 },
    { at: 10.6, do: "hop", id: "fluff", dur: 1.4, height: 0.5 },
    { at: 11.2, do: "say", id: "diaz", text: SCRIPT.marines.diazRun, dur: 1.6 },
    { at: 11.4, do: "say", id: "sarge", text: SCRIPT.marines.sargeCharge, dur: 1.6 },
    { at: 11.6, do: "camera", from: [0, 4, 8], to: [0, 6, 12], look: [0, 1, -10], lookTo: [0, 2, -24], dur: 3 },
    ...[-9, -5, -1, 3, 7, 11].map((x, i): Cue => ({ at: 12 + i * 0.12, do: "actor", id: `eyes${i}`, as: { wooka: i % 3 ? "fodder" : "chub" }, x, z: -18 - (i % 2) * 3, face: BACK })),
    ...[0, 1, 2, 3, 4, 5].map((i): Cue => ({ at: 12.6 + i * 0.1, do: "hop", id: `eyes${i}`, dur: 1.6, height: 0.4 })),
    { at: 12.4, do: "sound", noise: "howl" },
    { at: 13.2, do: "sound", noise: "thump" },
    { at: 13.6, do: "caption", who: SCRIPT.marines.whoMoreau, text: SCRIPT.marines.moreauSmell, dur: 2 },
    { at: 12.8, do: "title", text: SCRIPT.marines.titleEnd, sub: SCRIPT.marines.titleEndSub, dur: 2.4 },
  ],
  end: 15.6,
});

// The horde's war-council: the chieftain yells, the kin go wild, and a Chub throws a little one
// fifteen metres for the joy of it.
const kin = [-6, -4, -2, 2, 4, 6, -5, -1, 1, 5].map((x, i) => ({ id: `kin${i}`, x, z: -5 - (i > 5 ? 2.5 : 0) + Math.abs(x) * 0.25 }));
const wookaIntro = (p: Place): Cutscene => ({
  id: "wooka-intro",
  faction: "wooka",
  cues: [
    { at: 0, do: "actor", id: "chief", as: { wooka: "chub" }, x: 0, z: -9, face: BACK, scale: 1.25 },
    ...kin.map((k, i): Cue => ({ at: 0, do: "actor", id: k.id, as: { wooka: i === 2 ? "shanti" : i === 7 ? "boomie" : "fodder" }, x: k.x, z: k.z })),
    { at: 0, do: "actor", id: "big", as: { wooka: "chub" }, x: 4.5, z: -2.5 },
    { at: 0, do: "actor", id: "small", as: { wooka: "fodder" }, x: 3.6, z: -2 },
    { at: 0, do: "camera", from: [0, 2.2, 6], to: [0, 1.8, 3], look: [0, 1.4, -9], dur: 4.5 },
    { at: 0, do: "sound", noise: "drum" },
    { at: 0.3, do: "title", text: SCRIPT.wooka.titleKinHeading, sub: fill(SCRIPT.wooka.titleKin, p), dur: 3.2 },
    { at: 1.2, do: "sound", noise: "drum" },
    { at: 3.6, do: "say", id: "chief", text: SCRIPT.wooka.chiefYell, dur: 2.4 },
    { at: 3.6, do: "sound", noise: "howl", id: "chief" },
    { at: 3.8, do: "caption", who: SCRIPT.wooka.whoChief, text: fill(SCRIPT.wooka.chiefCaption, p), dur: 2.4 },
    { at: 6.2, do: "caption", who: SCRIPT.wooka.whoSubtitles, text: SCRIPT.wooka.subtitles, dur: 1.8 },
    { at: 4.4, do: "camera", from: [-6, 1.2, -1], to: [-4, 1.4, -3], look: [0, 1.2, -7], dur: 3 },
    ...kin.map((k, i): Cue => ({ at: 5.2 + (i % 4) * 0.1, do: "hop", id: k.id, dur: 2, height: 0.5 + (i % 3) * 0.15 })),
    { at: 5.3, do: "sound", noise: "hoot" },
    { at: 5.6, do: "sound", noise: "thump", id: "chief" },
    { at: 5.6, do: "say", id: "kin1", text: SCRIPT.wooka.kin1, dur: 1.6 },
    { at: 6.0, do: "say", id: "kin5", text: SCRIPT.wooka.kin5, dur: 1.4 },
    { at: 6.3, do: "say", id: "kin3", text: SCRIPT.wooka.kin3, dur: 1.4 },
    { at: 6.6, do: "say", id: "kin8", text: SCRIPT.wooka.kin8, dur: 1.2 },
    { at: 7.4, do: "camera", from: [9, 2.5, 4], to: [10, 4, 0], look: [3.5, 1, -2], lookTo: [0, 3, -16], dur: 3.4 },
    { at: 7.6, do: "say", id: "big", text: SCRIPT.wooka.bigWheee, dur: 1.3 },
    { at: 7.9, do: "toss", id: "big", what: "small", x: -2, z: -17, dur: 1.4, height: 9 },
    { at: 7.9, do: "sound", noise: "whoop", id: "small" },
    { at: 9.3, do: "shake", amount: 0.5 },
    { at: 9.3, do: "sound", noise: "boom" },
    { at: 9.5, do: "hop", id: "small", dur: 1.2, height: 0.7 },
    { at: 9.6, do: "say", id: "small", text: SCRIPT.wooka.smallAgain, dur: 1.8 },
    { at: 9.8, do: "caption", who: "", text: SCRIPT.wooka.narrator, dur: 3 },
    { at: 11, do: "camera", from: [0, 3, 7], to: [0, 5, 11], look: [0, 1, -9], dur: 2.8 },
    { at: 11.2, do: "sound", noise: "drum" },
    { at: 11.4, do: "title", text: SCRIPT.wooka.titleHunt, sub: fill(SCRIPT.wooka.titleHuntSub, p), dur: 2.4 },
  ],
  end: 14.2,
});

// A Mossback walks out of the trees: the camera goes to it, low, and the lettering says what to do.
export const mossbackSting = (f: Faction): Cutscene => ({
  id: `mossback-${f}`,
  faction: f,
  cues: [
    { at: 0, do: "camera", from: [3, 1.2, -9], to: [1.5, 1.6, -6], look: [0, 3, 0], dur: 2.6 },
    { at: 0, do: "sound", noise: f === "wooka" ? "drum" : "warn" },
    { at: 0.2, do: "shake", amount: 0.8 },
    { at: 0.3, do: "title", text: f === "wooka" ? SCRIPT.mossback.wookaTitle : SCRIPT.mossback.marinesTitle, sub: f === "wooka" ? SCRIPT.mossback.wookaSub : SCRIPT.mossback.marinesSub, dur: 2.4 },
  ],
  end: 2.8,
});

// The ride down: the Thunder Marines on two benches under the dropship, and whoever is in the seat
// across tells you a story. A bad one, a weird one, a scary one or a revenge one, and every one
// of them is about the Wooka being awful, never about what the Thunder Marines did first. Each
// battle it's the next seat and the next story: the one across walks off down the line at the
// end, and the seat note says who sat there before. A clip runs about as long as its words.
const TROOPERS: readonly Trooper[] = ["assault", "heavy", "sniper", "engineer"];
const RIDE = DIALOG_STORIES.ride;
export const STORIES = Object.entries(DIALOG_STORIES.stories).map(([id, s]) => ({ id, ...s, as: TROOPERS.find((t) => t === s.as) ?? "assault" }));
export type Story = (typeof STORIES)[number];
const KIND_NOISE = { bad: "thump", weird: "chime", scary: "howl", revenge: "warn" } as const;
const kindOf = (k: string) => (k === "bad" || k === "weird" || k === "scary" || k === "revenge" ? k : "bad");
const said = (text: string) => Math.min(3, Math.max(1.5, 0.7 + text.split(/\s+/).length * 0.24)); // seconds to read a bubble
const pick = <T>(list: readonly T[], n: number) => list[((n % list.length) + list.length) % list.length]!;

export function rideDown(story: Story, n: number): Cutscene {
  const L = -Math.PI / 2, R = Math.PI / 2, kind = kindOf(story.kind); // facing +x (our bench) and -x (theirs)
  const cues: Cue[] = [
    { at: 0, do: "actor", id: "ship", as: { prop: "dropship" }, x: 0, y: 4.6, z: 0 },
    { at: 0, do: "actor", id: "left", as: { marine: "heavy" }, x: -1.4, z: -1.3, face: L },
    { at: 0, do: "actor", id: "right", as: { marine: "sniper" }, x: -1.4, z: 1.3, face: L },
    { at: 0, do: "actor", id: "teller", as: { marine: story.as }, x: 1.4, z: 0, face: R },
    { at: 0, do: "actor", id: "acrossA", as: { marine: "engineer" }, x: 1.4, z: -1.3, face: R },
    { at: 0, do: "actor", id: "acrossB", as: { marine: "assault" }, x: 1.4, z: 1.3, face: R },
    { at: 0, do: "sound", noise: "rotor" },
    { at: 0, do: "camera", from: [-3.8, 1.3, 4.2], to: [-3.2, 1.6, 3.4], look: [0.4, 2.2, 0], dur: 2 },
    { at: 0.1, do: "title", text: RIDE.kinds[kind].toUpperCase(), sub: pick(RIDE.seat, n).replace("{who}", story.who), dur: 2 },
    { at: 0.4, do: "caption", who: RIDE.whoPilot, text: pick(RIDE.pilot, n), dur: 1.9 },
  ];
  // The story, over your shoulder from your seat, the camera leaning in as it goes.
  let t = 2.2;
  const start = t;
  story.lines.forEach((line, i) => {
    if (i === story.lines.length - 1) cues.push({ at: t, do: "sound", noise: KIND_NOISE[kind] });
    cues.push({ at: t, do: "say", id: "teller", text: line, dur: said(line) });
    t += said(line) + 0.1;
  });
  cues.push({ at: start, do: "camera", from: [-1.8, 1.55, 0.4], to: [kind === "scary" ? -0.4 : -1, 1.5, 0.15], look: [1.4, 1.5, 0], dur: t - start });
  // The bench answers, from the end of the line; then the last word, and the seat empties.
  cues.push({ at: t, do: "camera", from: [0.4, 1.7, 6], to: [0.2, 1.9, 7.5], look: [0, 1.4, 0], dur: 3.4 });
  cues.push({ at: t, do: "say", id: "right", text: story.back, dur: said(story.back) });
  t += said(story.back) - 0.3;
  cues.push({ at: t, do: "caption", who: "", text: story.tag, dur: 2.4 });
  cues.push({ at: t + 0.3, do: "walk", id: "teller", x: 1.6, z: -10, dur: 2.2 });
  for (let s = 1.2; s < t + 2.4; s += 2.4) cues.push({ at: s, do: "shake", amount: 0.12 });
  cues.push({ at: t + 0.4, do: "sound", noise: "rotor" });
  cues.push({ at: 0, do: "fly", id: "ship", x: 0, y: 4.8, z: 0, dur: t + 2.4, wobble: 0.3 });
  return { id: `ride-${story.id}`, faction: "marines", cues, end: t + 2.4 };
}
// The next ride's story: each battle moves one seat along, so it goes round them all.
export const rideOf = (n: number) => rideDown(pick(STORIES, n), n);

export const introOf = (f: Faction, sector: SectorKind): Cutscene => (f === "marines" ? marinesIntro : wookaIntro)(PLACES[sector]);
// What plays before the briefing: the Thunder Marines drop in; the Wooka are already home.
export const prologueOf = (f: Faction, sector: SectorKind): Cutscene | null => (f === "marines" ? marinesDrop(PLACES[sector]) : null);
export const CUTSCENES: Record<string, Cutscene> = Object.fromEntries([marinesDrop(PLACES.shield), ...(["marines", "wooka"] as const).map((f) => introOf(f, "shield"))].map((c) => [c.id, c]));
