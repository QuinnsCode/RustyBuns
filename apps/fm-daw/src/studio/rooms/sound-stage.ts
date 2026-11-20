// The sound stage: a late-night TV studio. The band plays on a riser at the back right, in front of a painted cyc
// washed blue to magenta; the host's home base sits on its own low riser at the back left, a desk and a guest couch
// before a flat of the city at night. A grid of lights hangs over both, cameras stand on pedestals on the floor, the
// floor mix desk sits behind them and the bleachers rise at the front for the audience. Black drapes on the walls
// and an open ceiling keep the big room dead, so the band sounds close and dry, the way it goes out on air.
import type { StudioDef } from "../room.ts";
import { all, colors, seat } from "./kit.ts";

const OUT = Math.PI;   // facing the bleachers
/** A studio camera on its pedestal at (x, z), its lens aimed at (tx, tz). */
const camera = (at: [number, number], to: [number, number], seed: number) =>
  ({ kind: "camera" as const, at, yaw: Math.atan2(at[0] - to[0], at[1] - to[1]), w: 0.8, d: 0.8, h: 1.45, color: "#6a6e74", seed });

export const SOUND_STAGE: StudioDef = {
  id: "sound-stage", name: "The sound stage",
  about: "A late-night TV studio: the band on a riser in front of a painted cyc, the host's desk and couch on their own low stage before the city at night, a grid of lights overhead, cameras on pedestals and bleachers for the audience. Black drapes and an open ceiling keep the big room dead, so the band sounds close and dry.",
  size: { w: 16.5, d: 14, h: 7 },
  colors: { ...colors("concrete", "curtain", "foam"), floor: "#141416", walls: "#141416", ceiling: "#0e0e10", trim: "#3a3a40" },
  materials: { floor: "concrete", ceiling: "foam", walls: all("curtain") },
  walls: [],
  spots: [
    // the band on its riser, facing out at the bleachers
    seat("drums", "drums", [3, -5.7], OUT),
    seat("keys", "keys", [5.1, -4.4], OUT - 0.3, "the keys", "keys"),
    seat("bass", "bass", [0.9, -4.4], OUT + 0.3),
    seat("vocal", "booth", [3, -3.5], OUT, "the mic"),
    // the guest couch on the home base, turned to the host's desk
    { ...seat("couch", "couch", [-3.2, -4.4], OUT - 0.5, "the guest couch"), thing: { w: 2, d: 0.8, h: 0.45, ahead: -0.15, color: "#4a2030" } },
    // the floor mix desk behind the cameras, looking at the band
    seat("desk", "desk", [-0.5, 1.75], 0, "the floor mix desk"),
  ],
  door: { at: [-7.4, 1.5], yaw: -Math.PI / 2 },
  gear: { at: [-5.25, 5.25], yaw: Math.PI / 2 },
  props: [
    // the band riser and the cyc behind it
    { kind: "riser", at: [3, -4.6], yaw: OUT, w: 6, d: 3.2, h: 0.5, color: "#0c0c0e", seed: 41 },
    { kind: "cyc", at: [3, -6.5], yaw: OUT, w: 8.6, d: 0.85, h: 5.6, color: "#000000" },
    // floor wedges at the riser's front edge, each tilted up at a player
    { kind: "wedge", at: [0.9, -3.3], yaw: -0.3, w: 0.55, d: 0.45, h: 0.32, y: 0.5, color: "#161618" },
    { kind: "wedge", at: [3.6, -3.25], yaw: 0, w: 0.55, d: 0.45, h: 0.32, y: 0.5, color: "#161618" },
    { kind: "wedge", at: [5.1, -3.3], yaw: 0.3, w: 0.55, d: 0.45, h: 0.32, y: 0.5, color: "#161618" },
    { kind: "monitor", at: [0.45, -5.7], yaw: OUT - 0.3, w: 0.6, d: 0.5, h: 1.2, y: 0.5, color: "#1a1a1c" },
    { kind: "cables", at: [3, -4.8], yaw: 0, w: 4.4, d: 1.4, h: 0.01, y: 0.5, color: "#c8502e", seed: 42 },
    // the home base: a low stage, the host's desk, a rug, a plant, and the city at night behind them
    { kind: "riser", at: [-4.6, -4.8], yaw: OUT, w: 5, d: 2.8, h: 0.3, color: "#2a1a14", seed: 43 },
    { kind: "rug", at: [-4.4, -4.6], yaw: 0, w: 3.8, d: 2.2, h: 0.01, y: 0.3, color: "#3a2440" },
    { kind: "hostDesk", at: [-5.3, -4.7], yaw: OUT, w: 1.9, d: 0.75, h: 0.76, y: 0.3, color: "#6a4028", seed: 44 },
    { kind: "flat", at: [-4.6, -6.75], yaw: OUT, w: 5.2, d: 0.3, h: 3.6, color: "#4a3020", seed: 45 },
    { kind: "plant", at: [-6.7, -4.0], yaw: 0, w: 0.6, d: 0.6, h: 1.4, y: 0.3, color: "#2a2a2c", seed: 46 },
    { kind: "lamp", at: [-2.4, -5.6], yaw: 0, w: 0.4, d: 0.4, h: 1.5, y: 0.3, color: "#e8c890" },
    // the lighting grid over both stages
    { kind: "grid", at: [-0.3, -3.6], yaw: 0, w: 15, d: 6, h: 0.1, y: 5.8, color: "#2a2a2c", seed: 47 },
    // cameras on pedestals: one on the home base, two on the band
    camera([-3.6, 0.6], [-4.6, -4.6], 48), camera([2.4, 0.2], [3, -4.6], 49), camera([6.4, 0.6], [3.6, -4.4], 50),
    // the band's snake across the floor to the mix desk
    { kind: "cables", at: [0.9, -1.0], yaw: 1.1, w: 3.6, d: 0.5, h: 0.01, color: "#2f6ab0", seed: 51 },
    // the audience's bleachers, rising toward the front wall
    { kind: "bleachers", at: [0, 4.65], yaw: 0, w: 11, d: 4.2, h: 2.1, color: "#2a2a2e", seed: 52 },
  ],
};
