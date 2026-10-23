// Everglades: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot),
// with a spawn on level ground facing the signature spot. The sawgrass is a hand-width from level, so the Anhinga
// Trail Hop is poured: a kicker, a stretch of nothing, and a landing that runs back down to the marsh.
import { gap } from "./pieces.ts";
// The ground is nearly level, so a gentler slope counts as a hillside and a cut still stands near a spawn (hillMin).
import { streetPark } from "./template.ts";

const hop = gap({ x: 120, z: -60, yaw: 0 }, { name: "Anhinga Trail Hop", span: 37, landLen: 27, landH: 1.5, w: 6 });

export const everglades = streetPark("everglades", {
  street: { x: -53, z: -53, yaw: 0.785 },
  sky: { x: -23, z: -83, yaw: 0.785 },
  bowl: { x: -33, z: 37 },
  gap: { at: { x: 120, z: -60, yaw: 0 }, run: { x: 120, z: -130 }, land: { x: 120, z: 0 }, rb: 25, min: 40 },
  view: { x: -63, z: -3 },
}, { earthworks: { hillMin: 0.04 }, gap: "Anhinga Trail Hop", blurb: "A street line along the boardwalk flats and a poured launch over the slough toward the Anhinga Trail.", extra: [{ parts: [hop.landing] }] });
