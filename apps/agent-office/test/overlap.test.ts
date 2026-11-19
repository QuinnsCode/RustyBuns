// #4956: twenty tasks on one app went out at once, since each named a file or two and the queue never asked again.
import { afterEach, expect, test } from "bun:test";
import { anyway, look, resetOverlap, seatClash, taskApps } from "../live/overlap.ts";

afterEach(resetOverlap);

const PATHS = ["apps/fm-daw/src/circuit/amps.ts", "apps/fm-daw/src/desk.ts", "apps/load-in/src/van.ts", "apps/example/src/main.ts", "packages/gear/src/cable.ts"];

test("a task's apps: the ones its files sit in, an apps/ path it writes, a hyphenated app name, not a plain word", () => {
  const cases: [string, string[]][] = [
    ["Q Amp: a phaser in src/circuit/amps.ts", ["fm-daw"]],
    ["see apps/load-in for the van", ["load-in"]],
    ["the fm-daw desk and the load-in van", ["fm-daw", "load-in"]],
    ["an example of a cable in packages/gear/src/cable.ts", []],
    ["apps/nowhere/x.ts and my-thing", []],
  ];
  for (const [text, apps] of cases) expect([text, taskApps(text, PATHS)]).toEqual([text, apps]);
});

test("the queue leaves a task queued while a PR or a seated worker changes its app, and seats it once that has gone", async () => {
  let prs = [{ number: 4903, title: "Q Amp: chorus", headRefName: "office/a", files: [{ path: "apps/fm-daw/src/desk.ts" }] }];
  const exec = async (cmd: string) => (cmd === "git" ? PATHS.join("\n") : JSON.stringify(prs));
  const workers: unknown[] = [];
  const floor = { id: "f", dir: "/repo", workers: { list: () => workers, get: () => undefined }, queue: { state: () => ({ tasks: [] }), add: () => undefined } };
  const refresh = async (now: number) => { const l = look("/repo", exec, now); await Promise.all([l.paths, l.prs]); await Bun.sleep(0); };
  const vibe = { id: "q1", title: "Q Amp: vibe", status: "queued", prompt: "Add a vibe to src/circuit/amps.ts" };
  const van = { id: "q2", title: "Load In: van doors", status: "queued", prompt: "Fix the doors in apps/load-in" };
  const toasts: string[] = [];
  const asks = (t: unknown) => seatClash(floor, t, (m) => toasts.push(m));

  await refresh(Date.now());
  // the open PR is on another fm-daw file: the task waits, and says so once
  expect([asks(vibe), asks(vibe), asks(van)]).toEqual([true, true, false]);
  expect(toasts).toEqual([expect.stringContaining('"Q Amp: vibe" stays queued until PR #4903 merges: they change apps/fm-daw/')]);

  // the PR merged, but a worker the queue just seated on fm-daw has no PR yet
  prs = [];
  await refresh(Date.now() + 61_000);
  workers.push({ id: "w1", name: "Bolt", prompt: "A tremolo for the fm-daw desk", worktree: { path: "wt", branch: "office/bolt" } });
  expect(asks(vibe)).toBe(true);
  expect(toasts.at(-1)).toContain("until Bolt's work merges");
  workers.length = 0;
  expect(asks(vibe)).toBe(false);

  // sent with anyway, it is seated whatever it shares
  workers.push({ id: "w1", name: "Bolt", prompt: "A tremolo for the fm-daw desk", worktree: { path: "wt", branch: "office/bolt" } });
  anyway({ prompt: vibe.prompt });
  expect(asks(vibe)).toBe(false);
});
