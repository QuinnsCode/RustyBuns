import { describe, expect, test } from "bun:test";
import { answerRows, fightRows, fightWeights, suggestions } from "../src/mervin-learn.ts";
import { deleteLearning, hashesPaths, pathKey, learningOn, learningState, recordEvents, setLearning } from "../src/mervin-learning.ts";
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

  test("asked events feed the learn queries; hash_paths off keeps the plain path", async () => {
    const app = await boot({ GH_CLI: "off" });
    const db = app.env;
    await setLearning(db, "o", "r", true);
    expect(await hashesPaths(db, "o", "r")).toBe(true);
    const ask = { path: "package.json", outcome: "asked" as const, answer: "main" };
    await recordEvents(db, "o", "r", [ask, ask, ask, { path: "x.ts", outcome: "settled" }]);
    expect(await fightRows(db, "o", "r")).toEqual([{ ext: "json", path_hash: await pathKey("o", "r", "package.json"), fights: 3 }]);
    const rules = suggestions(await answerRows(db, "o", "r"));
    expect(rules).toMatchObject([{ path_hash: await pathKey("o", "r", "package.json"), rule: "merge=ours", n: 3 }]);
    expect(fightWeights(await fightRows(db, "o", "r")).ext.get("json")).toBe(3);

    await deleteLearning(db, "o", "r");
    await setLearning(db, "o", "r", true, false);
    expect(await hashesPaths(db, "o", "r")).toBe(false);
    await recordEvents(db, "o", "r", [ask]);
    expect((await fightRows(db, "o", "r"))[0]!.path_hash).toBe("package.json");
  });
});
