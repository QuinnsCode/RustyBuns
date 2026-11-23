# The gear room's lounge furniture

Every model here is from [Poly Haven](https://polyhaven.com/models) under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/):
free to ship, no credit needed, credited anyway. `scripts/lounge-models.ts` fetched each one's 1k glTF set and
shrank every texture to 512 px (JPEG quality 70); `src/room/lounge-models.ts` lists them and `src/room/lounge-plan.ts`
says where each stands. About 10 MB for the folder, loaded after the room's first frame.

| folder | Poly Haven asset | in the room |
|---|---|---|
| sofa_02 | [Sofa 02](https://polyhaven.com/a/sofa_02) | the leather chesterfield |
| mid_century_lounge_chair | [Mid Century Lounge Chair](https://polyhaven.com/a/mid_century_lounge_chair) | the lounge chair |
| modern_arm_chair_01 | [Modern Arm Chair 01](https://polyhaven.com/a/modern_arm_chair_01) | the leather armchair |
| industrial_coffee_table | [Industrial Coffee Table](https://polyhaven.com/a/industrial_coffee_table) | the coffee table |
| side_table_01 | [Side Table 01](https://polyhaven.com/a/side_table_01) | the side table |
| metal_stool_02 | [Metal Stool 02](https://polyhaven.com/a/metal_stool_02) | the shop stools |
| potted_plant_02 | [Potted Plant 02](https://polyhaven.com/a/potted_plant_02) | the big-leaf plants |
| potted_plant_04 | [Potted Plant 04](https://polyhaven.com/a/potted_plant_04) | the succulents |
| hanging_industrial_lamp | [Hanging Industrial Lamp](https://polyhaven.com/a/hanging_industrial_lamp) | the factory pendants |
| worn_metal_rack | [Worn Metal Rack](https://polyhaven.com/a/worn_metal_rack) | the metal shelf |
| wooden_bookshelf_worn | [Wooden Bookshelf Worn](https://polyhaven.com/a/wooden_bookshelf_worn) | the bookshelf |
| cardboard_box_01 | [Cardboard Box 01](https://polyhaven.com/a/cardboard_box_01) | the boxes on the racking |
| plastic_crate_01 | [Plastic Crate 01](https://polyhaven.com/a/plastic_crate_01) | the milk crates |
| wooden_crate_02 | [Wooden Crate 02](https://polyhaven.com/a/wooden_crate_02) | the wooden chest |
| vintage_suitcase | [Vintage Suitcase](https://polyhaven.com/a/vintage_suitcase) | the old suitcases |
| boombox | [Boombox](https://polyhaven.com/a/boombox) | the boombox |

The rest of the room (the shell, trusses, racking, road cases, rugs, posters, lamps, the sign) is built in code in
`src/room/lounge.ts`, on the CC0 photo surfaces in `src/studio/textures/` and `packages/models/textures/`.
