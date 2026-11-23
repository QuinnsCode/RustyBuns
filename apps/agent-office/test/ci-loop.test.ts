import { expect, test } from "bun:test";
import { BY, loopOnce, type LoopFloor } from "../live/ci-loop.ts";

/** A floor whose queue keeps what it is given, as the office's TaskQueue does (one live task per issue). */
function floor(tasks: { issue?: number; status: string; addedBy: string }[] = []) {
  const prompts: string[] = [];
  const f: LoopFloor = {
    id: "f", dir: "/repo",
    queue: {
      state: () => ({ tasks: tasks.map((t) => ({ ...t })) }),
      add: (prompt, by, _title, issue) => {
        if (tasks.some((t) => t.issue === issue && t.status !== "done")) return `Issue #${issue} is already on the queue`;
        tasks.push({ issue, status: "queued", addedBy: by });
        prompts.push(prompt);
        return undefined;
      },
    },
  };
  return { f, tasks, prompts };
}

const issue = (number: number, assignees: string[] = []) => ({ number, title: "Hourly desktop/suite run is failing", assignees: assignees.map((login) => ({ login })) });

test("each red hourly issue nobody holds goes on the queue, two at most, once each", async () => {
  const issues = [issue(40), issue(10), issue(20), issue(30, ["someone"]), issue(50)];
  const prs = [{ title: "Fix the lane", body: "Fixes #20" }];
  const gh = async (_dir: string, args: string[]) => JSON.stringify(args[0] === "issue" ? issues : prs);
  const { f, tasks, prompts } = floor([{ issue: 99, status: "running", addedBy: "Swift Heron" }]);

  // 20 has a PR, 30 is assigned; the oldest two of the rest
  expect(await loopOnce(f, gh)).toEqual([10, 40]);
  expect(prompts[0]).toContain("Fixes #10");
  // both still on the queue: the cap is full, and nothing is queued twice
  expect(await loopOnce(f, gh)).toEqual([]);
  // one finishes with its issue still open: the next one takes its place, and #10 isn't run again
  tasks.find((t) => t.issue === 10)!.status = "done";
  expect(await loopOnce(f, gh)).toEqual([50]);
  expect(tasks.filter((t) => t.addedBy === BY && t.status !== "done").map((t) => t.issue)).toEqual([40, 50]);
});

test("a reply that isn't the shape asked for queues nothing", async () => {
  const { f, tasks } = floor();
  for (const reply of ["not json", '{"number": 1}', '[{"number": "x"}]'])
    expect(await loopOnce(f, async () => reply)).toEqual([]);
  expect(tasks).toEqual([]);
});
