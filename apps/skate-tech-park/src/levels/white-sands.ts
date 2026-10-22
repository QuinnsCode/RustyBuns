// White Sands: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot),
// with a spawn on level ground facing the signature spot. The dunes are too gentle for a natural lip, so the
// Alkali Flat Drop is poured: a kicker, a stretch of nothing, and a landing that runs back down to the gypsum.
import { gap } from "./pieces.ts";
import { streetPark } from "./template.ts";

const hop = gap({ x: 150, z: -100, yaw: 0 }, { name: "Alkali Flat Drop", span: 37, landLen: 27, landH: 1.5, w: 6 });

export const whiteSands = streetPark("white-sands", {
  street: { x: -73, z: -23, yaw: 1.571 },
  sky: { x: -63, z: -63, yaw: 1.571 },
  bowl: { x: 7, z: 27 },
  gap: { at: { x: 150, z: -100, yaw: 0 }, run: { x: 150, z: -170 }, land: { x: 150, z: -40 }, rb: 25, min: 40 },
  view: { x: -33, z: 47 },
}, { gap: "Alkali Flat Drop", blurb: "A street line between the dunes and a poured launch over the gypsum toward the white heart of the dune field.", extra: [{ parts: [hop.landing] }] });
