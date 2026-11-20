// Every Qollab Studio room, by id: /jam.html?studio=<id> walks you into one, and the studio builder (/rooms.html)
// starts from one. Rooms after famous studios are described by what made them sound the way they do (a hall big
// enough for an orchestra, a basement with a dead drum booth), never by a real studio's name, branding or
// likeness: the same rule as the games.
import { boothWalls } from "../builder.ts";
import type { StudioDef } from "../room.ts";
import { CONSOLE_ROOM } from "./console-room.ts";
import { DESK_CONCERT } from "./desk-concert.ts";
import { all, colors, seat } from "./kit.ts";
import { LIVE_ROOM } from "./live.ts";
import { ORCHESTRA_ROOM } from "./orchestra.ts";
import { SOUND_STAGE } from "./sound-stage.ts";

/** A scoring hall: room for a full orchestra, the sound blooming for two seconds. */
export const SCORING_HALL: StudioDef = {
  id: "scoring-hall", name: "The scoring hall",
  about: "A tall hall built for orchestras recording film scores: wood on the floor, the walls and the ceiling high overhead keeps the low end warm, and heavy curtains are drawn when it rings too long.",
  size: { w: 26, d: 32, h: 13 },
  colors: colors("floorboards", "wood", "wood"),
  materials: { floor: "floorboards", ceiling: "wood", walls: all("wood") },
  panels: [{ wall: "back", material: "curtain", m2: 200 }, { wall: "left", material: "curtain", m2: 120 }, { wall: "right", material: "curtain", m2: 120 }],
  walls: boothWalls("control", [0, 13.5], 10, 5, { w: 26, d: 32 }),
  spots: [
    seat("violins", "keys", [-6, 2], Math.PI, "the violins", "strings"), seat("cellos", "keys", [4, 3], Math.PI, "the cellos", "strings"),
    seat("brass", "keys", [-2, -6], Math.PI, "the brass", "brass"), seat("timpani", "drums", [5, -9], Math.PI, "the timpani"),
    seat("piano", "keys", [-8, -4], Math.PI, "the piano"), seat("desk", "desk", [0, 14.4], 0),
  ],
  door: { at: [-10, 10], yaw: 0 },
  gear: { at: [-11.25, -13], yaw: 0 },
};

/** A basement studio: a low concrete room, and a drum booth so dead the kit sounds like it's in your lap. */
export const BASEMENT: StudioDef = {
  id: "basement", name: "The basement",
  about: "A low basement with bare concrete walls that slap back, a rug on the floor, and a drum booth lined wall to wall in absorbers so the kit comes out dry and tight.",
  size: { w: 7, d: 9, h: 2.5 },
  colors: colors("carpet", "concrete", "drywall"),
  materials: { floor: "carpet", ceiling: "drywall", walls: all("concrete") },
  walls: boothWalls("drum-booth", [-1.8, -2.9], 3.2, 3, { w: 7, d: 9 }),
  spots: [
    seat("drums", "drums", [-1.8, -2.4], 0), seat("bass", "bass", [-0.1, -0.9], Math.PI / 2),
    seat("keys", "keys", [-2, 1], 0), seat("vocal", "booth", [1.5, 1.2], 0, "the mic"),
    seat("couch", "couch", [1.8, 3.6], Math.PI),
  ],
  door: { at: [0, 3.8], yaw: 0 },
  // the rack down the right wall by the drum booth
  gear: { at: [0.5, -2.75], yaw: -Math.PI / 2 },
};

/** A stone room: hard on every side and tall, for big booming drums and a long vocal tail. */
export const STONE_ROOM: StudioDef = {
  id: "stone-room", name: "The stone room",
  about: "A tall, narrow room of stone and brick with nothing soft in it, where a drum kit booms and a singer's last note hangs in the air.",
  size: { w: 5, d: 7, h: 9 },
  colors: colors("stone", "brick", "plaster"),
  materials: { floor: "stone", ceiling: "plaster", walls: all("brick") },
  walls: [],
  spots: [seat("drums", "drums", [-1.2, 1.3], 0), seat("vocal", "booth", [0, 1.6], Math.PI, "the mic")],
  door: { at: [1.5, 3], yaw: 0 },
  gear: { at: [-0.75, -0.5], yaw: 0 },
};

/** A wooden barn: a big room of boards, warm and lively, with a dead booth for the singer. */
export const BARN: StudioDef = {
  id: "barn", name: "The barn",
  about: "An old wooden barn turned into a studio: boards on every side, high rafters and a curtain along one wall, so a band playing together sounds warm and in one room.",
  size: { w: 10, d: 14, h: 7 },
  colors: colors("floorboards", "wood", "wood"),
  materials: { floor: "floorboards", ceiling: "wood", walls: all("wood") },
  panels: [{ wall: "left", material: "curtain", m2: 10 }],
  walls: boothWalls("vocal-booth", [3.5, 5.5], 2.5, 2.5, { w: 10, d: 14 }),
  spots: [
    seat("drums", "drums", [0, -3.5], 0), seat("bass", "bass", [-2.5, -1.5], Math.PI / 2),
    seat("keys", "keys", [2.5, -1.5], 0), seat("vocal", "booth", [3.5, 5.8], 0, "the mic"),
    seat("desk", "desk", [-3, 4.5], 0),
  ],
  door: { at: [-1, 6], yaw: 0 },
  gear: { at: [2, -5.25], yaw: -Math.PI / 2 },
};

export const ROOM_LIST: StudioDef[] = [LIVE_ROOM, SCORING_HALL, BASEMENT, STONE_ROOM, BARN, DESK_CONCERT, ORCHESTRA_ROOM, CONSOLE_ROOM, SOUND_STAGE];
/** Every room, by id. */
export const ROOMS: Record<string, StudioDef> = Object.fromEntries(ROOM_LIST.map((r) => [r.id, r]));
export { LIVE_ROOM };
