import { describe, expect, test } from "bun:test";
import { EXAMPLE_PIPELINE, laneCall, plan, tally, type Change, type Lane, type LaneCall } from "../src/pipeline.ts";
import { local, post } from "./app-kit.ts";

const lane = (name: string) => EXAMPLE_PIPELINE.lanes!.find((l) => l.name === name)!;

describe("laneCall", () => {
  // One row per cadence and the change that tips it: what Ester does with that lane.
  const rows: [string, Lane, Change, LaneCall["go"]][] = [
    ["always, touched", lane("unit"), { files: ["src/a.ts"] }, "run"],
    ["always, not touched", lane("unit"), { files: ["README.md"] }, "skip"],
    ["often, 3rd of 5", lane("stress"), { files: ["src/a.ts"], counts: { stress: 2 } }, "skip"],
    ["often, 5th of 5", lane("stress"), { files: ["src/a.ts"], counts: { stress: 4 } }, "run"],
    ["often, at a release", lane("stress"), { files: [], release: true }, "run"],
    ["release, a normal change", lane("ios"), { files: ["ios/App.swift"] }, "skip"],
    ["release, cutting one", lane("ios"), { files: [], release: true }, "run"],
    ["bus, a seat", lane("docs"), { files: ["docs/a.md"], counts: { docs: 3 } }, "board"],
    ["bus, full", lane("docs"), { files: ["docs/a.md"], counts: { docs: 9 } }, "depart"],
  ];
  test.each(rows)("%s", (_, l, change, go) => expect(laneCall(l, change).go).toBe(go));
});

test("a change down the example road: the stops in order, the hooks that are on, and the counts carried on", () => {
  const steps = plan(EXAMPLE_PIPELINE, { files: ["src/a.ts", "docs/a.md"], counts: { stress: 1, docs: 9 } });
  expect(steps.map((s) => s.at)).toEqual(["branch", "coordinate", "mervin", "before-ester", "ester", "after-ester", "yours"]);
  const ester = steps.find((s) => s.kind === "stop" && s.at === "ester");
  const lanes = ester?.kind === "stop" ? ester.lanes ?? [] : [];
  expect(lanes.map((l) => [l.lane, l.go])).toEqual([["unit", "run"], ["stress", "skip"], ["ios", "skip"], ["docs", "depart"]]);
  expect(lanes.find((l) => l.lane === "docs")?.ai).toBe(true);
  expect(tally({ stress: 1, docs: 9 }, lanes)).toEqual({ unit: 0, stress: 2, docs: 0 });
});

test("a repo's pipeline file sets its road, and a bad one says which field", async () => {
  const call = await local({ GH_CLI: "off" });
  await post(call, "ana", "/api/login", { name: "ana" });
  await post(call, "ana", "/api/repos", { name: "r" });
  const road = async (q: string) => (await call("ana", `/api/repos/ana/r/pipeline?${q}`)).json() as Promise<{ source: string; plan: { at: string }[]; counts: Record<string, number> }>;

  expect((await road("files=a.ts")).source).toBe("default");
  await post(call, "ana", "/api/repos/ana/r/files", { path: "codesplitter.pipeline.json", content: JSON.stringify(EXAMPLE_PIPELINE, null, 2) });
  const r = await road("files=src/a.ts&counts=stress:1");
  expect(r.source).toBe("codesplitter.pipeline.json");
  expect(r.plan.map((s) => s.at)).toContain("before-ester");
  expect(r.counts.stress).toBe(2);

  const bad = await post(call, null, "/api/pipeline", { pipeline: { lanes: [{ name: "x", cadence: "sometimes" }] }, change: { files: [] } });
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: string }).error).toContain("lanes.0.cadence");
});
