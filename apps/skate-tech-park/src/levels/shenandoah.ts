// Shenandoah: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Stony Man Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const shenandoah = streetPark("shenandoah", {
  street: { x: -83, z: -23, yaw: 0.785 },
  sky: { x: -3, z: -33, yaw: 1.571 },
  bowl: { x: 87, z: -13 },
  gap: { at: { x: -5, z: -82, yaw: 5.497787143782138 }, run: { x: 44, z: -131 }, land: { x: -42, z: -36 }, rb: 26, min: 39 },
  view: { x: 77, z: -53 },
}, { gap: "Stony Man Leap",blurb: "A street line along the Skyline Drive ridge and a leap off the Blue Ridge cliff toward Stony Man." });
