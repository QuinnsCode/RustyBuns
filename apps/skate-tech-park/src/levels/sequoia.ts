// Sequoia: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Giant Forest Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const sequoia = streetPark("sequoia", {
  street: { x: -43, z: -53, yaw: 0.785 },
  sky: { x: 107, z: -53, yaw: 0 },
  bowl: { x: 37, z: -43 },
  gap: { at: { x: -119, z: -39, yaw: 3.9269908169872414 }, run: { x: -70, z: 10 }, land: { x: -152, z: -91 }, rb: 25, min: 40 },
  view: { x: 17, z: 67 },
}, { gap: "Giant Forest Gap", blurb: "A street line through the sequoia grove and a launch down the hillside toward the General Sherman Tree." });
