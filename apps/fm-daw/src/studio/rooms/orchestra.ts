// The orchestra room: a tall live room with a floor big enough for an orchestra, stairs up the back to a balcony and
// the lit window of the control room, a grand piano, mics on tall stands over each section, and panels down both
// walls. Wood all round keeps it warm; the panels and a curtain along the back stop it ringing too long.
import type { StudioDef } from "../room.ts";
import { all, colors, seat } from "./kit.ts";

const Q = Math.PI / 2, BAND = Math.PI;

/** A row of panels down a side wall, one at each z. */
const panels = (x: number, yaw: number, zs: number[]) => zs.map((z) => ({ kind: "panel" as const, at: [x, z] as [number, number], yaw, w: 1.4, d: 0.08, h: 3.4, y: 1.2, color: "#8a7a64" }));
/** A tall stand reaching its mic out over a section: `at` the foot, the boom `reach` metres toward -z. */
const mic = (at: [number, number], reach = 1.2, h = 3.2) => ({ kind: "micStand" as const, at, yaw: 0, w: 0.3, d: reach, h, color: "#c8c8cc" });

export const ORCHESTRA_ROOM: StudioDef = {
  id: "orchestra-room", name: "The orchestra room",
  about: "A tall wooden room built for a whole orchestra: a huge floor, the ceiling eleven metres up, stairs to a balcony and the control room's window, a grand piano, and panels down both walls so the hall sounds big but never muddy.",
  size: { w: 22, d: 28, h: 11 },
  colors: { ...colors("floorboards", "wood", "wood"), trim: "#d8b070" },
  materials: { floor: "floorboards", ceiling: "wood", walls: all("wood") },
  panels: [{ wall: "left", material: "foam", m2: 60 }, { wall: "right", material: "foam", m2: 60 }, { wall: "back", material: "curtain", m2: 100 }],
  walls: [],
  spots: [
    // the sections face the way in, each under its mic
    { ...seat("piano", "keys", [-6, -3.8], BAND, "the grand piano", "keys"), thing: { w: 1.4, d: 0.3, h: 0.95, ahead: 0.5, color: "#111111" } },
    seat("violins", "keys", [-1.5, -1], BAND, "the violins", "strings"),
    seat("cellos", "keys", [3, -1], BAND, "the cellos", "strings"),
    seat("brass", "keys", [0, -6], BAND, "the brass", "brass"),
    seat("timpani", "drums", [5.5, -7], BAND, "the timpani"),
    seat("bass", "bass", [7.5, -2], BAND, "the double bass"),
    seat("vocal", "booth", [0, 3.5], BAND, "the choir mic"),
    // under the balcony, the talkback desk looks out at them all
    seat("desk", "desk", [3, -12.4], BAND, "the talkback desk"),
  ],
  door: { at: [6, 12.8], yaw: 0 },
  props: [
    // stairs up the back to the balcony, and the control room's lit window above it
    { kind: "stairs", at: [-3.75, -11], yaw: Math.PI, w: 1.3, d: 6, h: 4, color: "#6a4a2e" },
    { kind: "balcony", at: [3, -12.5], yaw: 0, w: 12, d: 3, h: 0.3, y: 4, color: "#6a4a2e" },
    { kind: "window", at: [3, -13.93], yaw: Math.PI, w: 7, d: 0.1, h: 2.2, y: 4.6, color: "#3a2a1c" },
    // the grand, its lid up toward the room
    { kind: "piano", at: [-6, -2], yaw: 0, w: 1.5, d: 2.7, h: 1, color: "#0e0e10" },
    // tall stands over every section, and a pair over the piano
    mic([-1.5, 0.4]), mic([3, 0.4]), mic([0, -4.6]), mic([5.5, -5.3], 1.4, 3.4), mic([7.5, -0.6]), mic([0, 4.9], 0.9, 2),
    mic([-7.2, 0.2], 1.8, 3.6), mic([-4.8, 0.2], 1.8, 3.6),
    // panels down both walls
    ...panels(-10.95, -Q, [-9, -5, -1, 3, 7, 11]), ...panels(10.95, Q, [-9, -5, -1, 3, 7, 11]),
    // warm lamps by the piano and the door
    { kind: "lamp", at: [-8.6, -4.6], yaw: 0, w: 0.5, d: 0.5, h: 1.8, color: "#d8b884" },
    { kind: "lamp", at: [9.6, 12.4], yaw: 0, w: 0.5, d: 0.5, h: 1.8, color: "#d8b884" },
    { kind: "rug", at: [-6, -2.6], yaw: 0, w: 3.4, d: 4.4, h: 0.01, color: "#5a2a22" },
  ],
};
