// A person from their avatar: every part an avatar can have builds, stands on the ground and stays in budget; one
// seed is one face; and the poses do what they say (sitting lowers the hips, playing keys puts the hands out front).
import { expect, test } from "bun:test";
import * as THREE from "three";
import { defaultAvatar, PARTS, type Avatar } from "@rustybuns/util/avatar";
import { character } from "../src/character.ts";
import { triangles } from "../src/shapes.ts";

const base = defaultAvatar("Ada");
const box = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const worldOf = (o: THREE.Object3D, name: string) => { const p = new THREE.Vector3(); let hit: THREE.Object3D | undefined; o.traverse((c) => { if (!hit && c.name === name) hit = c; }); return hit!.getWorldPosition(p); };

test("every option of every part builds a person who stands on the ground, 1.4 to 2.2 m tall, under 12k triangles", () => {
  for (const k of Object.keys(PARTS) as (keyof Avatar)[]) for (const v of PARTS[k]) {
    const c = character({ ...base, [k]: v });
    c.pose({ t: 0 });
    const b = box(c.group);
    expect(Math.abs(b.min.y)).toBeLessThan(0.02);
    expect(c.height).toBeGreaterThan(1.4);
    expect(c.height).toBeLessThan(2.2);
    expect(triangles(c.group)).toBeLessThan(12_000);
    c.dispose();
  }
});

test("one seed is one face; sitting lowers the hips, keys bring the hands out in front, walking moves the feet", () => {
  const pos = (c: ReturnType<typeof character>) => { const out: number[] = []; c.group.traverse((o) => { if (o instanceof THREE.Mesh) out.push(...o.geometry.attributes.position!.array.slice(0, 30)); }); return out; };
  expect(pos(character(base, 4))).toEqual(pos(character(base, 4)));
  expect(pos(character(base, 4))).not.toEqual(pos(character(base, 5)));

  const c = character(base);
  c.pose({ t: 0 });
  const standing = box(c.group).max.y, palmStanding = worldOf(c.group, "palm");
  c.pose({ t: 0, seated: true, play: "keys" });
  expect(box(c.group).max.y).toBeLessThan(standing - 0.25);
  const palm = worldOf(c.group, "palm");
  // it faces -z: the hands are well in front of where they hang, and above the lap
  expect(palm.z).toBeLessThan(palmStanding.z - 0.2);
  expect(palm.y).toBeGreaterThan(0.5);

  const feet = (t: number) => { c.pose({ t, walk: 1.4 }); return worldOf(c.group, "shoe").z; };
  expect(Math.abs(feet(0.1) - feet(0.5))).toBeGreaterThan(0.1);
});
