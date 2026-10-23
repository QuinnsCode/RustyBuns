// Great Sand Dunes: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Dune Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const greatSandDunes = streetPark("great-sand-dunes", {
  street: { x: 27, z: 17, yaw: 0.785 },
  sky: { x: 37, z: 87, yaw: 0 },
  bowl: { x: 157, z: 77 },
  gap: { at: { x: -66, z: -146, yaw: 0.7853981633974483 }, run: { x: -115, z: -195 }, land: { x: -11, z: -112 }, rb: 23, min: 40 },
  view: { x: 177, z: 27 },
}, { gap: "Dune Drop", blurb: "Pump the dune flats and launch off a slip face toward the valley floor." });
