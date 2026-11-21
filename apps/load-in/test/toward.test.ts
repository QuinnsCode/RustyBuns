import { expect, test } from "bun:test";
import { toward } from "../src/toward.ts";

test("the arrow shows only when the Next piece is out of view, and points the way to turn", () => {
  const rows: [string, { x: number; y: number }, boolean, "none" | "left" | "right" | "down"][] = [
    ["in the middle of the screen", { x: 0.1, y: -0.2 }, false, "none"],
    ["off the left edge", { x: -1.6, y: 0.1 }, false, "left"],
    ["in the left rim, behind the door frame", { x: -0.95, y: -0.3 }, false, "left"],
    ["at your feet", { x: 0.2, y: -2.5 }, false, "down"],
    ["behind you on the left (the projection flips)", { x: 0.4, y: 0.7 }, true, "left"],
    ["behind you on the right", { x: -0.4, y: -0.7 }, true, "right"],
  ];
  for (const [what, ndc, behind, want] of rows) {
    const a = toward(ndc, behind);
    const got = !a ? "none" : a.x < 0.2 ? "left" : a.x > 0.8 ? "right" : a.y > 0.8 ? "down" : "other";
    expect([what, got]).toEqual([what, want]);
    if (a) expect(Math.abs(Math.cos((a.deg * Math.PI) / 180)) > 0.5 ? (Math.cos((a.deg * Math.PI) / 180) < 0 ? "left" : "right") : "down").toBe(want);
  }
});
