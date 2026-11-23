// Desert Gathering: a clearing in the remote Mojave, a long way past the end of the road, under a full moon. Joshua
// trees, creosote and granite boulders stand round it and the ranges close the horizon. The booth is as little as it
// can be, right on the sand: the decks on a board over three weighted sawhorses, a tapestry over the board and draped
// down to the ground all round the front and the ends, a tall carved lantern pole at each end with its lantern hung out
// over the decks. Behind the DJ, the sound: one tight wall of horn-loaded dance stacks (Sound Guy Simulator's desert
// night, packages/models gear) side by side, every cabinet playing the same mono sum, so the whole floor hears one loud,
// clear point source. No stage, no truss, no lasers: the moon, the lanterns, and everyone carrying a hand lantern of
// their own until they sit down to play. The band round the booth, on the sand too. Open sky and loose sand soak up
// nearly everything, so only a short, dry tail comes back off the ground: what you hear is the stacks. Drawn by
// open-air.ts.
import type { StudioDef } from "../room.ts";
import { all, seat } from "./kit.ts";

/** The deck table: 3.2 m of board, so there's 60 cm clear at each end of the players and the mixer. */
const TABLE_W = 3.2;
/** The booth's table's middle: the DJ stands at z = -8.4 facing +z, the table 55 cm in front. */
const TABLE_Z = -7.85;
/** The point source: four stacks shoulder to shoulder (each 1.1 m wide), their fronts in one line 2 m behind the DJ. */
const STACK_W = 1.12;

export const DESERT_GATHERING: StudioDef = {
  id: "desert-gathering", name: "Desert Gathering",
  about: "A clearing in the remote Mojave under a full moon, Joshua trees and boulders round it. A minimal booth on the sand: the decks on a board over sawhorses, a tapestry draped to the ground, a tall lantern either side, and behind it one wall of horn-loaded stacks playing mono as a single point source. Everyone carries a hand lantern. Only the sand throws any sound back, so it's dry and loud.",
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
  // the backline tent off stage right
  gear: { at: [13.5, -10], yaw: -Math.PI / 2 },
  outdoor: {
    stacks: [-1.5, -0.5, 0.5, 1.5].map((k) => ({ at: [k * STACK_W, -11] as [number, number], yaw: 0 })),
    mono: true,
    generator: { at: [-15, -12], yaw: 0.4 },
    // a tall pole at each end of the table, its lantern reaching in over the decks
    lanternPoles: [{ at: [-2.2, TABLE_Z], yaw: Math.PI / 2 }, { at: [2.2, TABLE_Z], yaw: -Math.PI / 2 }],
    // spares on the sand at the booth's front corners, to carry off and set down where you like
    lanterns: [[-1.9, 0, -7.1], [-2.15, 0, -6.8], [1.9, 0, -7.1], [2.15, 0, -6.8]],
    carry: true,
    seed: 4242,
  },
};
