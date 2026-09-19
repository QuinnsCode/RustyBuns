import { test, expect } from "bun:test";
import { ALL_THINGS, buildRoom, roomSlots } from "../src/levels/room.ts";
import { SceneBuilder } from "../src/levels/scene.ts";

const room = buildRoom();

test("every thing in the room is a findable object with splats", () => {
  expect(room.objects.length).toBe(ALL_THINGS.length);
  expect(room.objects.length).toBeGreaterThanOrEqual(100);
  for (const o of room.objects) {
    expect(o.count).toBeGreaterThan(100);
    expect(o.radius).toBeGreaterThan(0.02);
    expect(Number.isFinite(o.center.x + o.center.y + o.center.z)).toBe(true);
  }
});

test("names and aliases are unique across the room", () => {
  const names = room.objects.flatMap((o) => [o.name, ...o.aliases]);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  // aliases like "plant" or "cone" may repeat, but never a primary name
  expect(room.objects.map((o) => o.name).filter((n, i, a) => a.indexOf(n) !== i)).toEqual([]);
  expect(dupes.every((n) => !room.objects.some((o) => o.name === n))).toBe(true);
});

test("object splat ranges don't overlap and cover every tagged splat", () => {
  const sorted = [...room.objects].sort((a, b) => a.first - b.first);
  let tagged = 0;
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i]!.first).toBeGreaterThanOrEqual(sorted[i - 1]!.first + sorted[i - 1]!.count);
  }
  for (const o of sorted) {
    tagged += o.count;
    for (const j of [o.first, o.first + o.count - 1]) expect(room.itemOf[j]).toBe(o.id);
  }
  expect(room.itemOf.filter((v) => v >= 0).length).toBe(tagged);
});

test("objects sit apart, so picking one doesn't hit its neighbour", () => {
  for (const a of room.objects) {
    for (const b of room.objects) {
      if (a.id >= b.id) continue;
      const gap = a.center.distanceTo(b.center);
      if (gap < (a.radius + b.radius) * 0.55) throw new Error(`${a.name} and ${b.name} overlap (gap ${gap.toFixed(2)})`);
    }
  }
});

test("everything is in front of the camera and above the floor", () => {
  for (const o of room.objects) {
    expect(o.center.y).toBeGreaterThan(-0.05);   // things sit on the floor too
    expect(o.center.z).toBeGreaterThan(-2.7);
    expect(Math.abs(o.center.x)).toBeLessThan(3.6);
  }
});

test("the room is deterministic and a reasonable size", () => {
  expect(room.count).toBe(buildRoom().count);
  expect(room.count).toBeGreaterThan(50_000);
  expect(room.count).toBeLessThan(900_000);
});

test("scenery is untagged, so it can't be picked", () => {
  const b = new SceneBuilder();
  expect(b.scenery()).toBe(-1);
  expect(room.itemOf.some((v) => v === -1)).toBe(true);
});

test("there are more slots than things, so a shuffle leaves different gaps", async () => {
  const { rng } = await import("../src/levels/kit.ts");
  expect(roomSlots(rng(1)).length).toBeGreaterThan(ALL_THINGS.length);
});

test("shuffling moves things and keeps them apart", async () => {
  const { placeObjects, shuffled } = await import("../src/levels/scene.ts");
  const { rng } = await import("../src/levels/kit.ts");
  const r = buildRoom();
  const before = r.objects.map((o) => o.origin.clone());
  const firstSplat = r.objects.map((o) => [r.centers[o.first * 3]!, r.centers[o.first * 3 + 1]!, r.centers[o.first * 3 + 2]!]);
  const rand = rng(7);
  placeObjects(r, shuffled(roomSlots(rand), rand));
  // most things moved
  const moved = r.objects.filter((o, i) => o.origin.distanceTo(before[i]!) > 0.01).length;
  expect(moved).toBeGreaterThan(r.objects.length * 0.9);
  // splats moved with their object, keeping its shape
  r.objects.forEach((o, i) => {
    const shift = o.origin.clone().sub(before[i]!);
    expect(r.centers[o.first * 3]!).toBeCloseTo(firstSplat[i]![0]! + shift.x, 5);
    expect(r.centers[o.first * 3 + 2]!).toBeCloseTo(firstSplat[i]![2]! + shift.z, 5);
  });
  // and nothing landed on top of anything else
  for (const a of r.objects) for (const c of r.objects) {
    if (a.id >= c.id) continue;
    expect(a.center.distanceTo(c.center)).toBeGreaterThan((a.radius + c.radius) * 0.5);
  }
});
