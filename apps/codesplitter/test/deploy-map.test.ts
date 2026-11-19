import { expect, test } from "bun:test";
import { deploySteps, landCells, layout, locate, project, readGraphs, wrapX, type MapGraph } from "../src/deploy-map.ts";

const g: MapGraph[] = [
  { app: "a", nodes: [{ id: "w", kind: "worker", label: "w", location: "sjc" }, { id: "x", kind: "d1", label: "x" }] },
  { app: "b", nodes: [{ id: "box", kind: "box", label: "box", provider: "hetzner", location: "hetzner:fsn1" }, { id: "p", kind: "d1", label: "p", location: "51.5,-0.1" }] },
];

test("a node is placed by colo, region or lat,lon, and left out when it has none", () => {
  expect(locate({ id: "", kind: "", label: "", location: "SJC" })).toEqual([37.4, -121.9]);
  expect(locate({ id: "", kind: "", label: "", location: "nowhere" })).toBeNull();
  expect(locate({ id: "", kind: "", label: "", location: "91,0" })).toBeNull();
  const { dots, unplaced } = layout(g, "locale");
  expect(dots).toHaveLength(3);
  expect(unplaced.map((u) => u.node.id)).toEqual(["x"]);
});

test("the map loops: any drag lands back inside one world", () => {
  expect(wrapX(90, 20, 100)).toBe(10);
  expect(wrapX(5, -20, 100)).toBe(85);
  expect(wrapX(5, -1e6 - 20, 100)).toBeCloseTo(85);
  const [x] = project(0, 180, 360);
  expect(x).toBe(360);
});

test("land is a grid of cells on the map, and bad input is refused", () => {
  const cells = landCells();
  expect(cells.length).toBeGreaterThan(300);
  for (const [lon, lat] of cells) { expect(Math.abs(lon)).toBeLessThanOrEqual(180); expect(lat).toBeLessThanOrEqual(80); }
  expect(readGraphs(g[0])).toHaveLength(1);
  expect(() => readGraphs({ nodes: [] })).toThrow();
});

test("the deploy lane gets one step per node with health, failing when it isn't up", () => {
  const steps = deploySteps([{ app: "a", nodes: [
    { id: "w", kind: "worker", label: "api", health: { status: "up" } },
    { id: "d", kind: "d1", label: "db", health: { status: "degraded", errors: 3 } },
    { id: "b", kind: "box", label: "box", health: { status: "down" } },
    { id: "x", kind: "r2", label: "bucket" },
  ] }]);
  expect(steps).toEqual([
    { lane: "deploy", name: "a/api", state: "ok" },
    { lane: "deploy", name: "a/db degraded", state: "fail" },
    { lane: "deploy", name: "a/box down", state: "fail" },
  ]);
});
