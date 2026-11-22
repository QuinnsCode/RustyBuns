// The desert rave: out past the end of the road under a full moon, a stage of plywood on the sand, the DJ booth in the
// middle of it and the band round it, a wall of horn-loaded dance stacks either side (Sound Guy Simulator's desert
// night, packages/models gear), a lighting truss behind with moving heads and lasers, a string of bulbs round the
// dance floor and cactus out in the dark. Open sky and loose sand soak up nearly everything, so only a short, dry tail
// comes back off the ground: what you hear is the stacks, not walls. Drawn by open-air.ts.
import type { StudioDef } from "../room.ts";
import { all, seat } from "./kit.ts";

/** The stage: a riser 14 m across and 5 m deep, 80 cm up, its front edge at z = -6.5. */
const STAGE = { x: 0, z: -9, w: 14, d: 5, h: 0.8 };

export const DESERT_RAVE: StudioDef = {
  id: "desert-rave", name: "The desert rave",
  about: "A night party out on the sand under a full moon: the DJ booth on a plywood stage between two walls of horn-loaded dance stacks, the band round it, lasers and moving lights off the truss behind, bulbs strung round the dance floor. Only the sand throws any sound back, so it's dry and loud.",
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
    seat("vocal", "booth", [2.4, -7.6], Math.PI, "the mic"),
    // hay bales at the floor's back corners, to sit out a track
    seat("chill-left", "couch", [-11, 8], Math.PI * 0.75, "the bales"),
    seat("chill-right", "couch", [11, 8], -Math.PI * 0.75, "the bales"),
  ].map((s) => s.kind === "couch" ? { ...s, thing: { ...s.thing, color: "#c9a55a" } } : s),
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
    festoon: [-12, -4, 12, 12],
    seed: 4242,
  },
};
