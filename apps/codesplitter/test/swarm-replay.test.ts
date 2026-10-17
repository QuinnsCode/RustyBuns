import { expect, test } from "bun:test";
import { band, changes, counts, gitPeak, nightPeaks, pile, Playhead, readWeek, SPEEDS, type Week, type WeekRow } from "../src/swarm-replay.ts";
import { events, Player, readRound, view } from "../src/mervin-replay.ts";
import { gitSpans, redSpans } from "../scripts/swarm-week.ts";

const row = (o: Partial<WeekRow>): WeekRow => ({ n: 1, t: "one", a: 10, z: 100, m: true, w: 60, g: [], r: [], ...o });

test("the real week plays to the end: every PR that closed is merged or closed, none unborn, the bands add up", async () => {
  const week = readWeek(await Bun.file(`${import.meta.dir}/../src/swarm-week.json`).json());
  if (typeof week === "string") throw new Error(week);
  expect(week.rows.length).toBeGreaterThan(900);
  const head = new Playhead(week.minutes);
  head.setSpeed(SPEEDS.at(-1)!);
  head.play();
  // the page's frames: about ten week minutes per 16 ms frame at 64x
  for (let f = 0; head.mode === "playing" && f < 100_000; f++) {
    head.tick(16);
    const c = counts(week, head.t);
    expect(Object.values(c).reduce((s, n) => s + n, 0)).toBe(week.rows.length);
  }
  expect(head.mode).toBe("done");
  const end = counts(week, week.minutes);
  expect(end.unborn).toBe(0);
  expect(end.merged + end.closed).toBe(week.rows.filter((r) => r.z !== null && r.z <= week.minutes).length);
  // the git wall is in the week, and there is a file the stuck agents pile into
  const peak = gitPeak(week, 10);
  expect(counts(week, peak).git).toBeGreaterThan(5);
  expect(pile(week, peak).lines.some((l) => l.conflicted)).toBe(true);
});

test("git wins over a red check, which wins over working; ready after the last commit", () => {
  const r = row({ g: [[20, 30]], r: [[25, 40]] });
  expect([5, 15, 22, 35, 50, 70, 100].map((t) => band(r, t))).toEqual(["unborn", "working", "git", "test", "working", "ready", "merged"]);
  expect(band(row({ m: false }), 100)).toBe("closed");
  expect(band(row({ z: null }), 1e9)).toBe("ready");
});

test("a PR's changes are its band each time it moves, no repeats", () => {
  expect(changes(row({ g: [[20, 30]] }), 200)).toEqual([[0, "unborn"], [10, "working"], [20, "git"], [30, "working"], [60, "ready"], [100, "merged"]]);
});

test("the pile is the file most conflicted PRs share, the README on a tie", () => {
  const week: Week = { repo: "", start: 0, minutes: 200, marks: [], hot: ["src/a.ts", "README.md"], rows: [
    row({ n: 1, h: [0], g: [[10, 50]] }), row({ n: 2, h: [1] }), row({ n: 3, h: [0, 1], g: [[10, 50]] }),
  ] };
  expect(pile(week, 20)).toEqual({ file: "src/a.ts", lines: [
    { n: 1, title: "one", conflicted: true, agent: expect.any(String) }, { n: 3, title: "one", conflicted: true, agent: expect.any(String) },
  ] });
  expect(pile(week, 150).file).toBe("README.md");
});

test("the playhead seeks inside the week and plays again from the start once done", () => {
  const p = new Playhead(100);
  expect(p.tick(1000)).toBe(0);
  p.seek(500);
  expect(p.t).toBe(100);
  p.play();
  p.tick(1);
  expect(p.mode).toBe("done");
  p.play();
  expect(p.t).toBe(0);
});

test("a fix closes a conflict span opened by main moving under the PR, or 30 minutes back", () => {
  const M = 6e4;
  expect(gitSpans([100 * M], 0, [40 * M, 60 * M])).toEqual([[40 * M, 100 * M]]);
  expect(gitSpans([100 * M, 200 * M], 0, [40 * M])).toEqual([[40 * M, 100 * M], [170 * M, 200 * M]]);
});

test("red runs until the same workflow passes on the branch; another workflow passing doesn't clear it", () => {
  const spans = redSpans([
    { branch: "b", name: "apps", ok: false, at: 10 }, { branch: "b", name: "typecheck", ok: true, at: 20 },
    { branch: "b", name: "apps", ok: false, at: 25 }, { branch: "b", name: "apps", ok: true, at: 30 },
    { branch: "c", name: "apps", ok: false, at: 40 },
  ]);
  expect(spans.get("b")).toEqual([[10, 30]]);
  expect(spans.get("c")).toEqual([[40, null]]);
});

test("night peaks: the widest band per day, the ship marks on the night they fell, git pile-up of the 13th over the 14th's tail", async () => {
  const week = readWeek(await Bun.file(`${import.meta.dir}/../src/swarm-week.json`).json());
  if (typeof week === "string") throw new Error(week);
  const nights = nightPeaks(week);
  expect(nights.length).toBe(Math.ceil(week.minutes / 1440));
  expect(nights.flatMap((n) => n.marks).sort()).toEqual(["Ester", "Mervin"]);
  const peak = nights.reduce((a, b) => (b.git > a.git ? b : a));
  expect(peak.git).toBeGreaterThan(nights.at(-1)!.git);
  expect(nights.every((n) => n.git <= n.open && n.test <= n.open)).toBe(true);
});

test("the recorded merge round plays to the end: every PR merged, with the cards Mervin asks about", async () => {
  const round = readRound(await Bun.file(`${import.meta.dir}/../src/swarm-round.json`).json());
  if (typeof round === "string") throw new Error(round);
  const p = new Player(events(round));
  p.play();
  const played = p.tick(p.total + 1);
  expect(p.mode).toBe("done");
  const v = view(round, played);
  expect(v.prs.length).toBe(5);
  expect(v.prs.every((x) => x.state === "merged")).toBe(true);
  expect(v.tiers.mervin + v.tiers.agree).toBeGreaterThan(v.tiers.card);
  expect(v.prs.flatMap((x) => x.cards).length).toBe(v.tiers.card);
});
