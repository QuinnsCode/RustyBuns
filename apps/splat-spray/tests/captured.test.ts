import { expect, test } from "bun:test";
import { buildCaptured, readLabels, readPly, type RawSplats } from "../src/levels/captured.ts";

const box = (x: number, y: number, z: number, s: number) => {
  const [a, b, c] = [[x, y, z], [x + s, y, z], [x + s, y + s, z], [x, y + s, z]] as const;
  const bottom = [a, b, c, [x, y + s, z] as const];
  return [...bottom, ...bottom.map((p) => [p[0], p[1], p[2] + s] as const)].map(([px, py, pz]) => ({ x: px, y: py, z: pz }));
};

/** a floor of 40 splats and a 20-splat mug on it, in the scan's z-up space */
function scan(): RawSplats {
  const n = 60;
  const raw: RawSplats = { count: n, pos: new Float32Array(n * 3), scale: new Float32Array(n * 3).fill(0.02), quat: new Float32Array(n * 4), color: new Float32Array(n * 3).fill(0.5), opacity: new Float32Array(n).fill(1) };
  for (let i = 0; i < n; i++) {
    raw.quat[i * 4 + 3] = 1;
    if (i < 40) raw.pos.set([(i % 8) * 0.5, Math.floor(i / 8) * 0.5, 0], i * 3);
    else raw.pos.set([1 + (i % 4) * 0.02, 1 + (i % 3) * 0.02, 0.1 + (i % 5) * 0.02], i * 3);
  }
  return raw;
}

const labels = readLabels([
  { ins_id: "1", label: "mug", bounding_box: box(0.95, 0.95, 0.05, 0.2) },
  { ins_id: "2", label: "wall", bounding_box: box(0, 0, 0, 4) },
  { ins_id: "3", label: "nonsense" },
  "junk",
]);

test("labels keep what has a name and ignore the rest", () => {
  expect(labels.map((l) => l.label)).toEqual(["mug", "wall", "nonsense"]);
});

test("a splat inside a mug's box is the mug, a wall is never something to find, and the room turns y-up", () => {
  const room = buildCaptured(scan(), labels, { budget: 100 });
  expect(room.objects.map((o) => o.name)).toEqual(["mug"]);
  const mug = room.objects[0]!;
  expect(mug.count).toBe(20);
  expect(room.itemOf.slice(mug.first, mug.first + mug.count).every((v) => v === 0)).toBe(true);
  expect(room.itemOf.filter((v) => v < 0).length).toBe(40);
  // data (1.1, 1.1, 0.15) is (x, z, -y) on screen: the mug is up off the floor and 1.1 m "back"
  expect(mug.center.y).toBeGreaterThan(0.05);
  expect(mug.center.z).toBeLessThan(-0.9);
});

test("a budget drops scenery, never the things to find", () => {
  const room = buildCaptured(scan(), labels, { budget: 25 });
  expect(room.objects[0]!.count).toBe(20);
  expect(room.count).toBe(25);
});

test("something that is not a compressed PLY is refused, not guessed at", () => {
  expect(readPly(new TextEncoder().encode("ply\nformat ascii 1.0\nend_header\n"))).toBeNull();
  expect(readPly(new Uint8Array(10))).toBeNull();
});
