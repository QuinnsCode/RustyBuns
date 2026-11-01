import { describe, expect, test } from "bun:test";
import { abduction, ABDUCTION, Director, freeze, HOVER, standoff, sweep, trail } from "../src/director.ts";

const at = { x: 100, y: 4, z: -50 };
/** Steps the director `s` seconds at 60 frames a second; what was said on the way. */
function run(d: Director, s: number, skipAt = -1) {
  const said: string[] = [];
  for (let i = 0; i < Math.round(s * 60); i++) {
    d.step(1 / 60, i === skipAt);
    const c = d.stage.caption, line = c && `${c.who}: ${c.text}`;
    if (line && said.at(-1) !== line) said.push(line);
  }
  return said;
}

describe("the director", () => {
  test("a new journey: the tape, the saucer, a standoff waiting its turn, then a freeze frame", () => {
    const d = new Director();
    d.play(abduction(at));
    // A keeper walked into mid-tape waits behind it.
    d.play(standoff(false, "Wampus Cat", "Keeper of Batsto Village · Lv 2", at, 1.2, 0));
    run(d, 5);
    expect(d.beat?.id).toBe("abduction");
    expect(d.holding).toBe(true);
    expect(d.stage.tape).toBeCloseTo(1);
    expect(d.stage.label).toContain("TAPE 1");
    // The saucer hovers over you with its beam on, and the camera, in somebody's hands, looks up at it.
    expect(d.stage.saucer!.y).toBeGreaterThan(at.y + HOVER - 1);
    expect(d.stage.saucer!.beam).toBeGreaterThan(0.9);
    expect(d.stage.shot!.at.y).toBeGreaterThan(at.y + 10);
    const said = run(d, ABDUCTION - 5 - 0.1);
    expect(said.some((l) => l.startsWith("Totem:"))).toBe(true);
    run(d, 0.2);
    // Then the keeper: its name slams in while the fight waits.
    expect(d.beat?.id).toBe("standoff");
    run(d, 0.5);
    expect(d.stage.title?.text).toBe("Wampus Cat");
    expect(d.stage.bars).toBeGreaterThan(0.9);
    // Any key cuts it to its last moment; the camera has handed the view back by the end.
    run(d, 0.1, 0);
    run(d, 0.5);
    expect(d.beat).toBeNull();
    expect(d.holding).toBe(false);
    expect(d.stage.shot).toBeNull();
    // It goes down: freeze frame, a slow turn, the line, and nothing after.
    d.play(freeze("won", at, 0));
    run(d, 0.5);
    expect(d.stage.freeze).toBe(1);
    expect(d.stage.caption?.text).toMatch(/\w/);
    run(d, 3);
    expect(d.beat).toBeNull();
    expect(d.stage.freeze).toBe(0);
  });

  test("the trail talks without holding you, a held scene cuts it off, and a gag tells once", () => {
    const d = new Director();
    d.play(trail("pine-barrens", 1));
    run(d, 1);
    expect(d.holding).toBe(false);
    expect(d.stage.caption?.text).toContain("tea");
    // A busy director drops another line on the trail.
    expect(d.play(trail("pine-barrens", 2))).toBe(false);
    expect(d.play(sweep(3, at))).toBe(true);
    expect(d.beat?.id).toBe("sweep");
    expect(d.stage.caption).toBeNull();
    run(d, 7.1);
    expect(d.gag("inkSpent")).toBe(true);
    run(d, 3.1);
    expect(d.gag("inkSpent")).toBe(false);
  });
});
