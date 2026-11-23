import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { menu, readRuns } from "./builder-bar.ts";
import { battery, ciJobs, main, parseJobs, passedFile, passes, plan, pool, recordPass, snapshot, targetedJobs, TYPECHECK, type Valve } from "./remote-ci.ts";

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

// `all` is what both required checks run, so a branch can be proven ready while GitHub is down.
test("all adds typecheck.yml, the touched root suites and each app's boot check", () => {
  const apps = { include: [{ app: "a", test: "bun test", prep: "", boot: true }, { app: "b", test: "", prep: "cargo x", boot: true }, { app: "c", test: "bun test", prep: "", boot: false }] };
  const out = `apps=${JSON.stringify(apps)}\nany=true\npackages=true\nhooks=false\nscripts=true\n`;
  expect(ciJobs(out).map((j) => [j.label, j.cmd])).toEqual([["a", "bun test"], ["c", "bun test"]]);
  expect(ciJobs(out, true).map((j) => [j.label, j.cmd])).toEqual([
    ["typecheck", TYPECHECK], ["packages", "bun test packages"], ["scripts", "bun test ./scripts"],
    ["a", "bun test && bun ../../scripts/boot.ts"], ["b", "cargo x && bun ../../scripts/boot.ts"], ["c", "bun test"],
  ]);
});

// The trust dial's targeted run: only the tests the diff changed, per app; an app whose tests it didn't change runs whole.
test("a targeted run folds an app's shards into its changed tests, and leaves an app with none whole", () => {
  const apps = { include: [
    { app: "a", test: "bun test ./test/x.test.ts", prep: "make", shard: "1/2" }, { app: "a", test: "bun test ./test/y.test.ts", prep: "make", shard: "2/2" },
    { app: "c", test: "bun test", prep: "" },
  ] };
  const out = `apps=${JSON.stringify(apps)}\nany=true\n`;
  const files = ["apps/a/src/m.ts", "apps/a/test/m.test.ts", "apps/c/src/n.ts", "README.md"];
  expect(targetedJobs(out, files).map((j) => [j.label, j.dir, j.cmd])).toEqual([["a", "apps/a", "make && bun test './test/m.test.ts'"], ["c", "apps/c", "bun test"]]);
});

test("a pass is written down per commit, and reads as moved once the branch has a newer commit", async () => {
  const dir = mkdtempSync(`${tmpdir()}/passed-`);
  process.env.BUILDER_PASSED = `${dir}/passed.jsonl`;
  try {
    const git = (...a: string[]) => Bun.$`git ${a}`.cwd(dir).quiet();
    await git("init", "-q", "-b", "office/x");
    await git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one");
    const sha = (await git("rev-parse", "HEAD")).text().trim();
    await recordPass({ sha, branch: "office/x", base: "origin/main", at: 1, jobs: ["typecheck"] });
    await Bun.write(passedFile(), (await Bun.file(passedFile()).text()) + "not json\n");
    expect((await passes(dir)).map((p) => p.now === p.sha)).toEqual([true]);
    await git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "two");
    expect((await passes(dir)).map((p) => [p.branch, p.now === p.sha])).toEqual([["office/x", false]]);
  } finally {
    delete process.env.BUILDER_PASSED;
  }
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
test("a run waits until Bob serves, takes back a dead run's slot and ends what it left running, sends the working tree, shows on his menu, outlasts losing him mid-run, and a stray file in his locks doesn't jam a slot", async () => {
  const root = mkdtempSync(`${tmpdir()}/remote-ci-`), work = `${root}/work`, home = `${root}/home`;
  const id = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  await Bun.write(`${work}/package.json`, `{"name":"w"}`);
  await Bun.$`git init -q && git add -A && git commit -qm one`.cwd(work).env({ ...process.env, ...id });
  await Bun.$`mkdir -p ${home}/builder/locks && git clone -q ${work} ${home}/builder/slot-1`;
  // The only slot is locked by a run that died ten minutes ago (no heartbeat since): this run takes it back, not waits.
  mkdirSync(`${home}/builder/locks/slot-1`);
  const dead = new Date(Date.now() - 10 * 60_000);
  utimesSync(`${home}/builder/locks/slot-1`, dead, dead);
  // ... and left a server running from the slot's node_modules (a `wrangler dev` that outlived its run by days, #5337)
  const leftover = Bun.spawn(["sh", "-c", "while :; do sleep 1; done", `${home}/builder/slot-1/node_modules/.bin/wrangler`], { stdout: "ignore" });
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
    // Bob answers ssh but isn't serving yet: nothing is sent until `bun run builder serve` touches his `serving`
    setTimeout(() => void Bun.write(`${builder}/serving`, "now\n"), 300);
    // Mid-run, the slot is locked and its record is there: what the menu bar shows.
    expect(await main(["run", ".", "sh", "-c", `cat new.txt; cp -R ${builder} ${root}/mid`], work)).toBe(0);
    expect(await Bun.file(`${builder}/slot-1/new.txt`).text()).toBe("hello");
    expect(leftover.signalCode ?? await Promise.race([leftover.exited.then(() => leftover.signalCode), Bun.sleep(2000).then(() => "still running")])).toBe("SIGKILL");
    const mid = readRuns(`${root}/mid`);
    expect(mid.running.map((r) => [r.slot, r.who, r.cmd, r.last])).toEqual([["slot-1", "byte", expect.stringContaining(".: sh -c cat new.txt"), "hello"]]);
    expect(menu(mid, mid.running[0]!.started + 75_000).split("\n").slice(0, 3)).toEqual(["Bob: 1 running", "---", expect.stringMatching(/^slot-1 {2}byte {2}1m 15s \|/)]);

    // a late heartbeat once left a plain file where a released lock was: the slot is still taken, not jammed for good
    await Bun.write(`${builder}/locks/slot-1`, "");
    expect(await main(["run", ".", "sh", "-c", "echo nope; exit 1"], work)).toBe(1);
    // He goes away mid-run (ssh exits 255): the run waits for him again and runs from the start, not a failure
    expect(await main(["run", ".", "sh", "-c", `[ -f ${root}/dropped ] || { touch ${root}/dropped; exit 255; }; echo back`], work)).toBe(0);
    expect(readdirSync(`${builder}/locks`)).toEqual([]);
    const after = readRuns(builder);
    expect(after.running).toEqual([]);
    expect(after.done.map((r) => [r.code, r.last])).toEqual([[0, "back"], [1, "nope"], [0, "hello"]]);
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
