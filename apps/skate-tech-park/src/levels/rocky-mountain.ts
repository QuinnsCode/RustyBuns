// Rocky Mountain: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Hallett Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const rockyMountain = streetPark("rocky-mountain", {
  street: { x: -83, z: 87, yaw: 0.785 },
  sky: { x: -273, z: -63, yaw: 1.571 },
  bowl: { x: 17, z: -53 },
  gap: { at: { x: -88, z: 41, yaw: 2.356194490192345 }, run: { x: -137, z: 90 }, land: { x: -53, z: -25 }, rb: 24, min: 45 },
  view: { x: 67, z: 107 },
}, { gap: "Hallett Leap", blurb: "A line of ramps above Dream Lake, and a jump off the moraine under Hallett Peak." });
