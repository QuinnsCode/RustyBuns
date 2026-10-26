// The cutscenes themselves, as cue lists (cutscene.ts). Each is in its own frame: the hero stands
// at 0, 0 facing -z, towards the enemy, and the camera starts behind them. To add one, write its
// cues here and put it in CUTSCENES; the battle view plays INTROS before the first shot and the
// sting when a Mossback walks out of the trees.
import type { Faction, SectorKind } from "./contract.ts";
import type { Cue, Cutscene } from "./cutscene.ts";
import SCRIPT from "../../content/cutscenes.json";
import PLACES_SCRIPT from "../../content/places.json";

// The words live in content/ (bun run cms edits them); {detail}, {into} and {ours} take the place's.
const fill = (line: string, p: Place) => line.replace(/\{(\w+)\}/g, (m, k: string) => (k === "detail" || k === "into" || k === "ours" ? p[k] : m));

const BACK = Math.PI; // facing +z: back at the camera, or at the Marines

// Where the intros happen, in their words (and the briefing's): the title over the Marines, what
// they're there for, what the Wooka call theirs, and where they hide.
export interface Place { title: string; detail: string; into: string; ours: string; know: string; lurk: string }
export const PLACES: Record<SectorKind, Place> = PLACES_SCRIPT;

// The Marines' briefing: one knee-high Wooka on a stump. Nobody is worried. They should be.
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

export const introOf = (f: Faction, sector: SectorKind): Cutscene => (f === "marines" ? marinesIntro : wookaIntro)(PLACES[sector]);
export const CUTSCENES: Record<string, Cutscene> = Object.fromEntries((["marines", "wooka"] as const).map((f) => introOf(f, "shield")).map((c) => [c.id, c]));
