// The names printed beside each jack on a lit panel (src/faces.ts), read the way a real panel prints them.
import { expect, test } from "bun:test";
import { jackLabel } from "../src/faces.ts";

test("a lit panel names its jacks the way a real one prints them", () => {
  for (const [id, name] of [["power-in", "POWER IN"], ["xlr-in-3", "XLR IN 3"], ["speaker-out-1", "SPK OUT 1"], ["inst-in", "INPUT"], ["line-out-2", "LINE OUT 2"]]) {
    expect(jackLabel(id)).toBe(name);
  }
});
