// The cutscenes themselves, as cue lists (cutscene.ts). Each is in its own frame: the hero stands
// at 0, 0 facing -z, towards the enemy, and the camera starts behind them. To add one, write its
// cues here and put it in CUTSCENES; the battle view plays INTROS before the first shot and the
// sting when a Mossback walks out of the trees.
import type { Faction, SectorKind } from "./contract.ts";
import type { Cue, Cutscene } from "./cutscene.ts";

const BACK = Math.PI; // facing +z: back at the camera, or at the Marines

// Where the intros happen, in their words (and the briefing's): the title over the Marines, what
// they're there for, what the Wooka call theirs, and where they hide.
export interface Place { title: string; detail: string; into: string; ours: string; know: string; lurk: string }
export const PLACES: Record<SectorKind, Place> = {
  shield: { title: "DOREN, THE FOREST MOON", detail: "Generator detail", into: "our trees", ours: "forest", know: "trees", lurk: "in the ferns" },
  capital: { title: "THE RUINED CAPITAL", detail: "Street sweep", into: "our ruins", ours: "city", know: "streets", lurk: "in the rubble" },
  spaceport: { title: "THE DEEP-SPACE STATION", detail: "Deck watch", into: "our station", ours: "station", know: "decks", lurk: "behind the crates" },
  cannon: { title: "THE CANNON SHORE", detail: "Gun detail", into: "our sands", ours: "shore", know: "dunes", lurk: "in the grass" },
  canyon: { title: "THE DUST SEA", detail: "Desert patrol", into: "our dunes", ours: "desert", know: "rocks", lurk: "in the dunes" },
  jungle: { title: "THE GLOWING JUNGLE", detail: "Shrine detail", into: "our glowing woods", ours: "jungle", know: "trees", lurk: "in the glow" },
};

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
    { at: 0.2, do: "title", text: p.title, sub: `Thunder Marines · 3rd Drop · ${p.detail}`, dur: 3.4 },
    { at: 3.4, do: "caption", who: "Sgt. Moreau", text: "Contact. One hostile. It's... knee-high. Nobody run. It can smell it.", dur: 3 },
    { at: 4.2, do: "say", id: "rook", text: "That's it? THAT ate Second Squad?", dur: 2.4 },
    { at: 5, do: "say", id: "diaz", text: "Sarge, it has a face. A little face.", dur: 1.8 },
    { at: 4.6, do: "camera", from: [1.4, 1.5, -9.5], to: [0.5, 1, -11.2], look: [0, 0.6, -14], dur: 3 },
    { at: 5.6, do: "sound", noise: "chatter", id: "fluff" },
    { at: 5.8, do: "hop", id: "fluff", dur: 0.8, height: 0.3 },
    { at: 6.4, do: "say", id: "hale", text: "Look at its little face. I'm going to pet it.", dur: 2.2 },
    { at: 6.8, do: "say", id: "sarge", text: "Hale. Hale, don't.", dur: 1.4 },
    { at: 7.6, do: "caption", who: "Cpl. Diaz", text: "That's no ordinary Wooka. Look at the nail in the club, man. LOOK AT THE BONES.", dur: 3 },
    { at: 8.2, do: "say", id: "fluff", text: "hoo-ka", dur: 1.4 },
    { at: 8.2, do: "sound", noise: "chatter", id: "fluff" },
    { at: 9.6, do: "camera", from: [-5, 2.6, 6], look: [0, 1, -2], dur: 2.5 },
    { at: 9.8, do: "walk", id: "fluff", x: -1, z: 3, dur: 0.45 },
    { at: 9.9, do: "sound", noise: "squeal", id: "fluff" },
    { at: 10.25, do: "gone", id: "hale" },
    { at: 10.25, do: "sound", noise: "grunt", id: "hale" },
    { at: 10.25, do: "shake", amount: 1.2 },
    { at: 10.4, do: "say", id: "rook", text: "IT GOT HALE", dur: 1.4 },
    { at: 10.5, do: "caption", who: "Sgt. Moreau", text: "Hale. Hale was a good Marine. Hale was also a very small bite.", dur: 2 },
    { at: 10.6, do: "hop", id: "fluff", dur: 1.4, height: 0.5 },
    { at: 11.2, do: "say", id: "diaz", text: "RUN AWAY! RUN AWAY!", dur: 1.6 },
    { at: 11.4, do: "say", id: "sarge", text: "Charge! No! Run! Charge! ...Run!", dur: 1.6 },
    { at: 11.6, do: "camera", from: [0, 4, 8], to: [0, 6, 12], look: [0, 1, -10], lookTo: [0, 2, -24], dur: 3 },
    ...[-9, -5, -1, 3, 7, 11].map((x, i): Cue => ({ at: 12 + i * 0.12, do: "actor", id: `eyes${i}`, as: { wooka: i % 3 ? "fodder" : "chub" }, x, z: -18 - (i % 2) * 3, face: BACK })),
    ...[0, 1, 2, 3, 4, 5].map((i): Cue => ({ at: 12.6 + i * 0.1, do: "hop", id: `eyes${i}`, dur: 1.6, height: 0.4 })),
    { at: 12.4, do: "sound", noise: "howl" },
    { at: 13.2, do: "sound", noise: "thump" },
    { at: 13.6, do: "caption", who: "Sgt. Moreau", text: "I love the smell of Wooka in the morning. It smells like... we're done.", dur: 2 },
    { at: 12.8, do: "title", text: "THEY ARE NOT CUDDLY", sub: "Hold the line. Surely you can't be serious. We are. Don't call us Shirley.", dur: 2.4 },
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
    { at: 0.3, do: "title", text: "THE KIN OF DOREN", sub: `The armoured ones have come into ${p.into}`, dur: 3.2 },
    { at: 1.2, do: "sound", noise: "drum" },
    { at: 3.6, do: "say", id: "chief", text: "WUBBA HOO! Kakka-takka GRUNNA!", dur: 2.4 },
    { at: 3.6, do: "sound", noise: "howl", id: "chief" },
    { at: 3.8, do: "caption", who: "The chieftain", text: `The shiny ones came to hunt us. Let's show them whose ${p.ours} it is.`, dur: 2.4 },
    { at: 6.2, do: "caption", who: "Subtitles", text: "(He said 'attack'. The rest was feelings.)", dur: 1.8 },
    { at: 4.4, do: "camera", from: [-6, 1.2, -1], to: [-4, 1.4, -3], look: [0, 1.2, -7], dur: 3 },
    ...kin.map((k, i): Cue => ({ at: 5.2 + (i % 4) * 0.1, do: "hop", id: k.id, dur: 2, height: 0.5 + (i % 3) * 0.15 })),
    { at: 5.3, do: "sound", noise: "hoot" },
    { at: 5.6, do: "sound", noise: "thump", id: "chief" },
    { at: 5.6, do: "say", id: "kin1", text: "HOO! HOO! HOO!", dur: 1.6 },
    { at: 6.0, do: "say", id: "kin5", text: "bonk-bonk!", dur: 1.4 },
    { at: 6.3, do: "say", id: "kin3", text: "Is it bonk? Is it bonk now?", dur: 1.4 },
    { at: 6.6, do: "say", id: "kin8", text: "Look at the bones!", dur: 1.2 },
    { at: 7.4, do: "camera", from: [9, 2.5, 4], to: [10, 4, 0], look: [3.5, 1, -2], lookTo: [0, 3, -16], dur: 3.4 },
    { at: 7.6, do: "say", id: "big", text: "WHEEEE-KA!", dur: 1.3 },
    { at: 7.9, do: "toss", id: "big", what: "small", x: -2, z: -17, dur: 1.4, height: 9 },
    { at: 7.9, do: "sound", noise: "whoop", id: "small" },
    { at: 9.3, do: "shake", amount: 0.5 },
    { at: 9.3, do: "sound", noise: "boom" },
    { at: 9.5, do: "hop", id: "small", dur: 1.2, height: 0.7 },
    { at: 9.6, do: "say", id: "small", text: "AGAIN! ...ow. AGAIN!", dur: 1.8 },
    { at: 9.8, do: "caption", who: "", text: "Nobody asked the Chub to do that. Nobody ever does. It is, to be fair, a very good throw.", dur: 3 },
    { at: 11, do: "camera", from: [0, 3, 7], to: [0, 5, 11], look: [0, 1, -9], dur: 2.8 },
    { at: 11.2, do: "sound", noise: "drum" },
    { at: 11.4, do: "title", text: "THE HUNT BEGINS", sub: `Show them the ${p.ours}. Do not feed the Chub.`, dur: 2.4 },
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
    { at: 0.3, do: "title", text: f === "wooka" ? "OUR BIG ONE WALKS" : "MOSSBACK", sub: f === "wooka" ? "Get behind it" : "Rifles barely mark it. Rockets. Strikes. Anything heavy.", dur: 2.4 },
  ],
  end: 2.8,
});

export const introOf = (f: Faction, sector: SectorKind): Cutscene => (f === "marines" ? marinesIntro : wookaIntro)(PLACES[sector]);
export const CUTSCENES: Record<string, Cutscene> = Object.fromEntries((["marines", "wooka"] as const).map((f) => introOf(f, "shield")).map((c) => [c.id, c]));
