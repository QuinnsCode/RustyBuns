// Voyageurs: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Kettle Falls Hop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const voyageurs = streetPark("voyageurs", {
  street: { x: -73, z: -3, yaw: 1.571 },
  sky: { x: -83, z: 37, yaw: 1.571 },
  bowl: { x: -3, z: -53 },
  gap: { at: { x: -133, z: -153, yaw: 0.7853981633974483 }, run: { x: -182, z: -202 }, land: { x: -86, z: -111 }, rb: 22, min: 38 },
  view: { x: 37, z: -43 },
}, { gap: "Kettle Falls Hop",blurb: "A street line along the lakeshore and a hop off the rock bluff toward Kettle Falls and the border water." });
