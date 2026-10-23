// Black Canyon: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Painted Wall Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
// The slopes are mostly too rough for a hillside work, so a gentler one counts as a hillside and a cut stands near a spawn (hillMin).
import { streetPark } from "./template.ts";

export const blackCanyon = streetPark("black-canyon", {
  street: { x: -73, z: -13, yaw: 1.571 },
  sky: { x: -73, z: 37, yaw: 1.571 },
  bowl: { x: -3, z: -63 },
  gap: { at: { x: -86, z: -143, yaw: 4.71238898038469 }, run: { x: -16, z: -143 }, land: { x: -158, z: -133 }, rb: 25, min: 46 },
  view: { x: 37, z: -53 },
}, { earthworks: { hillMin: 0.06 }, gap: "Painted Wall Gap", blurb: "Build speed on the rim of the Gunnison gorge and launch over the gully before the sheer wall." });
