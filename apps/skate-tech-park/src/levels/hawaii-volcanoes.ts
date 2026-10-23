// Hawaii Volcanoes: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Caldera Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const hawaiiVolcanoes = streetPark("hawaii-volcanoes", {
  street: { x: -103, z: -13, yaw: 2.356 },
  sky: { x: 7, z: 117, yaw: 2.356 },
  bowl: { x: -3, z: -3 },
  gap: { at: { x: -43, z: 105, yaw: 0 }, run: { x: -43, z: 35 }, land: { x: -34, z: 169 }, rb: 24, min: 43 },
  view: { x: -23, z: 47 },
}, { gap: "Caldera Drop", peak: { model: "volcano", tall: 110, y: 23.3 }, blurb: "Roll the lava benches around Kilauea's caldera and launch over the step down." });
