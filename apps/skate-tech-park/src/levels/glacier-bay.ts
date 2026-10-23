// Glacier Bay: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Margerie Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const glacierBay = streetPark("glacier-bay", {
  street: { x: 7, z: -23, yaw: 2.356 },
  sky: { x: -53, z: -53, yaw: 2.356 },
  bowl: { x: 67, z: -3 },
  gap: { at: { x: -33, z: 166, yaw: 2.356194490192345 }, run: { x: -82, z: 215 }, land: { x: 6, z: 107 }, rb: 24, min: 44 },
  view: { x: 87, z: -43 },
}, { gap: "Margerie Leap", blurb: "A street line along the moraine at the head of Tarr Inlet and a launch off the bluff toward the calving face of Margerie Glacier." });
