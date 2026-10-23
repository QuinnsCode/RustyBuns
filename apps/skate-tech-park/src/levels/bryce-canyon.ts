// Bryce Canyon: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Hoodoo Hop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const bryceCanyon = streetPark("bryce-canyon", {
  street: { x: -53, z: 57, yaw: 2.356 },
  sky: { x: -83, z: 27, yaw: 2.356 },
  bowl: { x: -63, z: -63 },
  gap: { at: { x: -44, z: 157, yaw: 1.5707963267948966 }, run: { x: -114, z: 157 }, land: { x: 20, z: 165 }, rb: 25, min: 40 },
  view: { x: -23, z: -93 },
}, { gap: "Hoodoo Hop", peak: { model: "hoodoos", tall: 100, y: 9.2 }, blurb: "Build speed along the Sunset Point rim, then jump the first gully into the amphitheater." });
