// Joshua Tree: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Skull Rock Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const joshuaTree = streetPark("joshua-tree", {
  street: { x: 47, z: -33, yaw: 0 },
  sky: { x: 87, z: -83, yaw: 0 },
  bowl: { x: -3, z: 57 },
  gap: { at: { x: -88, z: -199, yaw: 2.356194490192345 }, run: { x: -137, z: -150 }, land: { x: -52, z: -247 }, rb: 18, min: 38 },
  view: { x: -63, z: -63 },
}, { gap: "Skull Rock Gap", blurb: "A street line through the boulder fields and a launch off a granite ledge at the end of the wash." });
