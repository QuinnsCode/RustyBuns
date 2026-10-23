// Wind Cave: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Prairie Breath Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const windCave = streetPark("wind-cave", {
  street: { x: 37, z: -163, yaw: 0 },
  sky: { x: -223, z: -103, yaw: 0.785 },
  bowl: { x: 87, z: -103 },
  gap: { at: { x: -23, z: 130, yaw: 3.141592653589793 }, run: { x: -23, z: 200 }, land: { x: -34, z: 70 }, rb: 22, min: 41 },
  view: { x: 77, z: -143 },
}, { gap: "Prairie Breath Drop",blurb: "A street line across the prairie flat and a launch off the hillside toward the breathing natural entrance." });
