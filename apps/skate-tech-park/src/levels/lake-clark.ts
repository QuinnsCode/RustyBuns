// Lake Clark: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Twin Lakes Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const lakeClark = streetPark("lake-clark", {
  street: { x: 27, z: 77, yaw: 1.571 },
  sky: { x: 67, z: 197, yaw: 1.571 },
  bowl: { x: -23, z: 127 },
  gap: { at: { x: -19, z: 81, yaw: 3.9269908169872414 }, run: { x: 30, z: 130 }, land: { x: -54, z: 29 }, rb: 25, min: 39 },
  view: { x: 97, z: 37 },
}, { gap: "Twin Lakes Leap", blurb: "A street line along the shore bench and a launch off the hillside toward the cabin on Twin Lakes." });
