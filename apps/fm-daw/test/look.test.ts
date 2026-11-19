// How a room looks (src/studio/look.ts): the picture quality a visit gets, and where things stand in it.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { caseSpot, pickQuality, practicals, surface, useKit, type Quality } from "../src/studio/look.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";
import { ROOM_LIST, SCORING_HALL } from "../src/studio/rooms/index.ts";
import { thingBox } from "../src/studio/room.ts";

test("the link picks the quality, then what this browser chose last, else high unless it's a phone", () => {
  const cases: [string, string | null, boolean, Quality][] = [
    ["?quality=low", "high", false, "low"],
    ["?room=x&quality=high", "low", true, "high"],
    ["", "low", false, "low"],
    ["", null, false, "high"],
    ["", null, true, "low"],
    ["?quality=ultra", "nonsense", false, "high"],
  ];
  for (const [search, stored, phone, want] of cases) expect(pickQuality(search, stored, phone)).toBe(want);
});

test("gear surfaces come from the photo-texture kit once it's set, and the room's own surfaces stay as they were", () => {
  const asked: string[] = [];
  useKit((name, color) => {
    asked.push(`${name} ${color}`);
    return name === "tolex" ? new THREE.MeshStandardMaterial({ name: "kit-tolex" }) : null;
  });
  expect(surface("tolex", "#1a1a1b").name).toBe("kit-tolex");
  expect(surface("tolex", "#1a1a1b")).toBe(surface("tolex", "#1a1a1b")); // one material per colour, asked for once
  expect(surface("rubber", "#1a1a1b").name).toBe("rubber"); // the kit hasn't got it: look.ts makes its own
  expect(asked).toEqual(["tolex #1a1a1b", "rubber #1a1a1b"]);
});
test("floor lamps stand in the corners nobody plays in, clear of the booths, and a hall gets none", () => {
  const lamps = practicals(LIVE_ROOM);
  expect(lamps.length).toBe(2);
  for (const [x, z] of lamps) {
    for (const s of LIVE_ROOM.spots) expect(Math.hypot(x - s.at[0], z - s.at[1])).toBeGreaterThan(1.4);
    expect(x < -2.6 && z > 2.4).toBe(false); // not shut in the vocal booth's corner
  }
  expect(practicals(SCORING_HALL)).toEqual([]);
});

test("road cases stand against a free wall in every room, never in a seat's way, at the door or by a lamp", () => {
  let placed = 0;
  for (const def of ROOM_LIST) for (const pick of [0, 0.5, 0.99]) {
    const c = caseSpot(def, pick);
    if (!c) continue;
    placed++;
    const [x, z] = c.at, { w, d } = def.size;
    expect(Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z))).toBeCloseTo(0.38, 5); // its back to an outside wall
    for (const s of def.spots) {
      expect(Math.hypot(x - s.at[0], z - s.at[1])).toBeGreaterThanOrEqual(1.4);
      const b = thingBox(s);
      expect(Math.hypot(x - b.cx, z - b.cz) - Math.max(b.hw, b.hd)).toBeGreaterThanOrEqual(1.4);
    }
    expect(Math.hypot(x - def.door.at[0], z - def.door.at[1])).toBeGreaterThanOrEqual(1.2);
    for (const [lx, lz] of practicals(def)) expect(Math.hypot(x - lx, z - lz)).toBeGreaterThanOrEqual(0.9);
  }
  expect(placed).toBeGreaterThan(0);
  expect(caseSpot(SCORING_HALL, 0.5)).toBeNull(); // a hall too big to notice them
});
