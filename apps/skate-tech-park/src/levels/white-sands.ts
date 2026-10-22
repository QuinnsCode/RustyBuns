// White Sands: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot),
// with a spawn on level ground facing the signature spot. The dunes are too gentle for a natural lip, so the
// Alkali Flat Drop is poured: a kicker, a stretch of nothing, and a landing that runs back down to the gypsum.
import { gap } from "./pieces.ts";
// The ground is nearly level, so a gentler slope counts as a hillside and a cut still stands near a spawn (hillMin).
import { streetPark } from "./template.ts";

const hop = gap({ x: 150, z: -100, yaw: 0 }, { name: "Alkali Flat Drop", span: 37, landLen: 27, landH: 1.5, w: 6 });

export const whiteSands = streetPark("white-sands", {
  street: { x: 17, z: -63, yaw: 0 },
  sky: { x: -23, z: -73, yaw: 0 },
  bowl: { x: 67, z: -43 },
  gap: { at: { x: 150, z: -100, yaw: 0 }, run: { x: 150, z: -170 }, land: { x: 150, z: -40 }, rb: 25, min: 40 },
  view: { x: 77, z: 27 },
}, { earthworks: { hillMin: 0.06 }, gap: "Alkali Flat Drop",blurb: "A street line between the dunes and a poured launch over the gypsum toward the white heart of the dune field.", extra: [{ parts: [hop.landing] }] });
