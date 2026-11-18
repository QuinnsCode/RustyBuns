// How a room looks (src/studio/look.ts): the picture quality a visit gets, and textures laid out in metres so a
// plank or a ceiling tile comes out the same size on a small wall and a big one.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { cans, caseSpot, metreUV, pickQuality, practicals, surface, useKit, wedges3d, type Quality } from "../src/studio/look.ts";
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

test("a wall's texture runs in metres along it and up it, whatever its size", () => {
  for (const [w, h] of [[2, 3], [26, 13]]) {
    const uv = metreUV(new THREE.BoxGeometry(w, h, 0.12)).getAttribute("uv");
    const us: number[] = [], vs: number[] = [];
    for (let i = 0; i < uv.count; i++) { us.push(uv.getX(i)); vs.push(uv.getY(i)); }
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(w);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(h);
  }
});

test("the downlights sit a metre off the walls of a small room, so they wash them, and spread out in a hall", () => {
  const offWall = (w: number, d: number) => {
    const at = cans(w, d), xs = at.map(([x]) => x), zs = at.map(([, z]) => z);
    return [w / 2 - Math.max(...xs), d / 2 - Math.max(...zs), at.length];
  };
  const [x, z, n] = offWall(10, 9); // the live room
  expect(x).toBeCloseTo(1.1); expect(z).toBeCloseTo(1.1); expect(n).toBe(9);
  const [hx, , hn] = offWall(26, 32); // the scoring hall: three across, each in the middle of its third
  expect(hx).toBeCloseTo(26 / 6); expect(hn).toBe(9);
  expect(cans(2.4, 2.4)).toEqual([[0, 0]]); // a booth: one can, in the middle
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

test("wedge foam is cut as geometry: every face looks out of the wall, and the valleys are darker than the peaks", () => {
  const g = wedges3d(), p = g.getAttribute("position"), n = g.getAttribute("normal"), c = g.getAttribute("color");
  const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
  expect(box.min.z).toBeCloseTo(0); expect(box.max.z).toBeCloseTo(0.06); // back on the wall, 6 cm deep
  expect(box.max.x - box.min.x).toBeCloseTo(0.58);
  const valley: number[] = [], peak: number[] = [];
  for (let i = 0; i < p.count; i++) {
    expect(n.getZ(i)).toBeGreaterThan(-1e-6); // none wound into the wall, where it would vanish from the room
    if (p.getZ(i) > 0.059) peak.push(c.getX(i));
    else if (Math.abs(p.getZ(i) - 0.025) < 1e-6 && n.getZ(i) > 0.1) valley.push(c.getX(i));
  }
  expect(Math.max(...valley)).toBeLessThan(Math.min(...peak));
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
