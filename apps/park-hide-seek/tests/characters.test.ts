// The people in the park: every body and outfit a Look can pick builds, stands on the ground and stays in budget; a
// walk plants its feet; a crouch brings the head down; a ranger carries the light on their head.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { makeBigfoot, makeCharacter, pose, type Character } from "../src/ui/characters.ts";
import { BODIES, HATS, parseLook, type Look } from "../src/hunt/game.ts";

const look = (over: Partial<Look> = {}): Look => ({ shirt: 2, pants: 1, skin: 3, hat: "cap", pack: true, body: 0, ...over });

/** A bone's place in the world right now. */
function at(ch: Character, bone: "footR" | "footL" | "head") {
  ch.root.updateMatrixWorld(true);
  return ch.body.bones[bone].getWorldPosition(new THREE.Vector3());
}
/** Walk it for a while, a frame at a time. */
function walk(ch: Character, seconds: number, speed: number, crouch = false, each?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 60) { pose(ch, speed, crouch, 0, 1 / 60); each?.(); }
}

test("every body and hat a look can pick builds, stands on its feet, and a ranger carries the light", () => {
  const all = [...BODIES.map((_, body) => makeCharacter("camper", look({ body, hat: HATS[body % HATS.length]! }), "c")), makeCharacter("ranger", look({ body: 4 }), "r"), makeBigfoot()];
  const heights = new Set<number>();
  for (const ch of all) {
    expect(ch.body.mesh.geometry.index!.count / 3).toBeLessThan(17500);       // the heaviest, a beanie and a face with its nose: about 17,450
    walk(ch, 0.5, 0);
    // standing: both ankles a boot's height off the ground, the head near the top of the body
    for (const foot of ["footR", "footL"] as const) expect(at(ch, foot).y).toBeCloseTo(0.09 * (ch.body.height / 1.75), 2);
    expect(at(ch, "head").y).toBeGreaterThan(ch.body.height * 0.82);
    heights.add(ch.body.height);
  }
  expect(heights.size).toBeGreaterThan(6);                       // bodies differ
  const ranger = all.at(-2)!;
  expect(ranger.light && ranger.beam && ranger.head.children.includes(ranger.light)).toBeTruthy();
  expect(all.at(-1)!.body.height).toBeGreaterThan(2.3);          // Bigfoot is big
});

test("a walking foot stays where it was put down, and a crouch brings the head down", () => {
  const ch = makeCharacter("camper", look({ body: 6 }), "walker");
  walk(ch, 1, 1.4);
  // While a foot is down (its ankle low), it moves back under the body at the body's own speed: in the world, it
  // stays put. Here the figure isn't moved, so a planted foot slides back at 1.4 m/s; a foot swung on a sine doesn't.
  const speeds: number[] = [], down = 0.09 * (ch.body.height / 1.75) + 0.005;
  let last = at(ch, "footR").clone();
  walk(ch, 2, 1.4, false, () => {
    const now = at(ch, "footR");
    if (now.y < down && last.y < down) speeds.push((last.z - now.z) * 60);
    last = now.clone();
  });
  expect(speeds.length).toBeGreaterThan(20);
  const mid = speeds.sort((a, b) => a - b)[speeds.length >> 1]!;
  expect(mid).toBeGreaterThan(1.25);
  expect(mid).toBeLessThan(1.55);

  const standing = at(ch, "head").y;
  walk(ch, 1, 0.8, true);
  expect(at(ch, "head").y).toBeLessThan(standing - 0.35);
  expect(ch.tag.position.y).toBeLessThan(standing + 0.2);       // the name follows the head down
});

test("skin is painted with tone: a camper's skin is many shades, their jacket is not", () => {
  const g = makeCharacter("camper", look({ hat: "none" }), "s").body.mesh.geometry;
  const surface = g.getAttribute("surface"), color = g.getAttribute("color");
  const shades = (kind: number) => {
    const seen = new Set<string>();
    for (let i = 0; i < surface.count; i++) if (surface.getX(i) === kind) seen.add(`${color.getX(i).toFixed(3)},${color.getY(i).toFixed(3)}`);
    return seen.size;
  };
  expect(shades(1)).toBeGreaterThan(40);       // skin: flushed cheeks, shaded sockets
  expect(shades(0)).toBeLessThan(15);          // cloth: one colour a slot
});

test("a look saved before bodies had a pick still loads, with a body of its own", () => {
  const old = parseLook({ shirt: 2, pants: 1, skin: 3, hat: "cap", pack: true });
  expect(old?.body).toBe(parseLook({ shirt: 2, pants: 1, skin: 3, hat: "cap", pack: false })!.body);
  expect(BODIES[old!.body]).toBeDefined();
  expect(parseLook({ ...old, body: 7 })?.body).toBe(7);
  expect(parseLook({ ...old, body: 99 })?.body).toBe(old!.body);
});
