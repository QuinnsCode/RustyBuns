// Strike at the dive bar, as a roadie does it at the end of the night: pull the power cable out of the top and coil it
// back into the case (two loops the same way: two twists to work out at the next show), pack every piece into the truck
// front to back, leave one with a gap in front of it (it slides), and shut the truck after curfew (the fine). The same
// calls `window.loadIn` makes.
import { expect, test } from "bun:test";
import { setDial } from "../src/assists.ts";
import { LOOP_S, coil, loop, loopsFor, newCables, plug, settle, takeCable, unplug, walkWith, type Way } from "../src/cables/cables.ts";
import { dims, newWorld, pickUp, putDown, type World } from "../src/sim.ts";
import { DIVE_BAR } from "../src/venues/dive-bar.ts";
import { inTruck, shut, stow, strike, strikeState } from "../src/strike.ts";

test("unplug and coil over-under, pack the truck front to back, shut it past curfew", () => {
  setDial("sim");
  const w = newWorld(DIVE_BAR), c = newCables(w), t = DIVE_BAR.truck!, at = (k: string) => w.items.find((i) => i.key === k)!;

  // The show's power run: case to the left top.
  walkWith(w, c, -1.6, 10.8);
  expect(takeCable(w, c, "power")).toEqual({ ok: true });
  walkWith(w, c, -1.0, 9.7);
  expect(plug(w, c, "top-l", "power-in")).toEqual({ ok: true });

  // The show is over.
  expect(strike(w)).toEqual({ ok: true });
  expect(shut(w, c)).toEqual({ ok: false, why: "a cable is still out (power-10)" });

  // Unplug, back to the case, and coil it: over, under... but twice the hand goes the same way.
  expect(unplug(w, c, "top-l", "power-in")).toEqual({ ok: true });
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
