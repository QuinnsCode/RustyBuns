// The lounge's furniture from Poly Haven (CC0, https://polyhaven.com/models): what scripts/lounge-models.ts fetches
// into public/lounge/<id>/ and lounge.ts stands in the room. Poly Haven models come in metres, so none is scaled.
/** Each model by its Poly Haven id, and what it is in the room. */
export const LOUNGE_MODELS = {
  sofa_02: "the leather chesterfield",
  mid_century_lounge_chair: "the lounge chair",
  modern_arm_chair_01: "the leather armchair",
  industrial_coffee_table: "the coffee table",
  side_table_01: "the side table",
  metal_stool_02: "a shop stool",
  potted_plant_02: "the big-leaf plant",
  potted_plant_04: "the succulent",
  hanging_industrial_lamp: "a factory pendant",
  worn_metal_rack: "the metal shelf",
  wooden_bookshelf_worn: "the bookshelf",
  cardboard_box_01: "a cardboard box",
  plastic_crate_01: "a milk crate",
  wooden_crate_02: "the wooden chest",
  vintage_suitcase: "the old suitcases",
  boombox: "the boombox",
} as const;
export type LoungeModel = keyof typeof LOUNGE_MODELS;
