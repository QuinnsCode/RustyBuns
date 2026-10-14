import { describe, expect, test } from "bun:test";
import { deleteLearning, learningOn, learningState, recordEvents, setLearning } from "../src/mervin-learning.ts";
import { local as boot } from "../src/local.ts";

type State = { report: { settled: number; asked: number; fighting: { path_hash: string; ext: string; asked: number }[] } };

describe("Mervin learning", () => {
  test("off by default: nothing is kept; on keeps hashed events; delete removes them", async () => {
    const app = await boot({ GH_CLI: "off" });
    const db = app.env;
    const ev = [{ path: "src/a.ts", outcome: "asked" as const }, { path: "docs/b.md", outcome: "settled" as const }];
    await recordEvents(db, "o", "r", ev);
    expect(await learningOn(db, "o", "r")).toBe(false);
    expect(await learningState(db, "o", "r")).toEqual({ learning: false });

    await setLearning(db, "o", "r", true);
    await recordEvents(db, "o", "r", ev);
    await recordEvents(db, "o", "r", [ev[0]]);
    const s = await learningState(db, "o", "r") as State;
    expect(s.report.settled).toBe(1);
    expect(s.report.asked).toBe(2);
    expect(s.report.fighting[0]).toMatchObject({ ext: "ts", asked: 2 });
    expect(s.report.fighting[0].path_hash).not.toContain("a.ts");

    expect(await deleteLearning(db, "o", "r")).toBe(3);
    expect(((await learningState(db, "o", "r")) as State).report.asked).toBe(0);
    await setLearning(db, "o", "r", false);
    expect(await learningOn(db, "o", "r")).toBe(false);
  });
});
