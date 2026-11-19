// The desk concert: a band squeezed in behind an office desk, in a small room lined with shelves of books, records
// and toys. Small, warm and crowded; the shelves and the carpet soak up the room, so it sounds close and tight.
// Between the way in and the band it's still somebody's office: a cubicle's edge on the left with a desk tucked
// into it, a second desk against the right wall, a filing cabinet, books piled on the floor, papers and mugs left
// everywhere and the band's cables run across the carpet to the desk. The middle stays clear, the way in to every seat.
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
    { kind: "frames", at: [2.93, -0.6], yaw: Q, w: 3.4, d: 0.02, h: 1.4, y: 1.1, color: "#000000", seed: 13 },
    { kind: "rug", at: [0, -1.1], yaw: 0, w: 4.4, d: 2.4, h: 0.01, color: "#7a3a2a" },
    // lamps everywhere, one on the desk
    { kind: "lamp", at: [-2.45, 0.85], yaw: 0, w: 0.42, d: 0.42, h: 1.55, color: "#d8b884" },
    { kind: "lamp", at: [2.55, -2.0], yaw: 0, w: 0.36, d: 0.36, h: 1.3, color: "#c88a4a" },
    { kind: "lamp", at: [-0.85, 1.35], yaw: 0, w: 0.26, d: 0.26, h: 0.45, y: 0.85, color: "#3a6a4a" },
    { kind: "plant", at: [0.85, 1.4], yaw: 0, w: 0.25, d: 0.25, h: 0.3, y: 0.85, color: "#c8502e", seed: 16 },
    // the foreground, front left: the edge of a cubicle facing the way in, a desk in it against the front wall with
    // its screen on, a filing cabinet against the end of the shelves, and books piled on the floor beside it
    { kind: "cubicle", at: [-1.95, 1.82], yaw: -Q, w: 1.25, d: 0.06, h: 1.25, color: "#4a525c", seed: 21 },
    { kind: "officeDesk", at: [-2.45, 2.12], yaw: 0, w: 0.92, d: 0.66, h: 0.74, color: "#b89a70", seed: 22 },
    { kind: "cabinet", at: [-2.74, 1.42], yaw: -Q, w: 0.46, d: 0.5, h: 1.02, color: "#8a8c86", seed: 23 },
    { kind: "books", at: [-2.55, 0.95], yaw: 0.3, w: 0.4, d: 0.3, h: 0.32, color: "#000000", seed: 24 },
    { kind: "plant", at: [-2.74, 1.42], yaw: 0, w: 0.28, d: 0.28, h: 0.34, y: 1.32, color: "#d8d2c4", seed: 15 },
    { kind: "frames", at: [-2.3, 2.43], yaw: 0, w: 1.2, d: 0.02, h: 0.8, y: 1.15, color: "#000000", seed: 25 },
    // front right: a desk against the right wall behind a low partition from the bass, papers pinned over it
    { kind: "officeDesk", at: [2.64, 1.86], yaw: Q, w: 1.2, d: 0.66, h: 0.74, color: "#8a6a4a", seed: 26 },
    { kind: "cubicle", at: [2.5, 1.2], yaw: Math.PI, w: 1.0, d: 0.06, h: 1.1, color: "#6a5a50", seed: 27 },
    { kind: "plant", at: [2.78, 1.42], yaw: 0, w: 0.3, d: 0.3, h: 0.4, y: 0.74, color: "#c8502e", seed: 28 },
    { kind: "frames", at: [1.55, 2.43], yaw: 0, w: 1.1, d: 0.02, h: 0.9, y: 1.1, color: "#000000", seed: 29 },
    // posters across the front wall, over the way in (kept clear: the way round the desk runs along it)
    { kind: "frames", at: [0.05, 2.43], yaw: 0, w: 2, d: 0.02, h: 1.0, y: 1.2, color: "#000000", seed: 37 },
    // what's left on the desk the band plays to: papers, a set list, mugs
    { kind: "clutter", at: [0.45, 1.5], yaw: 0.1, w: 0.6, d: 0.3, h: 0.1, y: 0.85, color: "#000000", seed: 31 },
    { kind: "clutter", at: [-0.45, 1.1], yaw: -0.15, w: 0.5, d: 0.25, h: 0.1, y: 0.85, color: "#000000", seed: 32 },
    // the band's cables, across the carpet from the kit and the keys to the desk
    { kind: "cables", at: [-0.4, -0.25], yaw: 0.9, w: 2.0, d: 0.4, h: 0.01, color: "#c8502e", seed: 33 },
    { kind: "cables", at: [1.05, -0.35], yaw: -1.1, w: 1.6, d: 0.3, h: 0.01, color: "#2f6ab0", seed: 34 },
    // a little speaker pair on the back shelf's top board
    { kind: "monitor", at: [-1.2, -2.3], yaw: Math.PI, w: 0.2, d: 0.22, h: 0.3, y: 2.3, color: "#2a2420" },
    { kind: "monitor", at: [1.2, -2.3], yaw: Math.PI, w: 0.2, d: 0.22, h: 0.3, y: 2.3, color: "#2a2420" },
  ],
};
