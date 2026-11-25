import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkStory } from "../src/story/check.ts";
import { plotsData } from "../scripts/plots.ts";

test("the plot lines page holds every thread and beat, each on the road, waiting only on real threads", () => {
  const r = checkStory(JSON.parse(readFileSync(join(import.meta.dir, "../content/story.json"), "utf8")) as unknown);
  const d = plotsData(r);
  expect(d.items.map((m) => m.id)).toEqual(r.arcs.map((a) => a.id));
  const beats = d.items.flatMap((m) => m.beats);
  expect(beats.length).toBe(r.beats.length);
  for (const b of beats) {
    expect(b.col).toBeGreaterThanOrEqual(0);
    expect(b.col).toBeLessThan(d.regions.length);
  }
  const ids = new Set(d.items.map((m) => m.id));
  for (const m of d.items) for (const t of m.ties) expect(ids.has(t) && t !== m.id).toBe(true);
});
