// Shenandoah: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Stony Man Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const shenandoah = streetPark("shenandoah", {
  street: { x: -83, z: -23, yaw: 0.785 },
  sky: { x: -3, z: -33, yaw: 1.571 },
  bowl: { x: 17, z: -83 },
  gap: { at: { x: 281, z: 32, yaw: 2.356194490192345 }, run: { x: 232, z: 81 }, land: { x: 316, z: -20 }, rb: 17, min: 38 },
  view: { x: 97, z: 7 },
}, { gap: "Stony Man Leap", blurb: "Skate the Blue Ridge shelf and jump off the cliff edge toward the valley." });
