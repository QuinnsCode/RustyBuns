import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EsterState } from "../ester/run.ts";
import { avoided, preventedOf, esterStack, fixPrompt, helperState, line, mergedPrs, mervinBoard, openPrs, slots, tallyRows, tallySum } from "../screens/read.ts";
import { officeTriage } from "../triage/server.ts";

// what mervin-board.ts prints for two PRs that both touched apps/x.ts, one settled and one carded, plus two clashes
const BOARD = [
  "Mervin's board: 2 PRs onto main abc123456", "",
  "stage 1: #12 Two Fronts: cover", "  4 files, 75% certain   certain 3  agree 0  mervin 1  differ 0  card 0   own CI pass",
  "  mervin  apps/y.ts  both added a route  (after main)",
  "stage 2: #15 (on #12) Skate rails", "  9 files, 88% certain   certain 8  agree 0  mervin 0  differ 0  card 1",
  "  card    apps/x.ts  both sides changed the same stretch  (after #12)",
  "clash migration: 0042  #12 + #15  settled: renumbered #15", "clash export: foo  #12 + #15  CARD",
];
const run = (phase: EsterState["phase"], lines: string[], hold: number[] = []): EsterState => ({ phase, lines, hold, startedAt: 1 });

test("Mervin's screen: the files two sides wrote to, the clashes, and the share of conflicts he took off the agents", () => {
  const b = mervinBoard(BOARD);
  expect(b.stages.map((s) => [s.pr, s.certain, s.tiers.mervin, s.tiers.card])).toEqual([[12, 75, 1, 0], [15, 88, 0, 1]]);
  expect(b.files).toEqual([{ path: "apps/y.ts", tier: "mervin", prs: [12], main: true }, { path: "apps/x.ts", tier: "card", prs: [12, 15], main: false }]);
  expect(b.clashes.map((c) => [c.kind, c.prs, c.settled])).toEqual([["migration", [12, 15], true], ["export", [12, 15], false]]);
  expect(avoided(b)).toEqual({ avoided: 2, total: 4 }); // y.ts and the migration, of y.ts, x.ts and both clashes
  // two tasks held on busy branches never became conflicts at all
  expect(avoided(b, preventedOf({ prevented: 2, held: [] }))).toEqual({ avoided: 4, total: 6 });
  expect(preventedOf({ error: "nope" })).toBe(0);
});

test("his running tally counts each PR once, however often he is called on", () => {
  const first = tallyRows(mervinBoard(BOARD), 100);
  const again = tallyRows(mervinBoard(BOARD.map((l) => l.replace("card 1", "card 0").replace("mervin 0  differ 0  card 0", "mervin 1  differ 0  card 0"))), 200);
  const text = [...first, ...again].map((r) => JSON.stringify(r)).join("\n") + "\nnot a row\n";
  // #15's card was settled on the second run: the later row wins, nothing counts twice
  expect(tallySum(text)).toEqual({ prs: 2, avoided: 3, total: 4, since: 200 });
  expect(tallySum("")).toBeNull();
});

test("Ester's stack: one run of them all or a run per PR, and which PR broke it", () => {
  const each = [...BOARD, "stage 1 #12: ok", "stage 2 #15: the board breaks apps/x: bun test", "FAIL  apps/x: bun test  2.0s"];
  const cases: [EsterState, ReturnType<typeof esterStack>][] = [
    [run("running", BOARD), { mode: "one", blocks: [{ pr: 12, state: "wait" }, { pr: 15, state: "wait" }], broke: [] }],
    [run("green", BOARD), { mode: "one", blocks: [{ pr: 12, state: "ok" }, { pr: 15, state: "ok" }], broke: [] }],
    [run("red", [...BOARD, "Ester says hold: #15"], [15]), { mode: "one", blocks: [{ pr: 12, state: "ok" }, { pr: 15, state: "broke" }], broke: [15] }],
    [run("red", each), { mode: "each", blocks: [{ pr: 12, state: "ok" }, { pr: 15, state: "broke" }], broke: [15] }],
  ];
  for (const [s, want] of cases) expect(esterStack(s)).toEqual(want);
  const prompt = fixPrompt(15, [...each, "  blocks apps/x/test/a.test.ts  only the merged tree breaks it  (#15)", "  blocks apps/z  (#12)"]);
  expect(prompt).toContain("FAIL  apps/x: bun test");
  expect(prompt).toContain("apps/x/test/a.test.ts");
  expect(prompt).not.toContain("apps/z");
});

test("gitpath's line: each open PR at the furthest station it reached, stuck red where it stopped", () => {
  const pr = (number: number, ci: "pass" | "fail" | "pending", draft = false) => ({ number, title: "", url: `u${number}`, draft, ci });
  const mervin = run("green", [...BOARD, "stage 3: #20 Docs", "  1 files, 100% certain   certain 1"]);
  const ester = run("red", [...BOARD, "stage 3: #20 Docs", "Ester says hold: #12"], [12]);
  const cars = line([pr(1, "pass", true), pr(2, "fail"), pr(3, "pending"), pr(4, "pass"), pr(15, "pass"), pr(12, "pass"), pr(20, "pass")], mervin, ester);
  expect(cars.map((c) => [c.pr, c.at, c.state])).toEqual([
    [1, 0, "ready"], [2, 1, "stuck"], [3, 0, "moving"], [4, 1, "ready"],
    [15, 2, "stuck"], // Mervin wants a card on apps/x.ts
    [12, 3, "stuck"], // Ester holds it
    [20, 3, "ready"],
  ]);
});

test("what comes in is looked at: GitHub's lists and a helper's run, wrong shapes and all", () => {
  expect(openPrs([{ number: 1, title: "a", statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "IN_PROGRESS" }] }, { number: 2, statusCheckRollup: [{ conclusion: "FAILURE" }] }, { number: "3" }, 4]))
    .toEqual([{ number: 1, title: "a", url: "", draft: false, ci: "pending" }, { number: 2, title: "", url: "", draft: false, ci: "fail" }]);
  expect(openPrs({ message: "Bad credentials" })).toEqual([]);
  expect(mergedPrs([{ number: 1, mergedAt: "2026-10-27T01:00:00Z" }, { number: 2, mergedAt: "2026-10-27T03:00:00Z" }, { number: 3, mergedAt: "soon" }]).map((p) => p.number)).toEqual([2, 1]);
  expect(helperState({ phase: "running", lines: ["a", 3], hold: [4, "5"], startedAt: 1 })).toEqual({ phase: "running", lines: ["a"], hold: [4], startedAt: 1, endedAt: undefined });
  expect(helperState({ phase: "asleep" })).toEqual({ phase: "idle", lines: [], hold: [] });
});

test("the office reads the floor's PRs for the line with gh, once a minute however many pages ask", async () => {
  const asked: string[] = [];
  const now = new Date().toISOString(), old = new Date(Date.now() - 3 * 86400_000).toISOString();
  const gh = async (args: string[]) => {
    asked.push(args[3]!);
    return args[3] === "open" ? JSON.stringify([{ number: 7, title: "t", url: "u", isDraft: false, statusCheckRollup: [] }])
      : JSON.stringify([{ number: 6, title: "new", mergedAt: now }, { number: 5, title: "old", mergedAt: old }]);
  };
  const dir = mkdtempSync(path.join(tmpdir(), "rb-line-"));
  const routes = officeTriage(mkdtempSync(path.join(tmpdir(), "rb-line-data-")), () => [{ id: "f", dir }], undefined, undefined, gh);
  const r = await routes("GET", new URL("http://o/__rb/line"), false);
  expect(r).toEqual({ status: 200, body: { open: [{ number: 7, title: "t", url: "u", draft: false, ci: "none" }], merged: [{ number: 6, title: "new", mergedAt: Date.parse(now) }] } });
  await routes("GET", new URL("http://o/__rb/line"), false);
  expect(asked).toEqual(["open", "merged"]);
  const down = officeTriage(mkdtempSync(path.join(tmpdir(), "rb-line-data-")), () => [{ id: "f", dir }], undefined, undefined, async () => null);
  expect((await down("GET", new URL("http://o/__rb/line"), false))?.body).toMatchObject({ open: [], error: expect.any(String) });
});

test("the three slots stay put across the span, whichever are on", () => {
  expect(slots(-3, 3, 0.3)).toEqual([{ x: -2.1, width: 1.8 }, { x: 0, width: 1.8 }, { x: 2.1, width: 1.8 }].map((s) => ({ ...s, x: expect.closeTo(s.x, 9) })));
});
