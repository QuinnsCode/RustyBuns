import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { failedTests, spreadWatch, waitLine, type Gh, type SpreadFloor } from "../live/spread.ts";

const NOW = Date.parse("2026-11-25T06:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const SLOW = "room setup > the stage loads its rigs";

/** A `gh run view --log-failed` log as Actions writes it: job, step, timestamp, then the line. */
const log = (...fails: string[]) => ["$ bun test test/room-setup.test.ts", "  ^ this test timed out after 240000ms.", ...fails.map((f) => `(fail) ${f} [240001.52ms]`), " 41 pass", ` ${fails.length} fail`]
  .map((l) => `test fm-daw 1/3\tRun tests\t2026-11-25T05:00:00.0000000Z ${l}`).join("\n");

/** The repo as gh sees it: open PRs, failed runs, their logs, and the issues and comments the watch writes. */
function repo() {
  const prs = [
    { number: 5879, headRefName: "office/a" }, { number: 5880, headRefName: "office/b" },
    { number: 5884, headRefName: "office/c" }, { number: 5887, headRefName: "office/d" },
  ].map((p) => ({ ...p, title: "Some feature", body: "" }));
  const runs = {
    "apps.yml": [
      { databaseId: 1, headBranch: "office/a", createdAt: ago(1), url: "https://x/runs/1" },
      { databaseId: 2, headBranch: "office/b", createdAt: ago(2), url: "https://x/runs/2" },
      { databaseId: 3, headBranch: "office/c", createdAt: ago(3), url: "https://x/runs/3" },
      { databaseId: 4, headBranch: "office/d", createdAt: ago(1), url: "https://x/runs/4" },
      { databaseId: 5, headBranch: "office/gone", createdAt: ago(1), url: "https://x/runs/5" },
      { databaseId: 6, headBranch: "office/d", createdAt: ago(9), url: "https://x/runs/6" },
    ],
    "desktop-hourly.yml": [] as unknown[],
  };
  const logs: Record<string, string> = { 1: log(SLOW), 2: log(SLOW), 3: log(SLOW), 4: log(SLOW, "mixer > pans"), 5: log("other > test"), 6: log("old > one") };
  const issues: { number: number; title: string; body: string; comments: { body: string }[] }[] = [];
  const calls: string[][] = [];
  const gh: Gh = async (_dir, args) => {
    calls.push(args);
    const [a, b] = args;
    if (a === "pr" && b === "list") return JSON.stringify(prs);
    if (a === "run" && b === "list") return JSON.stringify(runs[args[args.indexOf("--workflow") + 1] as keyof typeof runs]);
    if (a === "run" && b === "view") return logs[args[2]!] ?? "";
    // GitHub's search index lags: a just-filed issue isn't found for a while
    if (a === "issue" && b === "list") return "[]";
    if (a === "issue" && b === "create") {
      issues.push({ number: 6000 + issues.length, title: args[args.indexOf("--title") + 1]!, body: args[args.indexOf("--body") + 1]!, comments: [] });
      return `https://github.com/o/r/issues/${issues.at(-1)!.number}\n`;
    }
    if (a === "issue" && b === "view") return JSON.stringify(issues.find((i) => i.number === Number(args[2])));
    if (a === "issue" && b === "comment") { issues.find((i) => i.number === Number(args[2]))!.comments.push({ body: args[args.indexOf("--body") + 1]! }); return ""; }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { gh, issues, calls, runs, logs };
}

function floor() {
  const dir = mkdtempSync(path.join(tmpdir(), "spread-"));
  mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(path.join(dir, ".github", "workflows", "apps.yml"), "");
  const queued: { prompt: string; issue?: number }[] = [], told: { id: string; text: string }[] = [];
  const workers = [{ id: "w1", name: "A", pr: { number: 5879 } }, { id: "w2", name: "B", pr: { number: 5880 } }, { id: "w3", name: "C", pr: { number: 5884 } }, { id: "w4", name: "D", pr: { number: 5887 } }];
  const f: SpreadFloor = {
    id: "f", dir,
    queue: { add: (prompt, _by, _title, issue) => { queued.push({ prompt, issue }); return undefined; } },
    workers: { list: () => workers, prompt: (id, text) => { told.push({ id, text }); return undefined; } },
  };
  return { f, queued, told };
}

test("a test red on three PRs gets one issue, one hire and a word to each PR's worker; the next pass adds nothing", async () => {
  const r = repo(), { f, queued, told } = floor();
  const watch = spreadWatch(r.gh, () => NOW);

  const lines = await watch.pass([f]);
  expect(r.issues).toHaveLength(1);
  expect(r.issues[0]!.title).toContain(SLOW);
  expect(r.issues[0]!.body).toContain("https://x/runs/3");
  for (const n of [5879, 5880, 5884, 5887]) expect(r.issues[0]!.body).toContain(`#${n}`);
  expect(queued).toEqual([{ prompt: expect.stringContaining("Fixes #6000"), issue: 6000 }]);
  // 5887 is red on another test too, so its worker isn't told to just wait
  expect(told).toEqual(["w1", "w2", "w3"].map((id) => ({ id, text: waitLine(SLOW, 6000) })));
  expect(lines).toEqual([`${SLOW}: 4 PRs, held by #6000`]);
  expect(watch.lines()).toEqual(lines);

  // ten minutes on: the same runs, nothing new filed, hired, said or read again
  const logsRead = r.calls.filter((c) => c[1] === "view" && c[0] === "run").length;
  expect(await watch.pass([f])).toEqual(lines);
  expect(r.issues).toHaveLength(1);
  expect(r.issues[0]!.comments).toEqual([]);
  expect(queued).toHaveLength(1);
  expect(told).toHaveLength(3);
  expect(r.calls.filter((c) => c[1] === "view" && c[0] === "run").length).toBe(logsRead);
});

test("an open issue that names the test is commented on, not filed again, and nobody is hired", async () => {
  const r = repo(), { f, queued, told } = floor();
  const comments: string[] = [];
  const gh: Gh = async (dir, args) => {
    if (args[0] !== "issue") return r.gh(dir, args);
    if (args[1] === "list") return JSON.stringify([{ number: 5893, title: "fm-daw room setup times out", body: `\`${SLOW}\` takes 239 s, on #5879` }]);
    if (args[1] === "view") return JSON.stringify({ body: "on #5879", comments: [{ body: "and #5880" }] });
    if (args[1] === "comment" && args[2] === "5893") { comments.push(args.at(-1)!); return ""; }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };

  expect(await spreadWatch(gh, () => NOW).pass([f])).toEqual([`${SLOW}: 4 PRs, held by #5893`]);
  // the comment names only the PRs the issue doesn't have yet
  expect(comments).toEqual([expect.stringContaining("#5884, #5887")]);
  expect(comments[0]).not.toContain("#5879");
  expect(queued).toEqual([]);
  expect(told.map((t) => t.text)).toEqual(Array(3).fill(waitLine(SLOW, 5893)));
});

test("the hourly run and one PR is spreading; two PRs alone is not", async () => {
  const r = repo(), { f, queued } = floor();
  r.runs["apps.yml"] = r.runs["apps.yml"].slice(0, 2);
  expect(await spreadWatch(r.gh, () => NOW).pass([f])).toEqual([]);
  r.runs["desktop-hourly.yml"] = [{ databaseId: 9, headBranch: "main", createdAt: ago(0.5), url: "https://x/runs/9" }];
  r.logs[9] = log(SLOW);
  expect(await spreadWatch(r.gh, () => NOW).pass([f])).toEqual([`${SLOW}: 2 PRs + hourly, held by #6000`]);
  expect(r.issues[0]!.title).toContain("and the hourly run");
  expect(queued).toHaveLength(1);
});

test("the log parser takes each (fail) line's name, without its time, with the lines before it", () => {
  const t = failedTests(log(SLOW, "mixer > pans", SLOW));
  expect(t.map((x) => x.name)).toEqual([SLOW, "mixer > pans"]);
  expect(t[0]!.lines.at(-1)).toBe(`(fail) ${SLOW} [240001.52ms]`);
  expect(t[0]!.lines).toContain("  ^ this test timed out after 240000ms.");
  expect(failedTests("error: script \"test\" exited with code 1")).toEqual([]);
});
