// Petrified Forest: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Blue Mesa Hop built on level ground with the kit, as the ground has no drop), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const petrifiedForest = streetPark("petrified-forest", {
  street: { x: -143, z: -113, yaw: 0 },
  sky: { x: -103, z: -183, yaw: 0 },
  bowl: { x: -223, z: 17 },
  gap: { built: { x: -53, z: -233, yaw: 0 } },
  view: { x: -133, z: 187 },
}, { gap: "Blue Mesa Hop", blurb: "Flat striped badlands: a street line, a bowl, and a kicker over a gap built on the level clay." });
