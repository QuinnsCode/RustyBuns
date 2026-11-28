// What the Stage Builder keeps (stage-build.ts, #6053): saves and orders read back from this browser's storage.
import { expect, test } from "bun:test";
import { keep, latest, lockIn, newArena, openBuild, readStore, startBuild, stepBack } from "../src/studio/stage-build.ts";

test("builds come back from storage with their history; one gone bad is left out and the rest stay", () => {
  const field = newArena({ outdoor: true, w: 200, d: 150 }), renamed = { ...field, name: "renamed" };
  let s = startBuild({ builds: [], orders: [] }, field, 1000);
  s = keep(s, renamed, "renamed", 2000);
  s = keep(s, renamed, "nothing changed", 3000);
  s = lockIn(s, "Friday", 4000);
  const kept = JSON.parse(JSON.stringify(s));
  kept.builds.push({ id: "b-bad", name: "bad", saves: [{ at: 1, note: "x", def: { id: "no" } }] });
  const back = readStore(JSON.stringify(kept));
  expect(back.builds.map((b) => b.saves.map((x) => x.note))).toEqual([["new arena", "renamed"]]);
  expect(back.orders.map((o) => o.name)).toEqual(["Friday"]);
  expect(latest(openBuild(stepBack(back))!).name).toBe(field.name);
  expect(readStore("not json")).toEqual({ builds: [], orders: [] });
});
