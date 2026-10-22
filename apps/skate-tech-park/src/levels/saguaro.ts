// Saguaro: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Signal Hill Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const saguaro = streetPark("saguaro", {
  street: { x: -3, z: -73, yaw: 0 },
  sky: { x: -43, z: -83, yaw: 0 },
  bowl: { x: 47, z: -13 },
  gap: { at: { x: 61, z: -239, yaw: 3.9269908169872414 }, run: { x: 110, z: -190 }, land: { x: 20, z: -292 }, rb: 22, min: 42 },
  view: { x: 37, z: -53 },
}, { gap: "Signal Hill Drop", blurb: "A street line through the saguaro forest and a launch off a rocky bank toward the petroglyphs on Signal Hill." });
