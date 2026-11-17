// The live room: a 9 by 7 metre room with its control room behind glass at the back. The band sets up in the
// front two thirds (keys, drums, bass, a vocal booth in the corner), the couch sits by the door, and the desk faces
// the window from the control room, reached by the gap at the right end of the glass wall.
import type { StudioDef } from "../def.ts";

// FM DAW's starting tracks: 0 Kick, 1 Snare, 2 Hat, 3 Clap, 4 Tom, 5 Bass, 6 Keys, 7 Pad, 8 Lead (src/presets.ts KIT).
export const LIVE_ROOM: StudioDef = {
  id: "live",
  name: "The live room",
  size: [9, 7],
  height: 3.2,
  floor: 0x7a5a3e,
  walls: 0x39404a,
  // the control-room wall: glass from x -4.5 to 2.6, then a doorway to 3.6, then wall to the side
  partitions: [
    { from: [-4.5, -1.6], to: [2.6, -1.6], glass: { sill: 0.9, head: 2.3 } },
    { from: [3.6, -1.6], to: [4.5, -1.6] },
  ],
  spots: [
    { id: "keys", name: "Keys", kind: "keys", at: [-2.2, 0.9], yaw: 0, track: 6 },
    { id: "drums", name: "Drums", kind: "drums", at: [0, -0.2], yaw: Math.PI, kit: [0, 1, 2, 3, 4] },
    { id: "bass", name: "Bass", kind: "bass", at: [2.2, 0.9], yaw: 0, track: 5 },
    { id: "vocal", name: "Vocal booth", kind: "vocal", at: [3.7, 2.6], yaw: Math.PI / 2, track: 8 },
    { id: "couch", name: "Couch", kind: "couch", at: [-3.4, 2.7], yaw: -Math.PI / 2 },
    { id: "desk", name: "Desk", kind: "desk", at: [-0.5, -2.6], yaw: Math.PI },
  ],
  door: { at: [0.9, 2.1], yaw: 0 },
};
