// Grand Teton: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Cathedral Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const grandTeton = streetPark("grand-teton", {
  street: { x: -53, z: -53, yaw: 0.785 },
  sky: { x: -23, z: -83, yaw: 0.785 },
  bowl: { x: 67, z: -63 },
  gap: { at: { x: -111, z: -11, yaw: 0.7853981633974483 }, run: { x: -160, z: -60 }, land: { x: -62, z: 28 }, rb: 21, min: 40 },
  view: { x: 27, z: 87 },
}, { gap: "Cathedral Gap", blurb: "Cross the alluvial fan at the mouth of Cascade Canyon and clear the drop below the Cathedral Group." });
