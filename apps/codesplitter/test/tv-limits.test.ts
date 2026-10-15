import { expect, test } from "bun:test";
import { beads, BOUNDS, foldLanes, glowOnly, logShare, parseLimits, PRESETS, pulse, shownLanes, smooth } from "../src/tv-limits.ts";
import { sharedGraph, GRAPH_MAX, type Graph } from "../src/graph.ts";

test("untouched or broken settings give the calm preset, and values are held to their bounds", () => {
  expect(parseLimits(null)).toEqual(PRESETS.calm);
  expect(parseLimits("{not json")).toEqual(PRESETS.calm);
  expect(parseLimits('{"preset":"firehose"}')).toEqual(PRESETS.firehose);
  const l = parseLimits('{"maxLanes":99999,"smoothSecs":-3,"minLines":"x"}');
  expect(l.maxLanes).toBe(BOUNDS.maxLanes[1]);
  expect(l.smoothSecs).toBe(BOUNDS.smoothSecs[0]);
  expect(l.minLines).toBe(PRESETS.calm.minLines);
});

test("logShare gives the first few full detail and flattens the flood", () => {
  expect(logShare(0, 10)).toBe(0);
  expect(logShare(3, 10)).toBeLessThan(logShare(8, 10));
  expect(logShare(10000, 10)).toBe(10);
  expect(logShare(1, 10)).toBeGreaterThanOrEqual(1);
});

test("10,000 lanes fold into the busiest few and one +N more lane with a heat", () => {
  const lanes = Array.from({ length: 10_000 }, (_, i) => ({ name: `b${i}`, lines: 1 + (i % 7), at: i }));
  const s = shownLanes(lanes, { ...PRESETS.calm, minLines: 2 });
  expect(s.lanes).toHaveLength(PRESETS.calm.maxLanes);
  expect(s.lanes.every((x) => x.lines >= 2)).toBe(true);
  expect(s.folded!.count + s.lanes.length).toBe(lanes.filter((x) => x.lines >= 2).length);
  expect(s.folded!.heat).toBeGreaterThan(0.9);
  expect(shownLanes(lanes.slice(0, 3), PRESETS.calm).folded).toBeNull();
});

test("a burst reads as one swell and one fat bead", () => {
  let v = 0;
  v = smooth(v, 500, 1, 4);
  expect(v).toBeGreaterThan(0);
  expect(v).toBeLessThan(500 / 2);
  expect(smooth(v, 0, 10, 4)).toBeLessThan(v);
  expect(smooth(7, 100, 1, 0)).toBe(100);
  expect(beads(500, 5)).toEqual({ count: 5, size: 100 });
  expect(beads(0, 5)).toEqual({ count: 0, size: 0 });
  expect(glowOnly(PRESETS.calm.maxLines + 1, PRESETS.calm)).toBe(true);
});

test("requests that arrive during a walk share it, capped per request, and nothing is kept after", async () => {
  let walks = 0, last = 0;
  const walk = async (n: number): Promise<Graph> => { walks++; last = n; await Promise.resolve(); return { branch: "main", commits: [], more: false, upstream: null }; };
  await Promise.all(Array.from({ length: 1000 }, () => sharedGraph("a/b", walk, 99999)));
  expect(walks).toBe(1);
  expect(last).toBe(GRAPH_MAX);
  await sharedGraph("a/b", walk, 60);
  expect(walks).toBe(2);
});

test("lanes past the cap share one folded lane, and a calm vein stays as it was", () => {
  const dots = [0, 1, 2, 3, 4, 5].map((lane) => ({ lane }));
  const edges = [{ l1: 0, l2: 5 }, { l1: 3, l2: 4 }];
  const f = foldLanes(dots, edges, 6, 3);
  expect(f.lanes).toBe(4);
  expect(f.dots.map((d) => d.lane)).toEqual([0, 1, 2, 3, 3, 3]);
  expect(f.edges).toEqual([{ l1: 0, l2: 3 }, { l1: 3, l2: 3 }]);
  expect(f.folded).toBe(3);
  expect(foldLanes(dots, edges, 6, 12)).toMatchObject({ lanes: 6, folded: 0 });
});

test("a landing is floored, merged into a few beads, or drops to a glow past the ceiling", () => {
  const l = { ...PRESETS.calm, minLines: 2, maxLines: 100 };
  expect(pulse(1, 0, 1, l).glow).toBe(0);
  const merged = pulse(60, 0, 1, l);
  expect(merged.beads.count).toBeLessThanOrEqual(6);
  expect(merged.beads.count * merged.beads.size).toBeGreaterThanOrEqual(60);
  const flood = pulse(500, 0, 1, l);
  expect(flood.beads.count).toBe(0);
  expect(flood.glow).toBeGreaterThan(0);
  expect(pulse(500, 0, 1, { ...l, smoothSecs: 60 }).swell).toBeLessThan(flood.swell);
});
