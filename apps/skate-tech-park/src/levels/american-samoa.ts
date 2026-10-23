// American Samoa: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Ofu Ridge Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const americanSamoa = streetPark("american-samoa", {
  street: { x: -53, z: -53, yaw: 0.785 },
  sky: { x: -23, z: -83, yaw: 0.785 },
  bowl: { x: -33, z: 37 },
  gap: { at: { x: 57, z: -197, yaw: 0 }, run: { x: 57, z: -267 }, land: { x: 68, z: -136 }, rb: 27, min: 40 },
  view: { x: -63, z: -3 },
}, { gap: "Ofu Ridge Drop", blurb: "A street line along Ofu Beach and a launch off the foot of the rainforest ridge toward the white sand." });
