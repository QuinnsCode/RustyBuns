import { expect, test } from "bun:test";
import { clockText, events, Player, readRound, view, type Round } from "../src/mervin-replay.ts";

const round: Round = {
  board: { stages: [
    { pr: 1, title: "one", files: [{ path: "a.ts", tier: "certain" }, { path: "b.ts", tier: "agree" }] },
    { pr: 2, title: "two", stackedOn: 1, files: [{ path: "c.ts", tier: "mervin", why: "line ids" }] },
    { pr: 3, title: "three", files: [{ path: "d.ts", tier: "card" }] },
  ] },
  verdicts: [
    { pr: 1, go: true, wave: 1, why: "clear to merge" },
    { pr: 2, go: true, wave: 2, why: "after #1" },
    { pr: 3, go: false, why: "Mervin asks on d.ts" },
  ],
};

test("held PRs come first, then each wave a PR and a file at a time", () => {
  expect(events(round).map((e) => e.kind)).toEqual(["round", "hold", "wave", "start", "file", "file", "merged", "wave", "start", "file", "merged"]);
});

test("a card file pops a card event", () => {
  const r: Round = { ...round, verdicts: [{ pr: 3, go: true, wave: 1, why: "" }] };
  expect(events(r).map((e) => e.kind)).toEqual(["round", "wave", "start", "file", "card", "merged"]);
});

test("play, pause, speed, step and stop", () => {
  const p = new Player(events(round));
  expect(p.tick(10_000)).toEqual([]); // stopped: nothing moves
  p.play();
  const first = p.tick(1000); // 500 round + 500 hold
  expect(first.map((e) => e.kind)).toEqual(["round", "hold"]);
  p.pause();
  expect(p.tick(10_000)).toEqual([]);
  p.setSpeed(4);
  p.play();
  expect(p.tick(300).length).toBeGreaterThan(0); // 1200 ms of round time
  const at = p.at;
  expect(p.step()).not.toBeNull();
  expect(p.mode).toBe("paused");
  expect(p.at).toBe(at + 1);
  p.stop();
  expect([p.mode, p.at, p.clock]).toEqual(["stopped", 0, 0]);
});

test("speed does not change what plays, only how fast; the clock ends at the total", () => {
  const slow = new Player(events(round)), fast = new Player(events(round));
  fast.setSpeed(16);
  slow.play(); fast.play();
  const a = slow.tick(slow.total), b = fast.tick(fast.total / 16);
  expect(b).toEqual(a);
  expect(fast.mode).toBe("done");
  expect(fast.clock).toBeCloseTo(fast.total, 5);
});

test("the view folds the played events", () => {
  const p = new Player(events(round));
  p.play();
  const v0 = view(round, p.tick(1000));
  expect(v0.prs.map((x) => x.state)).toEqual(["queued", "queued", "held"]);
  const v1 = view(round, [...events(round)]);
  expect(v1.prs.map((x) => x.state)).toEqual(["merged", "merged", "held"]);
  expect(v1.tiers).toMatchObject({ certain: 1, agree: 1, mervin: 1 });
  expect(v1.prs[2]!.why).toBe("Mervin asks on d.ts");
  expect(v1.log.at(-1)).toBe("#2 merged");
});

test("round files are checked, and the clock keeps its width", () => {
  expect(readRound(null)).toBeString();
  expect(readRound({ verdicts: [] })).toBeString();
  expect(readRound(round)).toBe(round);
  expect(clockText(7300)).toBe("00:07.3");
  expect(clockText(61_000)).toBe("01:01.0");
});

const withDiff: Round = {
  board: { stages: [{ pr: 1, title: "one", files: [{ path: "a.ts", tier: "mervin", lines: [{ text: "x", side: "pr" }, { text: "y", side: "main" }] }] }] },
  verdicts: [{ pr: 1, go: true, wave: 1, why: "" }],
  lanes: [{ lane: "build", name: "typecheck", state: "run", pr: 1 }, { lane: "build", name: "typecheck", state: "ok", pr: 1 }, { lane: "deploy", name: "preview", state: "ok" }],
};

test("lines stream into a file, then settle; lanes fold by step name", () => {
  const evs = events(withDiff);
  expect(evs.map((e) => e.kind)).toEqual(["round", "wave", "start", "file", "line", "line", "settle", "step", "step", "merged", "step"]);
  const mid = view(withDiff, evs.slice(0, 5));
  expect(mid.prs[0]!.files[0]).toMatchObject({ lines: [{ text: "x", side: "pr" }], settled: false });
  const done = view(withDiff, evs);
  expect(done.prs[0]!.files[0]!.settled).toBe(true);
  expect(done.lanes.build).toEqual([{ name: "typecheck", state: "ok", pr: 1 }]);
  expect(done.lanes.deploy).toHaveLength(1);
});

test("a live player waits for more events instead of finishing, and a pause event shows", () => {
  const p = new Player([], true);
  p.play();
  expect(p.mode).toBe("playing");
  p.push(events(round).slice(0, 2));
  expect(p.tick(10_000)).toHaveLength(2);
  expect(p.mode).toBe("playing");
  p.push([{ kind: "pause", paused: true, ms: 0 }, { kind: "start", pr: 9, ms: 300 }]);
  const v = view(round, p.steps.slice(0, p.at + 0));
  expect(v.paused).toBe(false);
  p.tick(1000);
  const w = view(round, p.steps.slice(0, p.at));
  expect([w.paused, w.prs.find((x) => x.pr === 9)?.state]).toEqual([true, "merging"]);
});
