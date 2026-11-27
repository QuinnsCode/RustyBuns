// Strike at the dive bar, as a roadie does it at the end of the night: pull the power cable out of the top and coil it
// back into the case (two loops the same way: two twists to work out at the next show), pack every piece into the truck
// front to back, leave one with a gap in front of it (it slides), and shut the truck after curfew (the fine). The same
// calls `window.loadIn` makes.
import { afterEach, expect, test } from "bun:test";
import { setDial } from "../src/assists.ts";
import { LOOP_S, coil, loop, loopsFor, newCables, plug, settle, takeCable, unplug, walkWith, type Way } from "../src/cables/cables.ts";
import { dims, newWorld, pickUp, putDown } from "../src/sim.ts";
import { DIVE_BAR } from "../src/venues/dive-bar.ts";
import { inTruck, shut, stow, strike, strikeState } from "../src/strike.ts";
import { DESERT } from "../src/venues/desert.ts";
import { ARENA, POINTS, fly, lower, send, wait } from "../src/venues/arena.ts";
import { SMALL_ARENA } from "../src/venues/small-arena.ts";
import { SHOW } from "../src/venues/show.ts";

// The dial is shared by every test file in the run: leave it on Sim.
afterEach(() => { setDial("sim"); });

test("unplug and coil over-under, pack the truck front to back, shut it past curfew", () => {
  setDial("sim");
  const w = newWorld(DIVE_BAR), c = newCables(w), t = DIVE_BAR.truck!, at = (k: string) => w.items.find((i) => i.key === k)!;

  // The show's power run: its wall plug in the bar's outlet.
  walkWith(w, c, -1.6, 10.8);
  expect(takeCable(w, c, "power")).toEqual({ ok: true });
  walkWith(w, c, -2.0, 4.8);
  expect(plug(w, c, "bar-outlet", "power-out-1")).toEqual({ ok: true });

  // The show is over.
  expect(strike(w)).toEqual({ ok: true });
  expect(shut(w, c)).toEqual({ ok: false, why: "a cable is still out (power-10)" });

  // Unplug, back to the case, and coil it: over, under... but twice the hand goes the same way.
  expect(unplug(w, c, "bar-outlet", "power-out-1")).toEqual({ ok: true });
  walkWith(w, c, -1.6, 10.8);
  expect(coil(w, c, "power-10")).toEqual({ ok: true });
  const run = c.runs.find((r) => r.key === "power-10")!, n = loopsFor(run);
  const ways: Way[] = Array.from({ length: n }, (_, k) => (k % 2 ? "under" : "over"));
  ways[3] = "over"; ways[4] = "over"; // over, under, over, OVER, OVER, ...: loops 3 and 4 each repeat the one before
  expect(loop(w, c, ways[0]!)).toEqual({ ok: true });
  expect(loop(w, c, ways[1]!)).toEqual({ ok: false, why: "steady: one loop at a time" });
  for (const way of ways.slice(1)) { settle(w, c, LOOP_S); expect(loop(w, c, way)).toEqual({ ok: true }); }
  expect(run.rope).toBeNull();
  expect(strikeState(w, c)).toMatchObject({ cables: [], twists: 2, untangle: 30 });

  // Pack front to back: hold each piece facing the cab and set it down just behind what's already in its lane. The
  // shove takes it the last few centimetres to touch.
  const front = (x: number, half: number) => Math.min(t.z1, ...w.items.filter((i) => i.key !== w.held?.key && inTruck(t, i) && Math.abs(i.x - x) < half + dims(i)[0] / 2 && i.y < 0.01).map((i) => i.z - dims(i)[2] / 2));
  function pack(key: string, x: number, gap = 0.1) {
    const i = at(key);
    walkWith(w, c, i.x, i.z + 0.8);
    w.you.yaw = Math.PI;
    expect(pickUp(w, key)).toEqual({ ok: true });
    const [iw, , d] = dims(i);
    walkWith(w, c, x, 13.0);
    walkWith(w, c, x, front(x, iw / 2) - gap - d - 0.3);
    w.you.yaw = Math.PI;
    expect(putDown(w)).toEqual({ ok: true });
    stow(w, key);
  }
  pack("mixer", 0.7); // off the case first: nothing comes off the bottom of a stack
  pack("stand-r", 0.5); // the one by the door first: it boxes the other in
  pack("stand-l", -0.6);
  pack("sub", -0.7);
  pack("case-1", 0.0);
  pack("case-2", 0.7);
  pack("top-l", -0.7);
  pack("top-r", 0.1, 0.5); // half a metre short of the case in front: more than a shove closes

  const s = strikeState(w, c)!;
  expect(s.out).toEqual([]);
  expect(s.sliding).toEqual(["top-r"]);

  // Standing in the truck the door won't come down; out on the street it does, a few minutes past curfew.
  expect(shut(w, c)).toEqual({ ok: false, why: "step out of the truck first" });
  walkWith(w, c, 0, 13.2);
  settle(w, c, Math.max(0, 360 + 150 - s.since));
  const r = shut(w, c);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.tally).toMatchObject({ sliding: ["top-r"], twists: 2, untangle: 30, fine: 75 });
  expect(r.tally.late).toBeGreaterThan(120);
});

test("the venues that came after it load out too: a truck you can walk into, and a curfew", () => {
  setDial("sim");
  for (const level of [DESERT, ARENA, SMALL_ARENA, SHOW]) {
    const w = newWorld(level), c = newCables(w), t = level.truck!;
    expect(level.bounds.z1).toBeGreaterThanOrEqual(t.z1 - 0.25 - 1e-6);
    expect(w.you.z).toBeLessThan(t.z0);
    expect(strike(w)).toEqual({ ok: true });
    expect(strikeState(w, c)!.curfew.left).toBeGreaterThan(0);
  }
});

test("the big arena struck: the hang lowered before its boxes go, and the crew packs the trailer", () => {
  setDial("crew");
  const w = newWorld(ARENA), c = newCables(w), t = ARENA.truck!, main = POINTS.find((p) => p.key === "main-l")!;
  for (const k of [1, 2, 3, 4]) expect(send(w, `box-${k}`, "main-l")).toEqual({ ok: true });
  wait(w, 600);
  walkWith(w, c, main.x, main.z + 2.5);
  expect(fly(w, "main-l")).toEqual({ ok: true });

  expect(strike(w)).toEqual({ ok: true });
  expect(send(w, "box-1", { x: 0, z: 60 })).toEqual({ ok: false, why: "it's flown on main-l" });
  expect(shut(w, c)).toEqual({ ok: false, why: "still up on a hang: lower it and take the boxes off first (box-1, box-2, box-3, box-4)" });
  expect(lower(w, "main-l")).toEqual({ ok: true });
  expect(strikeState(w, c)!.aloft).toEqual([]);

  // Front to back, a row at a time: two lanes of boxes four high, then the subs two high behind them.
  const rows: [string[], number][] = [
    [[1, 2, 3, 4, 5, 6, 7, 8].map((k) => `box-${k}`), t.z1 - 0.3],
    [[9, 10, 11, 12, 13, 14, 15, 16].map((k) => `box-${k}`), t.z1 - 0.55 - 0.4],
    [["sub-1", "sub-2", "sub-3", "sub-4"], t.z1 - 1.1 - 0.53],
  ];
  for (const [keys, z] of rows) {
    const half = keys.length / 2;
    keys.forEach((k, n) => expect(send(w, k, { x: n < half ? -0.6 : 0.6, z })).toEqual({ ok: true }));
    wait(w, 900);
  }
  walkWith(w, c, 0, 55);
  expect(strikeState(w, c)).toMatchObject({ out: [], sliding: [], crushing: [] });
  const s = shut(w, c);
  expect(s.ok && s.tally.fine).toBe(0);
});
