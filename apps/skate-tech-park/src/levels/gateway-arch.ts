// Gateway Arch: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Grand Staircase Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
// The ground by the spawns is gentle, so a gentler slope counts as a hillside and a cut stands near a spawn (hillMin).
import { streetPark } from "./template.ts";

export const gatewayArch = streetPark("gateway-arch", {
  street: { x: 77, z: -53, yaw: 0 },
  sky: { x: 117, z: -93, yaw: 0 },
  bowl: { x: 47, z: 137 },
  gap: { at: { x: 157, z: -44, yaw: 3.141592653589793 }, run: { x: 157, z: 26 }, land: { x: 164, z: -109 }, rb: 25, min: 42 },
  view: { x: 37, z: 177 },
}, { earthworks: { hillMin: 0.06 }, gap: "Grand Staircase Gap", blurb: "A street line across the riverfront lawn and a launch down the levee steps toward the legs of the Gateway Arch." });
