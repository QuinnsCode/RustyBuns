// Channel Islands: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Island Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const channelIslands = streetPark("channel-islands", {
  street: { x: 7, z: -183, yaw: 0.785 },
  sky: { x: -73, z: -223, yaw: 1.571 },
  bowl: { x: 27, z: -63 },
  gap: { at: { x: 222, z: 82, yaw: 0.7853981633974483 }, run: { x: 173, z: 33 }, land: { x: 252, z: 130 }, rb: 16, min: 36 },
  view: { x: -13, z: -73 },
}, { gap: "Island Gap", blurb: "Grassy ridge lines in the Central Valley of Santa Cruz Island and a jump toward the ocean." });
