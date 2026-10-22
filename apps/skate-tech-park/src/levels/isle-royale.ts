// Isle Royale: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Greenstone Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const isleRoyale = streetPark("isle-royale", {
  street: { x: -53, z: -53, yaw: 0.785 },
  sky: { x: -83, z: -23, yaw: 0.785 },
  bowl: { x: 37, z: -33 },
  gap: { at: { x: -41, z: -123, yaw: 1.5707963267948966 }, run: { x: -111, z: -123 }, land: { x: 21, z: -117 }, rb: 22, min: 40 },
  view: { x: 7, z: -63 },
}, { gap: "Greenstone Drop",blurb: "A street line along the shore of Rock Harbor and a launch off the Greenstone Ridge toward the water." });
