// What a built room can hold: Poly Haven models (CC0, https://polyhaven.com/license), each with the label
// the hunt shows, its footprint in metres (x wide, y deep, z tall, from Poly Haven's own dimensions) and a
// role. Front faces -y in the model's frame, so "against a wall" turns it to face the room.
//   wall:    furniture that stands against a wall; host = small things get dropped on it
//   centre:  the middle of the room (a table), with seats that face it
//   seat:    pulled up around the centre piece
//   prop:    small things dropped onto hosts; these are what rounds ask you to find
//   hang:    hung on a wall at eye height

export type Role = "wall" | "centre" | "seat" | "prop" | "hang";

/** `turn`: degrees to add when a model's front is not -y (Poly Haven mostly agrees, a few don't) */
export interface Asset { id: string; label: string; role: Role; size: [number, number, number]; host?: boolean; turn?: number }

const a = (id: string, label: string, role: Role, size: [number, number, number], host = false, turn = 0): Asset =>
  ({ id, label, role, size, host, turn });

export interface Theme {
  name: string;
  floor: string;   // Poly Haven texture id
  wall: [number, number, number];   // paint colour, sRGB 0..1
  assets: Asset[];
  /** how many props to scatter */
  props: number;
}

export const THEMES: Record<string, Theme> = {
  parlour: {
    name: "Parlour",
    floor: "herringbone_parquet",
    wall: [0.78, 0.74, 0.66],
    props: 26,
    assets: [
      a("sofa_02", "sofa", "wall", [1.81, 0.82, 0.71]),
      a("drawer_cabinet", "drawer cabinet", "wall", [1.14, 0.49, 1.88], true),
      a("wooden_display_shelves_01", "display shelves", "wall", [1.08, 0.37, 1.56], true, 180),
      a("painted_wooden_shelves", "shelves", "wall", [0.51, 0.37, 1.13], true),
      a("ClassicConsole_01", "console table", "wall", [1.54, 0.59, 0.95], true),
      a("side_table_01", "side table", "wall", [0.55, 0.45, 0.55], true),
      a("GothicCommode_01", "commode", "wall", [1.2, 0.58, 1.21], true),
      a("modern_coffee_table_01", "coffee table", "centre", [1.2, 0.6, 0.39], true),
      a("ArmChair_01", "armchair", "seat", [0.85, 0.77, 1.07]),
      a("Ottoman_01", "ottoman", "seat", [0.88, 0.62, 0.62]),
      a("hanging_picture_frame_01", "picture", "hang", [0.59, 0.02, 0.84]),
      a("hanging_picture_frame_02", "painting", "hang", [0.75, 0.03, 0.5]),
      a("ornate_mirror_01", "mirror", "hang", [0.49, 0.03, 0.74]),
      a("alarm_clock_01", "alarm clock", "prop", [0.23, 0.17, 0.17]),
      a("ceramic_vase_01", "vase", "prop", [0.2, 0.21, 0.4]),
      a("ceramic_vase_03", "tall vase", "prop", [0.11, 0.11, 0.41]),
      a("brass_vase_03", "brass vase", "prop", [0.08, 0.08, 0.2]),
      a("book_encyclopedia_set_01", "encyclopedias", "prop", [0.55, 0.16, 0.24]),
      a("standing_picture_frame_01", "photo frame", "prop", [0.2, 0.1, 0.25]),
      a("mantel_clock_01", "mantel clock", "prop", [0.48, 0.25, 0.16]),
      a("chess_set", "chess set", "prop", [0.55, 0.55, 0.11]),
      a("carved_wooden_elephant", "wooden elephant", "prop", [0.11, 0.06, 0.1]),
      a("horse_statue_01", "horse statue", "prop", [0.16, 0.11, 0.22]),
      a("concrete_cat_statue", "cat statue", "prop", [0.15, 0.25, 0.28]),
      a("cassette_player", "cassette player", "prop", [0.13, 0.05, 0.24]),
      a("Camera_01", "camera", "prop", [0.21, 0.26, 0.08]),
      a("gamepad", "gamepad", "prop", [0.4, 0.43, 0.02]),
      a("gaming_console", "games console", "prop", [0.33, 0.32, 0.1]),
      a("magnifying_glass_01", "magnifying glass", "prop", [0.13, 0.03, 0.27]),
      a("vintage_pocket_watch", "pocket watch", "prop", [0.06, 0.01, 0.08]),
      a("wooden_candlestick", "candlestick", "prop", [0.1, 0.1, 0.22]),
      a("vintage_oil_lamp", "oil lamp", "prop", [0.22, 0.22, 0.8]),
      a("wicker_basket_02", "wicker basket", "prop", [0.37, 0.27, 0.22]),
      a("brass_goblets", "goblets", "prop", [0.45, 0.3, 0.27]),
      a("Lantern_01", "lantern", "prop", [0.12, 0.1, 0.29]),
      a("baseball_01", "baseball", "prop", [0.07, 0.08, 0.08]),
      a("vintage_video_camera", "film camera", "prop", [0.07, 0.13, 0.14]),
    ],
  },
  kitchen: {
    name: "Kitchen",
    floor: "floor_tiles_06",
    wall: [0.86, 0.84, 0.76],
    props: 28,
    assets: [
      a("electric_stove", "stove", "wall", [0.5, 0.65, 0.86], true),
      a("painted_wooden_cabinet", "cabinet", "wall", [1.19, 0.62, 1.18], true),
      a("wooden_display_shelves_01", "display shelves", "wall", [1.08, 0.37, 1.56], true, 180),
      a("painted_wooden_shelves", "shelves", "wall", [0.51, 0.37, 1.13], true),
      a("small_wooden_table_01", "side table", "wall", [0.92, 0.44, 0.53], true),
      a("modern_wooden_cabinet", "sideboard", "wall", [2.44, 0.52, 0.68], true),
      a("round_wooden_table_02", "table", "centre", [0.8, 0.8, 0.75], true),
      a("dining_chair_02", "chair", "seat", [0.43, 0.58, 0.97]),
      a("painted_wooden_chair_01", "wooden chair", "seat", [0.43, 0.54, 0.96]),
      a("hanging_picture_frame_03", "picture", "hang", [0.39, 0.03, 0.5]),
      a("fancy_picture_frame_01", "painting", "hang", [0.6, 0.02, 0.46]),
      a("carrot_cake", "carrot cake", "prop", [0.23, 0.23, 0.1]),
      a("strawberry_chocolate_cake", "chocolate cake", "prop", [0.24, 0.24, 0.08]),
      a("croissant", "croissant", "prop", [0.2, 0.08, 0.06]),
      a("lemon", "lemon", "prop", [0.07, 0.07, 0.1]),
      a("yellow_onion", "onion", "prop", [0.07, 0.07, 0.09]),
      a("wooden_bowl_01", "wooden bowl", "prop", [0.31, 0.31, 0.09]),
      a("wooden_bowl_02", "small bowl", "prop", [0.13, 0.12, 0.07]),
      a("jug_01", "jug", "prop", [0.28, 0.17, 0.21]),
      a("tea_set_01", "tea set", "prop", [0.92, 0.48, 0.16]),
      a("wooden_cutting_board", "cutting board", "prop", [0.45, 0.25, 0.04]),
      a("wooden_spoon", "wooden spoon", "prop", [0.09, 0.28, 0.03]),
      a("pot_enamel_01", "enamel pot", "prop", [0.26, 0.18, 0.18]),
      a("brass_pan_01", "brass pan", "prop", [0.19, 0.45, 0.05]),
      a("brass_pot_01", "brass pot", "prop", [0.3, 0.3, 0.29]),
      a("russian_food_cans_01", "tin cans", "prop", [0.14, 0.05, 0.08]),
      a("wine_bottles_01", "wine bottles", "prop", [0.68, 0.08, 0.33]),
      a("metal_jug", "metal jug", "prop", [0.2, 0.2, 0.29]),
      a("mousetrap", "mousetrap", "prop", [0.05, 0.1, 0.02]),
      a("carved_wooden_plate", "wooden plate", "prop", [0.27, 0.27, 0.04]),
      a("ceramic_vase_02", "vase", "prop", [0.22, 0.22, 0.31]),
      a("alarm_clock_01", "alarm clock", "prop", [0.23, 0.17, 0.17]),
      a("wooden_candlestick", "candlestick", "prop", [0.1, 0.1, 0.22]),
      a("wicker_basket_02", "wicker basket", "prop", [0.37, 0.27, 0.22]),
    ],
  },
};
