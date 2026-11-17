// The desk concert: a band squeezed in behind an office desk, in a small room lined with shelves of books, records
// and toys. Small, warm and crowded; the shelves and the carpet soak up the room, so it sounds close and tight.
import type { StudioDef } from "../room.ts";
import { colors, seat } from "./kit.ts";

const Q = Math.PI / 2;

export const DESK_CONCERT: StudioDef = {
  id: "desk-concert", name: "The desk concert",
  about: "A band crammed in behind an office desk: carpet underfoot, a low ceiling, and every wall a shelf of books, records and toys, so the room stays out of the way and the band sounds right there with you.",
  size: { w: 6, d: 5, h: 2.7 },
  colors: { ...colors("carpet", "wood", "ceilingTile"), walls: "#6a5440", trim: "#b08850" },
  // The back and left walls are shelves (wood with books in it), and coats hang on one stretch of the back.
  materials: { floor: "carpet", ceiling: "ceilingTile", walls: { front: "drywall", back: "wood", left: "wood", right: "drywall" } },
  panels: [{ wall: "back", material: "curtain", m2: 4 }],
  walls: [],
  spots: [
    // the desk faces the way in, and the band packs in behind it, everyone facing the same way
    seat("desk", "desk", [0, 0.6], Math.PI, "the office desk"),
    seat("drums", "drums", [-1.5, -1.4], Math.PI),
    seat("keys", "keys", [1.4, -1.4], Math.PI, "the keys", "keys"),
    seat("bass", "bass", [2.3, 0.1], Math.PI),
    seat("vocal", "booth", [0, -1], Math.PI, "the mic"),
  ],
  door: { at: [0, 2.1], yaw: 0 },
  props: [
    // shelves floor to ceiling along the back and down the left, packed with books, records and toys
    { kind: "shelf", at: [0, -2.34], yaw: Math.PI, w: 5.9, d: 0.32, h: 2.3, color: "#7a5636", seed: 11 },
    { kind: "shelf", at: [-2.84, -0.55], yaw: -Q, w: 3.3, d: 0.32, h: 2.3, color: "#7a5636", seed: 12 },
    // posters, framed records and pictures up the right wall
    { kind: "frames", at: [2.97, -0.6], yaw: Q, w: 3.4, d: 0.02, h: 1.4, y: 1.1, color: "#000000", seed: 13 },
    { kind: "rug", at: [0, -1.1], yaw: 0, w: 4.4, d: 2.4, h: 0.01, color: "#7a3a2a" },
    // lamps everywhere, one on the desk
    { kind: "lamp", at: [-2.5, 1.6], yaw: 0, w: 0.42, d: 0.42, h: 1.55, color: "#d8b884" },
    { kind: "lamp", at: [2.55, -2.0], yaw: 0, w: 0.36, d: 0.36, h: 1.3, color: "#c88a4a" },
    { kind: "lamp", at: [-0.85, 1.35], yaw: 0, w: 0.26, d: 0.26, h: 0.45, y: 0.85, color: "#3a6a4a" },
    { kind: "plant", at: [-2.55, 2.1], yaw: 0, w: 0.55, d: 0.55, h: 1.2, color: "#a06a4a", seed: 14 },
    { kind: "plant", at: [2.6, 1.8], yaw: 0, w: 0.45, d: 0.45, h: 0.9, color: "#d8d2c4", seed: 15 },
    { kind: "plant", at: [0.85, 1.4], yaw: 0, w: 0.25, d: 0.25, h: 0.3, y: 0.85, color: "#c8502e", seed: 16 },
    // a little speaker pair on the back shelf's top board
    { kind: "monitor", at: [-1.2, -2.3], yaw: Math.PI, w: 0.2, d: 0.22, h: 0.3, y: 2.3, color: "#2a2420" },
    { kind: "monitor", at: [1.2, -2.3], yaw: Math.PI, w: 0.2, d: 0.22, h: 0.3, y: 2.3, color: "#2a2420" },
  ],
};
