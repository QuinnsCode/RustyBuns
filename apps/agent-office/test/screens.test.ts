import { expect, test } from "bun:test";
import { codesplitterRoute } from "../codesplitter/server.ts";
import { esterRuns, filePath, helperState, mervinBoard, slots } from "../screens/read.ts";

test("Mervin's screen: his stages in merge order, how sure each is, and the clashes wanting a card", () => {
  const lines = [
    "Mervin's board: 2 PRs onto main abc123456", "",
    "stage 1: #12 Two Fronts: cover", "  4 files, 100% certain   certain 4  agree 0",
    "stage 2: #15 (on #12) Skate rails", "  9 files, 88% certain   certain 8  card 1", "    card    apps/x.ts  both sides",
    "clash file: apps/x.ts  #12 + #15  CARD", "clash file: apps/y.ts  #12 + #15  settled: theirs",
  ];
  expect(mervinBoard(lines)).toEqual({
    stages: [{ pr: 12, title: "Two Fronts: cover", files: 4, certain: 100 }, { pr: 15, title: "Skate rails", files: 9, certain: 88 }],
    clashes: 2, cards: 1,
  });
});

test("Ester's screen: a tile per test run, a rerun's word wins", () => {
  expect(esterRuns(["FAIL  apps/skate: bun test ./test  3.1s", "pass  apps/office: bun test test  0.4s", "pass  apps/skate: bun test ./test  2.0s"]))
    .toEqual([{ ok: true, dir: "apps/skate", cmd: "bun test ./test" }, { ok: true, dir: "apps/office", cmd: "bun test test" }]);
});

test("what comes in is looked at: a helper's run and a file's history, wrong shapes and all", () => {
  expect(helperState({ phase: "running", lines: ["a", 3], hold: [4, "5"], startedAt: 1 })).toEqual({ phase: "running", lines: ["a"], hold: [4], startedAt: 1, endedAt: undefined });
  expect(helperState({ phase: "asleep" })).toEqual({ phase: "idle", lines: [], hold: [] });
  expect(filePath({ path: "a.ts", commits: [{ hash: "b", added: 3, removed: 1, parents: ["x", "y"] }, { hash: "a", added: "lots" }] })?.commits.map((c) => [c.hash, c.added, c.joins]))
    .toEqual([["a", 0, false], ["b", 3, true]]);
  expect(filePath({ error: "no repo" })).toBeNull();
});

test("the three slots stay put across the span, whichever are on", () => {
  expect(slots(-3, 3, 0.3)).toEqual([{ x: -2.1, width: 1.8 }, { x: 0, width: 1.8 }, { x: 2.1, width: 1.8 }].map((s) => ({ ...s, x: expect.closeTo(s.x, 9) })));
});

test("the office hands the screen the repo's busiest files with their histories", async () => {
  const asked: string[] = [];
  const get = (async (u: string) => {
    asked.push(u.replace("https://cs.test/api", ""));
    const p = new URL(u).searchParams.get("path");
    return Response.json(p ? { path: p, commits: [{ hash: p }] } : { files: [{ path: "a.ts", commits: 9 }, { path: "b.ts", commits: 4 }] });
  }) as typeof fetch;
  const route = codesplitterRoute({ url: "https://cs.test" }, get);
  const r = await route("GET", new URL("http://office/__rb/codesplitter/gitpath?repo=o/r"));
  expect(r).toEqual({ status: 200, body: { site: "https://cs.test", repo: "o/r", histories: [{ path: "a.ts", commits: [{ hash: "a.ts" }] }, { path: "b.ts", commits: [{ hash: "b.ts" }] }] } });
  await route("GET", new URL("http://office/__rb/codesplitter/gitpath?repo=o/r"));
  expect(asked).toEqual(["/repos/o/r/gitpath", "/repos/o/r/gitpath?path=a.ts&limit=40", "/repos/o/r/gitpath?path=b.ts&limit=40"]); // the second ask is the cache
  expect((await route("GET", new URL("http://office/__rb/codesplitter/gitpath?repo=nope")))?.status).toBe(400);
});
