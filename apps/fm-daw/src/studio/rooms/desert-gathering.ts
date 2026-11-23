// Desert Gathering: a clearing in the remote Mojave, a long way past the end of the road, under a full moon. Joshua
// trees, creosote and granite boulders stand round it and the ranges close the horizon. A stage of plywood on the sand,
// and on it the decks: a board on three weighted sawhorses under a tapestry, with room either side of the players for
// whatever people put down. The band round it, a wall of horn-loaded dance stacks either side (Sound Guy Simulator's
// desert night, packages/models gear), a lighting truss behind with moving heads and lasers, and round the dance floor
// hand-carved wooden poles, each with a lantern hung from its crook. Open sky and loose sand soak up nearly
// everything, so only a short, dry tail comes back off the ground: what you hear is the stacks, not walls. Drawn by
// open-air.ts.
import type { StudioDef } from "../room.ts";
import { all, seat } from "./kit.ts";

/** The stage: a riser 14 m across and 5 m deep, 80 cm up, its front edge at z = -6.5. */
const STAGE = { x: 0, z: -9, w: 14, d: 5, h: 0.8 };
/** The deck table: 3.2 m of board, so there's 60 cm clear at each end of the players and the mixer. */
const TABLE_W = 3.2;

export const DESERT_GATHERING: StudioDef = {
  id: "desert-gathering", name: "Desert Gathering",
  about: "A clearing in the remote Mojave under a full moon, Joshua trees and boulders round it: the decks on a board over three weighted sawhorses under a tapestry, between two walls of horn-loaded dance stacks, the band round them, and hand-carved lantern poles round the dance floor. Only the sand throws any sound back, so it's dry and loud.",
  size: { w: 40, d: 40, h: 20 },
  colors: { floor: "#b8946a", walls: "#10142a", ceiling: "#10142a", trim: "#c8a46a" },
  materials: { floor: "sand", ceiling: "sky", walls: all("sky") },
  walls: [],
  spots: [
    // the DJ faces the crowd (+z), the decks between them and the floor
    seat("dj", "dj", [0, -8.4], Math.PI, "the decks"),
    seat("keys", "keys", [-4.4, -8], Math.PI, "the keys"),
    seat("bass", "bass", [4.4, -8], Math.PI, "the bass synth"),
    seat("drums", "drums", [-2.6, -10.4], Math.PI, "the kit"),
    seat("vocal", "booth", [2.7, -7.2], Math.PI, "the mic"),
    // hay bales at the floor's back corners, to sit out a track
    seat("chill-left", "couch", [-11, 8], Math.PI * 0.75, "the bales"),
    seat("chill-right", "couch", [11, 8], -Math.PI * 0.75, "the bales"),
  ].map((s) => s.kind === "couch" ? { ...s, thing: { ...s.thing, color: "#c9a55a" } } : s.kind === "dj" ? { ...s, thing: { ...s.thing, w: TABLE_W } } : s),
  door: { at: [0, 15], yaw: 0 },
  props: [
    { kind: "riser", at: [STAGE.x, STAGE.z], yaw: 0, w: STAGE.w, d: STAGE.d, h: STAGE.h, color: "#6b5a44" },
  ],
  // the backline tent off stage right
  gear: { at: [13.5, -10], yaw: -Math.PI / 2 },
  outdoor: {
    // two stacks each side of the stage, their fronts to the floor, bins lined up so they sum on it
    stacks: [-9.6, -8.4, 8.4, 9.6].map((x) => ({ at: [x, -6] as [number, number], yaw: 0 })),
    truss: { at: [0, -11.8], yaw: 0, w: 14, h: 5.2 },
    generator: { at: [-15, -12], yaw: 0.4 },
    lanternPoles: [-12, -4, 12, 12],
    // six to carry off, three at each end of the deck table (its top 1.75 m up: the stage and the board)
    lanterns: [[-1.5, 1.75, -7.95], [-1.3, 1.75, -7.72], [-1.1, 1.75, -7.98], [1.1, 1.75, -7.98], [1.3, 1.75, -7.72], [1.5, 1.75, -7.95]],
    seed: 4242,
  },
};
