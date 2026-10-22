// Saguaro: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Cactus Gap built on level ground with the kit, as the ground has no drop), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const saguaro = streetPark("saguaro", {
  street: { x: 27, z: -53, yaw: 0.785 },
  sky: { x: -133, z: -123, yaw: 0.785 },
  bowl: { x: 47, z: 47 },
  gap: { built: { x: -13, z: -153, yaw: 0.785 } },
  view: { x: -83, z: -13 },
}, { gap: "Cactus Gap", blurb: "Level desert under the saguaros: a street line, a bowl and a kicker over a gap built on the flat." });
