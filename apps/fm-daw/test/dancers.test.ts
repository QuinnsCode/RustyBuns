// The crowd on Desert Gathering's floor (src/studio/dancers.ts): a dozen people in front of the stacks, a pace apart,
// none on a seat, on an instrument or in the way in, the same for everyone.
import { expect, test } from "bun:test";
import { floorSpots } from "../src/studio/dancers.ts";
import { thingBox } from "../src/studio/room.ts";
import { DESERT_GATHERING } from "../src/studio/rooms/desert-gathering.ts";

test("the desert's dancers stand in front of the wall, a pace apart, clear of the seats and the way in", () => {
  const def = DESERT_GATHERING, spots = floorSpots(def, 12, 4319);
  expect(spots.length).toBe(12);
  expect(floorSpots(def, 12, 4319)).toEqual(spots);
  const wallZ = Math.max(...def.outdoor!.stacks.map((s) => s.at[1]));
  for (const p of spots) {
    expect(p.z).toBeGreaterThan(wallZ + 4);
    for (const s of def.spots) {
      const b = thingBox(s);
      expect(Math.hypot(p.x - s.at[0], p.z - s.at[1])).toBeGreaterThan(1.2);
      expect(Math.hypot(p.x - b.cx, p.z - b.cz)).toBeGreaterThan(Math.max(b.hw, b.hd));
    }
    expect(Math.hypot(p.x - def.door.at[0], p.z - def.door.at[1])).toBeGreaterThan(1.5);
    for (const q of spots) if (q !== p) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(0.85);
  }
});
