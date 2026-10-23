// Mount Rainier: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Paradise Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const mountRainier = streetPark("mount-rainier", {
  street: { x: -133, z: -73, yaw: 1.571 },
  sky: { x: 77, z: 97, yaw: 2.356 },
  bowl: { x: -3, z: -3 },
  gap: { at: { x: 47, z: -123, yaw: 1.5707963267948966 }, run: { x: -23, z: -123 }, land: { x: 104, z: -137 }, rb: 21, min: 39 },
  view: { x: -43, z: 87 },
}, { gap: "Paradise Leap", peak: { model: "volcano", tall: 260, y: 47.1 }, blurb: "Meadow lines in the wildflowers on the flank of the mountain, and a jump off a moraine ridge." });
