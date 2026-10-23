// Channel Islands: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Scorpion Anchorage Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const channelIslands = streetPark("channel-islands", {
  street: { x: -3, z: -133, yaw: 0.785 },
  sky: { x: 47, z: -143, yaw: 0.785 },
  bowl: { x: -63, z: 87 },
  gap: { at: { x: -19, z: 41, yaw: 3.9269908169872414 }, run: { x: 30, z: 90 }, land: { x: -74, z: 4 }, rb: 22, min: 40 },
  view: { x: -43, z: 127 },
}, { gap: "Scorpion Anchorage Drop", blurb: "A street line across the grassy terrace above Scorpion Anchorage and a launch off the bluff toward the cobble cove." });
