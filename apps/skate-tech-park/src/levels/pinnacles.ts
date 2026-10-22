// Pinnacles: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the High Peaks Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const pinnacles = streetPark("pinnacles", {
  street: { x: -73, z: -83, yaw: 0 },
  sky: { x: -53, z: 107, yaw: 0.785 },
  bowl: { x: 117, z: 207 },
  gap: { at: { x: 59, z: 39, yaw: 3.9269908169872414 }, run: { x: 108, z: 88 }, land: { x: 25, z: -14 }, rb: 20, min: 42 },
  view: { x: -173, z: -213 },
}, { gap: "High Peaks Gap", blurb: "A street line in the volcanic canyon and a leap off the ledge beneath the spires." });
