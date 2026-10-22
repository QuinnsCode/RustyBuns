// Wrangell St Elias: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Kennecott Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const wrangellStElias = streetPark("wrangell-st-elias", {
  street: { x: -23, z: 167, yaw: 0.785 },
  sky: { x: 67, z: -253, yaw: 0.785 },
  bowl: { x: 57, z: 57 },
  gap: { at: { x: -99, z: 72, yaw: 5.497787143782138 }, run: { x: -50, z: 23 }, land: { x: -147, z: 109 }, rb: 22, min: 40 },
  view: { x: -83, z: 47 },
}, { gap: "Kennecott Gap", blurb: "A street line on the gravel flats and a launch off the moraine under the biggest peaks." });
