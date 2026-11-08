import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Exec } from "../src/agent-run.ts";
import { EXAMPLE_PIPELINE, laneCall, plan, tally, type Change, type Lane, type LaneCall } from "../src/pipeline.ts";
import { glob } from "../src/util.ts";
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
    ["train, touched", { name: "t", cadence: "train", paths: ["src/**"] }, { files: ["src/a.ts"] }, "run"],
    ["train, not touched", { name: "t", cadence: "train", paths: ["src/**"] }, { files: ["README.md"] }, "skip"],
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
  const r = await road("files=src/a.ts");
  expect(r.source).toBe("codesplitter.pipeline.json");
  expect(r.plan.map((s) => s.at)).toContain("before-ester");
  expect(r.counts.stress).toBe(1);

  const bad = await post(call, null, "/api/pipeline", { pipeline: { lanes: [{ name: "x", cadence: "sometimes" }] }, change: { files: [] } });
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: string }).error).toContain("lanes.0.cadence");
  // A pattern stacking globstars is refused (each one is another degree of regex backtracking), and a run of them compiles as one.
  const stacked = await post(call, null, "/api/pipeline", { pipeline: { lanes: [{ name: "x", cadence: "always", paths: ["**/**/**/a"] }] }, change: { files: ["/".repeat(499) + "b"] } });
  expect(stacked.status).toBe(400);
  expect(glob("**/**/a").source).toBe(glob("**/a").source);
});

test("the hooks run at a merge: an AI's nay holds it with the reason, an edit asks again, then a person's yay lands it", async () => {
  const call = await local({ GH_CLI: "off", HEAL: "1" });
  const answers = ["NAY: x(3) drops the null check", "YAY", "YAY"], prompts: string[] = [];
  call.env.AGENT_EXEC = (async (cmd, cwd) => {
    prompts.push(cmd.args.join(" "));
    writeFileSync(join(cwd, "VERDICT.md"), answers[prompts.length - 1] + "\n");
    return { code: 0, out: "" };
  }) as Exec;
  await post(call, "ana", "/api/login", { name: "ana" });
  await post(call, "ana", "/api/repos", { name: "r" });
  await post(call, "ana", "/api/repos/ana/r/files", { path: "a.ts", content: "x(1);" });
  await post(call, "ana", "/api/repos/ana/r/files", { path: "codesplitter.pipeline.json", content: JSON.stringify({ hooks: { "before-ester": "ai", "after-ester": "ask" } }) });
  await post(call, "ana", "/api/repos/ana/r/branches", { name: "b1" });
  const edit = (t: string, base: number) => post(call, "ana", "/api/repos/ana/r/do/ops?path=a.ts&branch=b1", { ops: [{ kind: "set", line: "L1", base, text: t }] });
  await edit("x(3);", 2);
  const merge = async () => { const r = await post(call, "ana", "/api/repos/ana/r/branches/b1/merge", {}); return { status: r.status, body: await r.json() as { error?: string; hook?: { at: string; say: string; reason?: string } } }; };

  const nay = await merge();
  expect(nay.status).toBe(409);
  expect(nay.body.hook).toMatchObject({ at: "before-ester", say: "nay", reason: "x(3) drops the null check" });
  expect(prompts[0]).toContain("before-ester");
  // Merging again doesn't ask again: the nay stands until the branch changes.
  expect((await merge()).body.hook?.say).toBe("nay");
  expect(prompts).toHaveLength(1);

  expect((await edit("x(4);", 1)).status).toBe(200);
  const waiting = await merge();
  expect(prompts).toHaveLength(2);
  expect(waiting.body.hook).toMatchObject({ at: "after-ester", say: "waiting" });
  const cards = await (await call("ana", "/api/repos/ana/r/branches/b1/hooks")).json() as { hash: string; hooks: { at: string; say: string }[] };
  expect(cards.hooks.map((h) => [h.at, h.say])).toEqual([["before-ester", "yay"], ["after-ester", "waiting"]]);
  expect((await post(call, "ana", "/api/repos/ana/r/branches/b1/hooks/after-mervin", { say: "yay", hash: cards.hash })).status).toBe(409);

  // A yay names the branch as read: an edit landed since (a new hash) is refused until the person reads again.
  expect((await edit("x(5);", 2)).status).toBe(200);
  expect((await post(call, "ana", "/api/repos/ana/r/branches/b1/hooks/after-ester", { say: "yay", hash: cards.hash })).status).toBe(409);
  const again = await (await call("ana", "/api/repos/ana/r/branches/b1/hooks")).json() as { hash: string };
  expect(again.hash).not.toBe(cards.hash);
  expect((await post(call, "ana", "/api/repos/ana/r/branches/b1/hooks/after-ester", { say: "yay", hash: again.hash })).status).toBe(200);
  expect((await merge()).status).toBe(200);
  expect(await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json()).toMatchObject({ lines: [{ text: "x(5);" }] });
});

test("lanes drive the checks: a commit queues only the lanes it calls for, and the repo keeps each lane's count", async () => {
  const call = await local({ GH_CLI: "off" });
  const R = "/api/repos/ana/r";
  await post(call, "ana", "/api/login", { name: "ana" });
  await post(call, "ana", "/api/repos", { name: "r" });
  await call("ana", `${R}/checks/settings`, { method: "PUT", body: JSON.stringify({ where: "here" }) });
  await post(call, "ana", `${R}/files`, { path: "codesplitter.pipeline.json", content: JSON.stringify({ lanes: [
    { name: "unit", cadence: "always", paths: ["src/**"], run: "bun test" },
    { name: "stress", cadence: "often", every: 2, paths: ["src/**"], run: "bun run stress" },
    { name: "docs", cadence: "bus", seats: 5, paths: ["**/*.md"] },
  ] }) });
  await post(call, "ana", `${R}/do/commit?path=codesplitter.pipeline.json`, { message: "pipeline" });
  type Run = { id: number; name: string; status: string };
  const runsOn = async (ref: string) => ((await (await call("ana", `${R}/checks?ref=${ref}`)).json()) as { runs: Run[] }).runs;
  const commit = async (path: string, content: string) => {
    await post(call, "ana", `${R}/files`, { path, content });
    expect((await post(call, "ana", `${R}/do/commit?path=${path}`, { message: path })).status).toBe(200);
    // A commit cancels the runs still queued on the one before it: what's left is what this one queued.
    return (await runsOn("main")).filter((r) => r.status !== "cancelled");
  };
  /** What each lane's count becomes after a change to `file`, from the counts the repo keeps. */
  const after = async (file: string) => ((await (await call("ana", `${R}/pipeline?files=${file}`)).json()) as { counts: Record<string, number> }).counts;

  // The first change to src/: unit runs, stress owes its run (1 of every 2), the docs bus doesn't stop.
  const first = await commit("src/a.ts", "a");
  expect(first.map((r) => r.name)).toEqual(["unit"]);
  const unit = (await (await call("ana", `${R}/checks/${first[0]!.id}`)).json()) as { command: string; log: string };
  expect(unit.command).toBe("bun test");
  expect(unit.log).toContain("lane unit (always): touches src/a.ts");
  // GET .../pipeline reads the kept counts: the next src/ change is stress's 2nd, so it would run and start again.
  expect(await after("src/x.ts")).toEqual({ unit: 0, stress: 0 });

  // A docs change takes a seat and queues nothing.
  expect(await commit("README.md", "hi")).toEqual([]);
  // A branch's checks go by the same counts (its src/ edit is stress's 2nd) but don't move them: only main does.
  await post(call, "ana", `${R}/branches`, { name: "b1" });
  const doc = (await (await call("ana", `${R}/do/file?path=src/a.ts&branch=b1`)).json()) as { lines: { id: string; rev: number }[] };
  await post(call, "ana", `${R}/do/ops?path=src/a.ts&branch=b1`, { ops: [{ kind: "set", line: doc.lines[0]!.id, base: doc.lines[0]!.rev, text: "A" }] });
  for (const end = performance.now() + 10_000; !(await runsOn("b1")).length && performance.now() < end;) await Bun.sleep(10);
  expect((await runsOn("b1")).map((r) => r.name).sort()).toEqual(["stress", "unit"]);
  expect(await after("README.md")).toEqual({ unit: 0, stress: 1, docs: 2 });

  // The second src/ change on main: stress's turn comes, and it starts again at 0.
  expect((await commit("src/b.ts", "b")).map((r) => r.name).sort()).toEqual(["stress", "unit"]);
  expect(await after("README.md")).toEqual({ unit: 0, stress: 0, docs: 2 });
});
