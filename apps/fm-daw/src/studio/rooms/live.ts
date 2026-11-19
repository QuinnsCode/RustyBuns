// The first Qollab Studio room: a live room with the kit, keys and a bass synth, a vocal booth in the front corner,
// and the control room behind a glass wall, where the desk looks through at the band. Our own room, not after any studio.
import type { StudioDef } from "../room.ts";

export const LIVE_ROOM: StudioDef = {
  id: "live-room",
  name: "The live room",
  size: { w: 10, d: 9, h: 3.4 },
  colors: { floor: "#8c7459", walls: "#62656b", ceiling: "#a7aaad", trim: "#9a7650" },
  about: "Our own room: a wooden floor, an old brick wall behind the band, painted plaster elsewhere, an acoustic tile ceiling, cloth-wrapped absorbers down the side, a slatted diffuser behind the desk, a vocal booth lined in absorbers, and the control room behind a glass wall.",
  materials: { floor: "floorboards", ceiling: "ceilingTile", walls: { front: "brick", back: "drywall", left: "drywall", right: "drywall" } },
  panels: [{ wall: "left", material: "panel", m2: 5 }, { wall: "right", material: "curtain", m2: 6 }, { wall: "back", material: "slats", m2: 5 }, { wall: "back", material: "panel", m2: 3 }],
  walls: [
    // the control room's window, with its door at the right end
    { from: [-5, -1.5], to: [5, -1.5], glass: true, gaps: [[8.1, 9.1]] },
    // the vocal booth: glass toward the room, a door on its side
    { from: [-5, 2.4], to: [-2.6, 2.4], glass: true },
    { from: [-2.6, 2.4], to: [-2.6, 4.5], gaps: [[0.9, 1.8]], material: "foam" },
  ],
  spots: [
    { id: "drums", kind: "drums", label: "the kit", at: [-0.6, 0.4], yaw: 0, thing: { w: 1.6, d: 1.1, h: 0.8, ahead: 0.8, color: "#b23a2e" } },
    { id: "keys", kind: "keys", label: "the keys", at: [2.6, 0.7], yaw: 0, thing: { w: 1.4, d: 0.45, h: 0.82, ahead: 0.48, color: "#16191c" }, track: "keys" },
    { id: "bass", kind: "bass", label: "the bass synth", at: [1.2, 2.9], yaw: Math.PI / 2, thing: { w: 0.7, d: 0.5, h: 0.9, ahead: 0.75, color: "#2e3439" }, track: "bass" },
    { id: "booth", kind: "booth", label: "the vocal booth", at: [-3.8, 3.5], yaw: 0, thing: { w: 0.3, d: 0.3, h: 1.6, ahead: 0.55, color: "#8a8f94" } },
    { id: "desk", kind: "desk", label: "the desk", at: [0, -2.7], yaw: Math.PI, thing: { w: 2.4, d: 0.8, h: 0.85, ahead: 0.65, color: "#2b2d31" } },
    { id: "couch", kind: "couch", label: "the couch", at: [-2.6, -3.8], yaw: Math.PI, thing: { w: 2, d: 0.8, h: 0.45, ahead: -0.15, color: "#6b4a2c" } },
  ],
  door: { at: [-0.4, 2.5], yaw: 0 },
};
