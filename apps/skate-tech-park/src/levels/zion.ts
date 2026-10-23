// Zion: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Angels Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const zion = streetPark("zion", {
  street: { x: 17, z: 127, yaw: 2.356 },
  sky: { x: -13, z: -213, yaw: 0 },
  bowl: { x: 157, z: -13 },
  gap: { at: { x: 177, z: 203, yaw: 3.141592653589793 }, run: { x: 177, z: 273 }, land: { x: 167, z: 111 }, rb: 38, min: 60 },
  view: { x: -43, z: 157 },
}, { gap: "Angels Drop", peak: { model: "mesa", tall: 150, y: 11.8 }, blurb: "Roll the canyon floor, then launch off the lip and drop to the valley below the fin of Angels Landing." });
