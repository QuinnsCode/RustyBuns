// The dive bar as a player does it: carry both stands and both tops from the door to the stage, set each top on its
// stand, point them at the back wall (the crowd hears their backs: a low score), then turn them round, toe them in
// toward the crowd and away from the bar, raise the stands, and pass. The same calls `window.loadIn` makes.
import { expect, test } from "bun:test";
import { newWorld, pickUp, putDown, type World, walkTo } from "../src/sim.ts";
import { DIVE_BAR, PASS, aim, raise, score, settle, sources } from "../src/venues/dive-bar.ts";

const DEG = Math.PI / 180;

/** Pick `key` up where it is, carry it to stand at (x, z) facing the back wall, and set it down in front of you. */
function carry(w: World, key: string, x: number, z: number) {
  const i = w.items.find((o) => o.key === key)!;
  walkTo(w, i.x, i.z + 0.9);
  w.you.yaw = 0;
  expect(pickUp(w, key)).toEqual({ ok: true });
  walkTo(w, x, z);
  w.you.yaw = 0;
  expect(putDown(w)).toEqual({ ok: true });
  settle(w);
}

test("a silent room scores nothing; tops at the wall score low; aimed at the crowd they pass", () => {
  const w = newWorld(DIVE_BAR), at = (key: string) => w.items.find((i) => i.key === key)!;
  // With no speaker in the room, every cell is silence (-Infinity from levelAt), and silence scores nothing.
  const empty = newWorld({ ...DIVE_BAR, items: [] });
  expect(sources(empty)).toEqual([]);
  expect(score(empty)).toMatchObject({ crowd: null, gap: null, score: 0, pass: false });

  carry(w, "stand-l", -1.7, 2.0);
  carry(w, "stand-r", 1.7, 2.0);
  carry(w, "top-l", -1.7, 1.95);
  carry(w, "top-r", 1.7, 1.95);
  for (const side of ["l", "r"]) {
    expect(at(`top-${side}`)).toMatchObject({ x: at(`stand-${side}`).x, z: at(`stand-${side}`).z, y: 1.2 });
  }

  // Set down facing the way they were carried: their fronts to the back wall.
  for (const key of ["top-l", "top-r"]) {
    walkTo(w, at(key).x * 0.6, 2.2);
    expect(aim(w, key, { turn: Math.PI - at(key).rot })).toEqual({ ok: true });
  }
  const wall = score(w);
  expect(wall.score).toBeLessThan(PASS / 2);

  // Turn them round to the crowd, the left one (by the bar) toed in hard, both stands up to 1.6 m.
  walkTo(w, -1.0, 2.4);
  expect(aim(w, "top-l", { turn: -Math.PI + 30 * DEG })).toEqual({ ok: true });
  expect(raise(w, "stand-l", 1.6)).toEqual({ ok: true });
  walkTo(w, 1.0, 2.4);
  expect(aim(w, "top-r", { turn: -Math.PI })).toEqual({ ok: true });
  expect(raise(w, "stand-r", 1.6)).toEqual({ ok: true });
  expect(at("top-l").y).toBeCloseTo(1.6, 5);

  const aimed = score(w);
  expect(aimed.pass).toBe(true);
  expect(aimed.crowd!).toBeGreaterThan(95);
  expect(aimed.gap!).toBeGreaterThan(4);
  expect(raise(w, "top-r", 1.8)).toEqual({ ok: false, why: '12" powered top isn\'t a stand' });
});
