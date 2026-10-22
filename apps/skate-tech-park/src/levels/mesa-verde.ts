// Mesa Verde: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Cliff Palace Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const mesaVerde = streetPark("mesa-verde", {
  street: { x: -43, z: -53, yaw: 0.785 },
  sky: { x: -13, z: -83, yaw: 0.785 },
  bowl: { x: 7, z: 67 },
  gap: { at: { x: -105, z: 35, yaw: 0.7853981633974483 }, run: { x: -154, z: -14 }, land: { x: -69, z: 85 }, rb: 29, min: 38 },
  view: { x: 67, z: -63 },
}, { gap: "Cliff Palace Gap", blurb: "Slickrock lines on the mesa top and a jump off the ledge above the cliff dwellings." });
