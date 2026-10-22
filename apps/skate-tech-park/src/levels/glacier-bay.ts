// Glacier Bay: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Margerie Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const glacierBay = streetPark("glacier-bay", {
  street: { x: -63, z: -43, yaw: 0.785 },
  sky: { x: 17, z: -23, yaw: 2.356 },
  bowl: { x: -13, z: -63 },
  gap: { at: { x: -28, z: 161, yaw: 2.356194490192345 }, run: { x: -77, z: 210 }, land: { x: 7, z: 107 }, rb: 24, min: 39 },
  view: { x: 67, z: -3 },
}, { gap: "Margerie Gap", blurb: "A street line on the moraine above the fjord and a leap toward the blue wall of the glacier." });
