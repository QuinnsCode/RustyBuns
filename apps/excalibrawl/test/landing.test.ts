// The landing plays a fight with no clicks: the newest one that drew on both sides, else the sample.
import { describe, expect, test } from "bun:test";
import { check } from "@rustybuns/util/guard";
import { pickFight, sampleFight } from "../src/app/sample.ts";
import { scenesAt } from "../src/engine/match.ts";
import { Replay, type Summaries } from "../src/live-wire.ts";

const row = (id: string, shapes: number[]): Summaries[number] => ({ id, prompt: "a fox", fighters: [], turns: 24, startedAt: 1, shapes });

describe("landing", () => {
  test("the sample fight draws every line, reads as a replay and ends with both sides drawn", () => {
    const { skipped, ...s } = sampleFight();
    expect(skipped).toEqual([]);
    const replay = check(Replay, JSON.parse(JSON.stringify(s)));
    expect(replay).not.toBeNull();
    const end = scenesAt(replay!, replay!.turns);
    expect(end.map((side) => side.length > 5)).toEqual([true, true]);
    // It builds up turn by turn rather than appearing whole.
    expect(scenesAt(replay!, 1).flat().length).toBeLessThan(end.flat().length);
  });

  test.each([
    ["the newest fight that drew on both sides", [row("m-3", [0, 4]), row("m-2", [3, 5]), row("m-1", [2, 2])], "m-2"],
    ["none when every fight is blank on a side", [row("m-2", [0, 0]), row("m-1", [4, 0])], undefined],
    ["none with no fights yet", [], undefined],
  ])("picks %s", (_name, index, id) => {
    expect(pickFight(index)?.id).toBe(id);
  });
});
