import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { menu, readRuns } from "./builder-bar.ts";
import { battery, main, parseJobs, plan, pool, snapshot, type Valve } from "./remote-ci.ts";

const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true";
const DRAIN = (pct: number) => `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t${pct}%; discharging; 3:10 remaining present: true`;

// The valve, whether Bob answers, and his battery decide where a run goes and how many suites at once.
test.each<[Valve, boolean, string, string, number]>([
  ["on", true, AC, "bob", 4],
  ["on", false, "", "here", 4],
  ["off", true, AC, "bob", 4],
  ["off", false, "", "wait", 4],
  ["off", true, "", "bob", 4], // a Linux builder: no pmset
  ["off", true, DRAIN(60), "bob", 1],
  ["off", true, DRAIN(15), "wait", 4],
  ["on", true, DRAIN(15), "here", 4],
  ["off", true, "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t12%; charging; 1:30 remaining", "bob", 4],
])("valve %s, Bob up %s: %#", (v, up, pmset, where, cap) => {
  expect(plan(v, up, battery(pmset), 4)).toMatchObject({ where, cap });
});

test("reads the touched suites and skips apps with no test command", () => {
  const out = `apps=${JSON.stringify({ include: [{ app: "a", test: "bun test", prep: "" }, { app: "b", test: "", prep: "" }] })}\nany=true\n`;
  expect(parseJobs(out).map((j) => j.app)).toEqual(["a"]);
  expect(() => parseJobs("any=false")).toThrow();
});

test("the pool never runs more than the cap and returns the worst code", async () => {
  let live = 0, peak = 0;
  const worst = await pool([0, 1, 0, 2, 0, 0], 2, async (code) => {
    peak = Math.max(peak, ++live);
    await Bun.sleep(5);
    live--;
    return code;
  });
  expect(worst).toBe(2);
  expect(peak).toBe(2);
});

// The builder is a folder of slot clones; "ssh" is a script that runs the command in that folder's home.
// Each run leaves a record its menu bar reads: who and what while it runs, then how it ended.
test("a run sends the working tree, untracked files too, to a free slot, shows on the builder's menu and gives it back", async () => {
  const root = mkdtempSync(`${tmpdir()}/remote-ci-`), work = `${root}/work`, home = `${root}/home`;
  const id = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  await Bun.write(`${work}/package.json`, `{"name":"w"}`);
  await Bun.$`git init -q && git add -A && git commit -qm one`.cwd(work).env({ ...process.env, ...id });
  await Bun.$`mkdir -p ${home}/builder/locks && git clone -q ${work} ${home}/builder/slot-1`;
  // The first ssh fails (Bob off) and the valve is shut, so the run waits for the next one; a fake pmset says AC.
  const ssh = `${root}/ssh`, pmset = `${root}/bin/pmset`;
  await Bun.write(ssh, `#!/bin/sh\n[ -f "${root}/up" ] || { touch "${root}/up"; exit 255; }\nshift\nexport PATH="${root}/bin:$PATH"\ncd "${home}" && exec sh -c "$*"\n`);
  await Bun.write(pmset, `#!/bin/sh\necho "Now drawing from 'AC Power'"\n`);
  chmodSync(ssh, 0o755);
  chmodSync(pmset, 0o755);
  await Bun.write(`${root}/rb/valve`, "off\n");
  const saved = { ...process.env };
  Object.assign(process.env, id, { BUILDER_HOST: "max", BUILDER_SSH: ssh, GIT_SSH_VARIANT: "simple", RUSTYBUNS_HOME: `${root}/rb`, BUILDER_POLL_MS: "10", BUILDER_WHO: "byte" });
  const builder = `${home}/builder`;
  try {
    await Bun.write(`${work}/new.txt`, "hello");
    // Mid-run, the slot is locked and its record is there: what the menu bar shows.
    expect(await main(["run", ".", "sh", "-c", `cat new.txt; cp -R ${builder} ${root}/mid`], work)).toBe(0);
    expect(await Bun.file(`${builder}/slot-1/new.txt`).text()).toBe("hello");
    const mid = readRuns(`${root}/mid`);
    expect(mid.running.map((r) => [r.slot, r.who, r.cmd, r.last])).toEqual([["slot-1", "byte", expect.stringContaining(".: sh -c cat new.txt"), "hello"]]);
    expect(menu(mid, mid.running[0]!.started + 75_000).split("\n").slice(0, 3)).toEqual(["Bob: 1 running", "---", expect.stringMatching(/^slot-1 {2}byte {2}1m 15s \|/)]);

    expect(await main(["run", ".", "sh", "-c", "echo nope; exit 1"], work)).toBe(1);
    expect(readdirSync(`${builder}/locks`)).toEqual([]);
    const after = readRuns(builder);
    expect(after.running).toEqual([]);
    expect(after.done.map((r) => [r.code, r.last])).toEqual([[1, "nope"], [0, "hello"]]);
    expect(menu(after, Date.now()).split("\n")[0]).toBe("Bob: idle");
    expect(await Bun.file(`${root}/up`).exists()).toBe(true);
    expect((await Bun.$`git status --porcelain`.cwd(work).text()).trim()).toBe("?? new.txt");
  } finally {
    process.env = saved;
  }
}, 30000);

// Every agent works in a linked worktree, where git gives the index path in full, not relative to the folder.
test("a snapshot works from a linked worktree and sees its untracked files", async () => {
  const root = mkdtempSync(`${tmpdir()}/snap-`);
  const sh = (cwd: string, cmd: string) => Bun.$`sh -c ${cmd}`.cwd(cwd).quiet();
  await sh(root, "git init -q main && cd main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git worktree add -q ../wt");
  await Bun.write(`${root}/wt/new.txt`, "hi");
  const commit = await snapshot(`${root}/wt`);
  expect((await sh(`${root}/main`, `git show ${commit}:new.txt`)).text()).toBe("hi");
});

// Valve open, and Bob off or no BUILDER_HOST: one command runs here with its own exit code, a base-ref run hands off to GitHub CI.
test.each([
  ["Bob off", { BUILDER_HOST: "bob", BUILDER_SSH: "false" }],
  ["no builder", { BUILDER_HOST: "" }],
])("%s: run runs here, a base ref points at GitHub CI", async (_, env) => {
  const saved = { ...process.env }, repo = `${import.meta.dir}/..`, rb = mkdtempSync(`${tmpdir()}/valve-`);
  await Bun.write(`${rb}/valve`, "on\n");
  Object.assign(process.env, env, { RUSTYBUNS_HOME: rb });
  try {
    expect(await main(["run", "scripts", "test", "-f", "remote-ci.ts"], repo)).toBe(0);
    expect(await main(["run", ".", "sh", "-c", "exit 3"], repo)).toBe(3);
    expect(await main(["HEAD"], repo)).toBe(0);
  } finally {
    process.env = saved;
  }
}, 30000);
