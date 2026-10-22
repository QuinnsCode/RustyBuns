// Crater Lake: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Rim Jump on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const craterLake = streetPark("crater-lake", {
  street: { x: 17, z: -83, yaw: 0 },
  sky: { x: 57, z: -73, yaw: 0 },
  bowl: { x: 107, z: -3 },
  gap: { at: { x: -179, z: -19, yaw: 3.9269908169872414 }, run: { x: -130, z: 30 }, land: { x: -215, z: -71 }, rb: 22, min: 41 },
  view: { x: 97, z: 37 },
}, { gap: "Rim Jump", blurb: "Roll the caldera rim and leap down onto the slope above the blue water." });
