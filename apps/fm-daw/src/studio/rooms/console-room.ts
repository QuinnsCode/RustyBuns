// The console room: a wood-panelled room built round a big analog desk, the kind of room a lot of 80s and 90s West
// Coast hip-hop was made in. Racks of outboard gear down both walls, drum machines and samplers on a table, big
// monitors on stands, a couch behind the desk for whoever came along, and low warm light. Carpet, a tiled ceiling
// and the wood keep it from ringing, so the low end you hear is the record, not the room.
import type { StudioDef } from "../room.ts";
import { all, colors, grow, seat } from "./kit.ts";

const Q = Math.PI / 2;
const desk = seat("desk", "desk", [0, 1.2], 0, "the console");

export const CONSOLE_ROOM: StudioDef = {
  // 3.4 metres more at the back (what stood against the back wall went with it): the gear wall stands there
  ...grow({
  id: "console-room", name: "The console room",
  about: "A wood-panelled room built round a big analog console: racks of outboard gear down the walls, drum machines and samplers on a table, big monitors, a couch behind the desk, and low warm light. Carpet and wood keep it dry, so the low end is the record's, not the room's.",
  size: { w: 8, d: 8, h: 3 },
  colors: { ...colors("carpet", "wood", "ceilingTile"), floor: "#3a2a22", walls: "#6a4a2e", trim: "#a87a44" },
  materials: { floor: "carpet", ceiling: "ceilingTile", walls: all("wood") },
  panels: [{ wall: "back", material: "foam", m2: 6 }],
  walls: [],
  spots: [
    // the desk faces the band, the console a long run of channel strips on top of it
    { ...desk, thing: { ...desk.thing, w: 3.2, d: 0.9, h: 0.8, color: "#4a3020" } },
    // a couch behind the desk, for whoever came along to listen
    seat("couch", "couch", [0, 2.5], 0, "the couch"),
    // the band plays facing the console
    seat("drums", "drums", [-2.2, -2.8], Math.PI),
    seat("keys", "keys", [0.4, -2.9], Math.PI, "the keys", "keys"),
    seat("bass", "bass", [2.0, -2.9], Math.PI),
    seat("vocal", "booth", [-0.9, -1.4], Math.PI, "the mic"),
  ],
  door: { at: [-3, 3.6], yaw: 0 },
  props: [
    // the console, on the desk in front of the chair
    { kind: "console", at: [0, 0.55], yaw: 0, w: 2.7, d: 0.8, h: 0.3, y: 0.8, color: "#5a3a22", seed: 31 },
    // big monitors on stands either side of the desk, toed in at the chair
    { kind: "monitor", at: [-2.1, 0.4], yaw: Math.PI - 0.35, w: 0.6, d: 0.5, h: 1.4, color: "#2a2420" },
    { kind: "monitor", at: [2.1, 0.4], yaw: Math.PI + 0.35, w: 0.6, d: 0.5, h: 1.4, color: "#2a2420" },
    // racks of outboard gear down both walls, beside the chair
    { kind: "rack", at: [-3.65, 1.6], yaw: -Q, w: 1.8, d: 0.6, h: 1.3, color: "#2a2a2c", seed: 32 },
    { kind: "rack", at: [3.65, 1.6], yaw: Q, w: 1.8, d: 0.6, h: 1.3, color: "#2a2a2c", seed: 33 },
    // drum machines and samplers on a table by the right wall
    { kind: "table", at: [3.3, -1.2], yaw: Q, w: 2.0, d: 0.7, h: 0.8, color: "#5a3a22" },
    { kind: "sampler", at: [3.3, -1.8], yaw: Q, w: 0.45, d: 0.35, h: 0.08, y: 0.8, color: "#c8c0b0", seed: 34 },
    { kind: "sampler", at: [3.3, -1.2], yaw: Q, w: 0.4, d: 0.3, h: 0.07, y: 0.8, color: "#2a2a2c", seed: 35 },
    { kind: "sampler", at: [3.3, -0.6], yaw: Q, w: 0.5, d: 0.35, h: 0.1, y: 0.8, color: "#8a8478", seed: 36 },
    // a rug under the couch, low lamps in the corners and records framed on the back wall
    { kind: "rug", at: [0, 2.6], yaw: 0, w: 3.2, d: 1.8, h: 0.01, color: "#5a2a1e" },
    { kind: "lamp", at: [3.5, 3.5], yaw: 0, w: 0.4, d: 0.4, h: 1.4, color: "#c88a4a" },
    { kind: "lamp", at: [-3.5, -3.5], yaw: 0, w: 0.4, d: 0.4, h: 1.4, color: "#c88a4a" },
    { kind: "lamp", at: [1.45, 0.75], yaw: 0, w: 0.22, d: 0.22, h: 0.4, y: 0.8, color: "#3a2a1a" },
    { kind: "plant", at: [-1.6, 3.4], yaw: 0, w: 0.5, d: 0.5, h: 1.1, color: "#6a4a2e", seed: 37 },
    { kind: "frames", at: [0, -3.93], yaw: Math.PI, w: 4, d: 0.02, h: 1.2, y: 1.3, color: "#000000", seed: 38 },
  ],
}, "back", 3.4),
  gear: { at: [-2.25, -2.7], yaw: 0 },
};
