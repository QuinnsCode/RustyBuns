// Biscayne: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot),
// with a spawn on level ground facing the signature spot. The key is level, so the Boca Chita Gap is poured: a
// kicker, a stretch of nothing, and a landing that runs back down to the sand.
import { gap } from "./pieces.ts";
// The ground is nearly level, so a gentler slope counts as a hillside and a cut still stands near a spawn (hillMin).
import { streetPark } from "./template.ts";

const hop = gap({ x: -200, z: -100, yaw: 0 }, { name: "Boca Chita Gap", span: 37, landLen: 27, landH: 1.5, w: 6 });

export const biscayne = streetPark("biscayne", {
  street: { x: -113, z: 27, yaw: 2.356 },
  sky: { x: -123, z: -23, yaw: 2.356 },
  bowl: { x: 37, z: -93 },
  gap: { at: { x: -200, z: -100, yaw: 0 }, run: { x: -200, z: -170 }, land: { x: -200, z: -40 }, rb: 25, min: 40 },
  view: { x: -123, z: 67 },
}, { earthworks: { hillMin: 0.09 }, gap: "Boca Chita Gap", blurb: "A street line along the key's harbour wall and a poured launch over the shallows toward the Boca Chita lighthouse.", extra: [{ parts: [hop.landing] }] });
