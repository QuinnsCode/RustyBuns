// Death Valley: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Zabriskie Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const deathValley = streetPark("death-valley", {
  street: { x: -3, z: -23, yaw: 0.785 },
  sky: { x: 147, z: -93, yaw: 0 },
  bowl: { x: 57, z: -123 },
  gap: { at: { x: 98, z: -105, yaw: 5.498 }, run: { x: 147, z: -154 }, land: { x: 62, z: -54 }, rb: 17, min: 38 },
  view: { x: -113, z: 107 },
}, { gap: "Zabriskie Drop", blurb: "Run the dry mudstone benches and leap a badlands gully at Zabriskie Point." });
