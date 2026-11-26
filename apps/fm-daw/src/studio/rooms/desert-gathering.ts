// Desert Gathering: a clearing in the remote Mojave, a long way past the end of the road, under a full moon. Joshua
// trees, creosote and granite boulders stand round it and the ranges close the horizon. The booth is as little as it
// can be, right on the sand: the decks on a board over three weighted sawhorses, a tapestry over the board and draped
// down to the ground all round the front and the ends, a tall carved lantern pole at each end with its lantern hung out
// over the decks. The sound is laid out the way desert crews stand it: a block of bass bins in the middle behind the DJ,
// and a side of horn-loaded dance stacks (Sound Guy Simulator's desert night, packages/models gear) each side of the
// floor, two columns shoulder to shoulder, their tops fanned out a little and the side toed in so the horns cross on
// the floor. A mid-high horn on a stand at each end of the decks is the DJ's monitor. No stage, no truss, no lasers: the moon, the lanterns, and everyone carrying a hand lantern of
// their own until they sit down to play. The band round the booth, on the sand too. Open sky and loose sand soak up
// nearly everything, so only a short, dry tail comes back off the ground: what you hear is the stacks. Drawn by
// open-air.ts.
import type { StudioDef } from "../room.ts";
import { all, seat } from "./kit.ts";

/** The deck table: 3.2 m of board, so there's 60 cm clear at each end of the players and the mixer. */
const TABLE_W = 3.2;
/** The booth's table's middle: the DJ stands at z = -8.4 facing +z, the table 55 cm in front. */
const TABLE_Z = -7.85;
/** A stack's footprint: the 21" horn bin, 1.686 m wide at its real size (pa-room.ts rigStacks closes each side to the rig's own width). */
const STACK_W = 1.706;
/** Each side's middle, metres out from the DJ, and how far it's turned in toward the floor's middle. The inner
 *  columns stand about 6.85 m out, which is where the toed-in horns cross over the floor 10 to 16 m out. */
const SIDE_X = 7.7, SIDE_Z = -10, TOE = 0.2;
/** How far a side's two tops fan apart from its own aim, each way. */
const SPLAY = 0.12;
/** One side of the floor (-1 left as the DJ sees the crowd from behind, 1 right): two columns along the side's face. */
const side = (k: -1 | 1) => {
  const yaw = -k * TOE, rx = Math.cos(yaw), rz = -Math.sin(yaw);
  return [-1, 1].map((c) => ({ at: [k * SIDE_X + rx * c * STACK_W / 2, SIDE_Z + rz * c * STACK_W / 2] as [number, number], yaw, splay: c * SPLAY }));
};
/** A booth monitor at an end of the decks, aimed at the DJ's head. */
const monitor = (k: -1 | 1) => {
  const at: [number, number] = [k * 2.05, -8.75];
  return { at, yaw: Math.atan2(0 - at[0], -8.4 - at[1]) };
};

export const DESERT_GATHERING: StudioDef = {
  id: "desert-gathering", name: "Desert Gathering",
  about: "A clearing in the remote Mojave under a full moon, Joshua trees and boulders round it. A minimal booth on the sand: the decks on a board over sawhorses, a tapestry draped to the ground, a lantern and a horn monitor either side. Bass bins in the middle, a side of horn stacks each side of the floor. Everyone carries a hand lantern. Only the sand throws sound back: dry and loud.",
  size: { w: 40, d: 40, h: 20 },
  colors: { floor: "#b8946a", walls: "#10142a", ceiling: "#10142a", trim: "#c8a46a" },
  materials: { floor: "sand", ceiling: "sky", walls: all("sky") },
  walls: [],
  spots: [
    // the DJ faces the crowd (+z), the decks between them and the floor
    seat("dj", "dj", [0, -8.4], Math.PI, "the decks"),
    seat("keys", "keys", [-4.4, -7.6], Math.PI, "the keys"),
    seat("bass", "bass", [4.4, -7.6], Math.PI, "the bass synth"),
    seat("drums", "drums", [-4.8, -10.2], Math.PI, "the kit"),
    seat("vocal", "booth", [3.4, -6.2], Math.PI, "the mic"),
    // hay bales at the floor's back corners, to sit out a track
    seat("chill-left", "couch", [-11, 8], Math.PI * 0.75, "the bales"),
    seat("chill-right", "couch", [11, 8], -Math.PI * 0.75, "the bales"),
  ].map((s) => s.kind === "couch" ? { ...s, thing: { ...s.thing, color: "#c9a55a" } } : s.kind === "dj" ? { ...s, thing: { ...s.thing, w: TABLE_W } } : s),
  door: { at: [0, 15], yaw: 0 },
  // out here the bass is the little silver bass-line box on its stand, squelching
  bass: "box",
  // and the keys a string machine, for the long pads
  keys: "strings",
  // the backline tent off stage right
  gear: { at: [13.5, -10], yaw: -Math.PI / 2 },
  outdoor: {
    stacks: [...side(-1), ...side(1)],
    // the bins in the middle: three across and two high, right behind the DJ
    subs: { at: [0, -11], yaw: 0, wide: 3, high: 2 },
    monitors: [monitor(-1), monitor(1)],
    generator: { at: [-15, -12], yaw: 0.4 },
    // a fire pit behind the left bales, out of the floor, where the chill corner gathers
    fire: { at: [-13, 11] },
    // the vans people came in, parked round the back of the floor, one with its awning out over the fire
    // festoon lights over the chill corners: from the vans' roofs out to wooden posts and across to the bales
    festoons: [
      { points: [[-15.4, 2.05, 13.6], [-11.5, 2.6, 13.2], [-9.2, 2.6, 9.6]], posts: [false, true, true] },
      { points: [[14.6, 2.05, 14.3], [11.8, 2.6, 12.4], [9.4, 2.6, 9.4]], posts: [false, true, true] },
    ],
    vans: [{ at: [-16.5, 13], yaw: Math.PI / 2 + 0.25, awning: true }, { at: [15.5, 14.5], yaw: -Math.PI / 2 - 0.3 }, { at: [17, 6], yaw: -Math.PI / 2 + 0.15 }],
    // a tall pole at each end of the table, its lantern reaching in over the decks
    lanternPoles: [{ at: [-2.2, TABLE_Z], yaw: Math.PI / 2 }, { at: [2.2, TABLE_Z], yaw: -Math.PI / 2 }],
    // spares on the sand at the booth's front corners, to carry off and set down where you like
    lanterns: [[-1.9, 0, -7.1], [-2.15, 0, -6.8], [1.9, 0, -7.1], [2.15, 0, -6.8]],
    carry: true,
    // rugs on the sand: a big one where the DJ stands and the sawhorses stand, one under the kit, one at each bale
    rugs: [
      { at: [0, -8.25], yaw: 0, w: 3.6, d: 2.4 },
      { at: [-4.8, -10.1], yaw: 0.12, w: 2.4, d: 1.8 },
      { at: [-11, 7.4], yaw: 0.8, w: 2.6, d: 1.7 },
      { at: [11, 7.4], yaw: -0.8, w: 2.6, d: 1.7 },
    ],
    seed: 4242,
  },
};
