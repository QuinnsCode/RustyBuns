// The red-rock amphitheatre as a crew does it: fly the rig that worked in the flat arena and hear why it fails here,
// find the roof's limit, then rig it for the bowl (more boxes pinned for the rake, aimed off the rock, the long-throw
// boxes brightened, the subs cardioid, the delay towers up at row 36 in time with the mains) and pass; then a wrong
// delay time comes back as an echo. The same calls `window.loadIn.amphitheatre` makes.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newWorld, walkTo, type World } from "../src/sim.ts";
import { master } from "../src/venues/dive-bar.ts";
import { SPLAYS } from "../src/venues/arena.ts";
import {
  AMPHITHEATRE, POINTS, TOWERS, TOWER_ROW, aim, calc, check, delay, floorAt, fly, hang, pin, rowAt, score, shade, subs, towers, wantDelay,
} from "../src/venues/amphitheatre.ts";

setDefaultTimeout(30_000);

/** At a point's controller in the wing (clear of the hang): hang `n` boxes, pin them, `dress` the hang, check and fly. */
function rigPoint(w: World, key: string, n: number, pins: { tilt: number; splays: number[] } | null, dress = () => {}) {
  const p = POINTS.find((q) => q.key === key)!;
  walkTo(w, p.x - p.side * 4, 4);
  expect(hang(w, key, n)).toEqual({ ok: true });
  const { tilt, splays } = pins ?? calc(w, key)!;
  expect(pin(w, key, tilt, splays)).toEqual({ ok: true });
  dress();
  expect(check(w, key)).toMatchObject({ ok: true });
  expect(fly(w, key)).toEqual({ ok: true });
}

// The flat arena's hang: six boxes, the top one level, the pins between the arena's box angles.
const ARENA_PINS = { tilt: 0, splays: SPLAYS.slice(1).map((a, k) => a - SPLAYS[k]) };

test("the flat arena's rig fails in the bowl, the roof has a limit, the bowl's rig passes, and a wrong delay is an echo", () => {
  const flat = newWorld(AMPHITHEATRE);
  for (const p of POINTS) rigPoint(flat, p.key, 6, ARENA_PINS);
  master(flat, -6);
  const before = score(flat);
  expect(before.pass).toBe(false);
  // Six boxes aimed at a flat floor: the top rows are far, high, quiet and dull in the dry air, the walls slap back,
  // and the plain sub line booms on the stage and carries down the valley.
  const said = before.why.join("\n");
  for (const why of [/top rows are quiet/, /top rows are dull/, /walls slap back/, /stage and the back rock boom/, /houses hear/]) expect(said).toMatch(why);

  const w = newWorld(AMPHITHEATRE);
  // Fourteen boxes is more than the roof takes at one point: the check says so and the motor won't run.
  walkTo(w, -9, 4);
  expect(hang(w, "main-l", 14)).toEqual({ ok: true });
  expect(check(w, "main-l")).toEqual({ ok: false, why: "1175 kg on a 1100 kg point: take boxes off", kg: 1175, limit: 1100 });
  expect(fly(w, "main-l")).toEqual({ ok: false, why: "check the main left point before it flies" });

  // Thirteen, pinned by the calculator from row 70 to row 1, toed in off the rock on the narrow horns, the long-throw
  // third shelved up at 8 kHz.
  for (const p of POINTS) rigPoint(w, p.key, 13, null, () => { expect(aim(w, p.key, 8, "narrow")).toEqual({ ok: true }); shade(w, p.key, 12); });
  // The back row of subs turned, flipped and delayed, at the amps by the lip.
  walkTo(w, -10, 1);
  expect(subs(w, "cardioid")).toEqual({ ok: true });
  // Up the steps to row 36, where the towers go: the benches climb under you.
  expect(towers(w, true)).toEqual({ ok: false, why: `climb to row ${TOWER_ROW}, where the delay towers go` });
  walkTo(w, -12, -10);
  walkTo(w, TOWERS[0].x + 3, TOWERS[0].z);
  expect(rowAt(w.you.z)).toBe(TOWER_ROW);
  expect(floorAt(w.you.x, w.you.z)).toBeGreaterThan(13);
  expect(towers(w, true)).toEqual({ ok: true });
  // Time them to the mains: the path over the speed of sound in the show's 17 C air, and a few ms more.
  delay(w, wantDelay(w));
  shade(w, "towers", 9);
  master(w, -6);
  const after = score(w);
  expect(after.why).toEqual([]);
  expect(after).toMatchObject({ pass: true, parts: { houses: 1, boom: 1, highs: 1 } });
  expect(after.score).toBeGreaterThan(90);

  // The towers left at zero: they speak 190 ms before the mains reach the top half, and the mains come in as an echo.
  delay(w, 0);
  const early = score(w);
  expect(early.pass).toBe(false);
  expect(early.why.join("\n")).toMatch(/delay towers are out of time/);
  expect(early.parts.echo).toBeLessThan(after.parts.echo - 0.3);
});
