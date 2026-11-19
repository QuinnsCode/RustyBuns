// The small arena as a crew does it: carry the boxes from the dock and hang them under each point, try one box too many
// and fail the point's check, take it off, set the pins from the calculator, step clear and fly, then the front fills on
// the stage lip and the desk out at front of house. The same calls `window.loadIn` makes.
import { expect, setDefaultTimeout, test } from "bun:test";
import { holdOut, newWorld, pickUp, putDown, walkTo, type World } from "../src/sim.ts";
import { master } from "../src/venues/dive-bar.ts";
import { CLEAR, SMALL_ARENA, arenaState, calc, check, fly, hang, hangsOf, point, pin, score, unhang } from "../src/venues/small-arena.ts";

setDefaultTimeout(60_000);

const item = (w: World, key: string) => w.items.find((i) => i.key === key)!;

/** Walk up to `key` from the house side and pick it up. */
function take(w: World, key: string) {
  const i = item(w, key);
  walkTo(w, i.x, i.z + 0.9);
  w.you.yaw = 0;
  expect(pickUp(w, key)).toEqual({ ok: true });
}

/** Carry each box to under `at` and hang it. */
function hangAll(w: World, at: string, keys: string[]) {
  const p = point(at)!;
  for (const key of keys) {
    take(w, key);
    walkTo(w, p.x, p.z + 0.7);
    expect(hang(w, at)).toEqual({ ok: true });
  }
}

/** Carry `key` and set it down at (x, z) facing `rot`, by way of `via` if something stands in the way. */
function place(w: World, key: string, x: number, z: number, rot = 0, via?: [number, number]) {
  take(w, key);
  if (via) walkTo(w, ...via);
  walkTo(w, x, z + holdOut(item(w, key)));
  w.you.yaw = 0;
  w.held!.rel = rot;
  expect(putDown(w)).toEqual({ ok: true });
}

/** Set the pins from the calculator, check the point, step clear and fly it. */
function rigAndFly(w: World, at: string) {
  const p = point(at)!, c = calc(w, at)!;
  expect(pin(w, at, c.tilt, c.splays)).toEqual({ ok: true });
  expect(check(w, at)).toMatchObject({ ok: true });
  walkTo(w, p.x + Math.sign(-p.x) * (CLEAR + 0.5), p.z - 1.5);
  expect(fly(w, at, c.trim)).toEqual({ ok: true });
}

// Stacks of four, top box last in each list.
const stackOf = (prefix: string, from: number, n: number) => Array.from({ length: n }, (_, k) => `${prefix}-${from + n - k}`);

test("hang the arrays, fail and pass the point's check, fly them clear, fill the front rows and pass at the desk", () => {
  const w = newWorld(SMALL_ARENA);

  // Eight boxes on the main left frame, and one more from the right-hand stacks.
  hangAll(w, "main-l", [...stackOf("main", 0, 4), ...stackOf("main", 4, 4), "main-12"]);
  expect(arenaState(w).points["main-l"]).toMatchObject({ boxes: 9, kg: 382, limit: 350, checked: false });

  // Nine is too many for this steel: the check says so and the motor won't run on an unchecked point.
  expect(check(w, "main-l")).toEqual({ ok: false, why: "382 kg on a 350 kg point: take boxes off", kg: 382, limit: 350 });
  walkTo(w, -3, 29);
  expect(fly(w, "main-l", 10)).toEqual({ ok: false, why: "check the main left point before it flies" });

  // The ninth comes back off, and goes down by the stage.
  walkTo(w, -7, 31.7);
  expect(unhang(w, "main-l")).toEqual({ ok: true });
  walkTo(w, 2, 33.55);
  w.you.yaw = 0;
  expect(putDown(w)).toEqual({ ok: true });

  // The pins from the calculator: the top box aims at the back seats, the bottom ones turn down at the floor, more and more.
  walkTo(w, -7, 31.7);
  const c = calc(w, "main-l")!;
  expect(c.splays).toHaveLength(7);
  expect(c.splays[6]).toBeGreaterThan(c.splays[0]);
  expect(pin(w, "main-l", c.tilt, c.splays)).toEqual({ ok: true });
  expect(check(w, "main-l")).toEqual({ ok: true, kg: 346, limit: 350 });

  // Not while anyone stands under it; clear of it, the motor runs at 4 m a minute.
  expect(fly(w, "main-l", c.trim)).toEqual({ ok: false, why: "stand clear: you're under the main left hang" });
  walkTo(w, -3.5, 29.5);
  const t0 = w.t, quiet = arenaState(w).level.floor!;
  expect(fly(w, "main-l", c.trim)).toEqual({ ok: true });
  expect(w.t - t0).toBeGreaterThan(100);
  const bottom = item(w, hangsOf(w)["main-l"].boxes[7]);
  expect(bottom.y).toBeGreaterThan(6);
  // On the deck the boxes were silent; in the air the floor hears them.
  expect(arenaState(w).level.floor! - quiet).toBeGreaterThan(10);

  // The rest of the hangs: main right, and three boxes on each out-fill for the side seats.
  hangAll(w, "main-r", [...stackOf("main", 8, 3), "main-12", ...stackOf("main", 12, 4)]);
  rigAndFly(w, "main-r");
  hangAll(w, "out-l", stackOf("out", 0, 3));
  rigAndFly(w, "out-l");
  hangAll(w, "out-r", stackOf("out", 3, 3));
  rigAndFly(w, "out-r");
  master(w, -10);

  // The arrays shoot over the front rows and the desk is still at the dock: no pass yet.
  const before = score(w);
  expect(before.covered.front).toBeLessThan(0.3);
  expect(before.covered.floor).toBeGreaterThan(0.9);
  expect(before.pass).toBe(false);

  // Fills on the stage lip facing the house, and the desk out at front of house.
  [-5, -1.7, 1.7, 5].forEach((x, k) => place(w, `fill-${k + 1}`, x, 29.7, Math.PI));
  // The desk sits on its case: round the case, then out to front of house.
  place(w, "desk", 0, 16.5, 0, [1.2, 35]);
  const desk = item(w, "desk");
  expect(Math.hypot(desk.x, desk.z - 16.5)).toBeLessThan(0.1);
  const after = score(w);
  expect(after.covered.front).toBeGreaterThan(0.9);
  expect(after).toMatchObject({ desk: true, pass: true });
});
