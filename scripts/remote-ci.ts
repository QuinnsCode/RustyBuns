// Run tests on the builder Mac over SSH (#2329). The builder holds a few warm
// checkouts (slots, made by scripts/builder-setup.sh); each run claims a free one, so agents can share it.
// What runs is your working tree as it is, committed or not, untracked files included. Nothing goes to GitHub.
//
//   bun run builder <base-ref>                 the suites the branch touched (what apps.yml would run)
//   bun run builder run <dir> <cmd...>         one command in <dir>, e.g. run apps/skate-tech-park bun test test/ramp.test.ts
//   bun run builder all [base-ref]             everything GitHub's typecheck and apps checks run (base default origin/main),
//                                              with no GitHub; a pass of a committed HEAD is written down as ready to merge
//   bun run builder passed                     what Bob passed, newest first, and whether each branch moved since
//   bun run builder nightly                    the last nightly desktop build on the builder (builder-nightly.sh) and its failures
//   bun run builder off | on                   shut or open this Mac's valve; bare `bun run builder` says which, and if Bob answers
//   bun run builder queue [base-ref]           send the pushed HEAD's suites (what both required checks run) to the test swarm
//   bun run builder join [--slots N]           this Mac takes test jobs from the swarm, N at a time (default 1), until Ctrl-C
//   bun run builder serve                      on Bob: he takes runs until Ctrl-C (and stays awake while he does)
//
// Bob says when he takes work, not the runs: nothing is sent to him until `bun run builder serve` is running on him,
// which keeps `serving` in his builder folder fresh. Off, asleep, or not serving, a run waits for him (valve shut).
// If he goes away mid-run (ssh drops, a push hangs), the run doesn't fail: it waits for him again and runs from the start.
//
// The test swarm (apps/test-swarm, #4758) is a queue any of our Macs pulls from when GitHub is slow: SWARM_URL is its
// Worker and SWARM_TOKEN its bearer token (the owner's, from 1Password). With both set, a run that finds no builder
// queues a pushed, clean HEAD there too. A joined Mac keeps its slots in SWARM_DIR (default ~/.rustybuns/swarm).
//
// The valve (~/.rustybuns/valve, per machine) is the water main for heavy work here. Shut, nothing heavy runs on this Mac:
// tests and native builds go to the builder, and wait for him while he is off. Open, a run with no builder runs here.
// With no file it is shut when BUILDER_HOST is set (this Mac coordinates, the builder builds) and open otherwise.
//
// BUILDER_HOST is an ssh name (user@max.local, or a Tailscale name). BUILDER_DIR is the builder's folder,
// relative to its home (default builder). BUILDER_WORKERS caps the suites one run starts at once (default 4).
// Exits with the worst code. Only send your own branches: the builder runs what it gets.
// No builder (unset, or not serving): `run` runs its command here; a base-ref run names the
// suites GitHub CI will run and exits 0, so you push and let `bun run pr <n>` wait for them.
// Each run leaves a record on the builder (runs/<slot>.json and .log, then runs/done) for its menu bar: scripts/builder-bar.ts.
import { homedir, tmpdir } from "node:os";
import { basename, relative, resolve } from "node:path";
import { arr, check, num, obj, str, type Of } from "../packages/util/src/guard.ts";
import { appDir, upFrom } from "./app-dirs.ts";
import { Matrix, report } from "./builder-nightly.ts";
import { tierLine } from "./ci-tier.ts";

/** A row of ci-apps' matrix: one without an app, test and prep isn't a job. */
const line = str(Infinity, { min: 0 });
const Row = obj({ app: line, test: line, prep: line, boot: (v: unknown) => v === true, shard: (v: unknown) => (typeof v === "string" ? v : "") });
export type Job = Of<typeof Row>;

// The `apps=` line of `ci-apps.ts test`: the apps with a test command or a boot check.
export function parseJobs(out: string): Job[] {
  const line = out.split("\n").find((l) => l.startsWith("apps="));
  if (!line) throw new Error("no apps= line in ci-apps output");
  const parsed: unknown = JSON.parse(line.slice(5));
  const jobs: Job[] = [];
  for (const row of check(Matrix, parsed)?.include ?? []) {
    const j = check(Row, row);
    if (j && (j.test || j.boot)) jobs.push(j);
  }
  return jobs;
}

// Run `fn` over items with at most `cap` at a time; the result is the worst (highest) code.
export async function pool<T>(items: T[], cap: number, fn: (item: T) => Promise<number>): Promise<number> {
  let worst = 0, next = 0;
  const lane = async () => { while (next < items.length) worst = Math.max(worst, await fn(items[next++]!)); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, lane));
  return worst;
}

// A commit of the working tree (untracked files too, .gitignore respected), built in a scratch index so
// the real index and the stash stack are never touched. HEAD itself when nothing changed.
export async function snapshot(cwd: string): Promise<string> {
  const git = (...args: string[]) => Bun.$`git ${args}`.cwd(cwd).quiet();
  const scratch = `${tmpdir()}/remote-ci-index-${process.pid}-${Date.now()}`;
  await Bun.write(scratch, Bun.file(resolve(cwd, (await git("rev-parse", "--git-path", "index")).text().trim())));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: scratch };
    await Bun.$`git add -A`.cwd(cwd).env(env).quiet();
    const tree = (await Bun.$`git write-tree`.cwd(cwd).env(env).quiet()).text().trim();
    const head = (await git("rev-parse", "HEAD")).text().trim();
    if (tree === (await git("rev-parse", "HEAD^{tree}")).text().trim()) return head;
    return (await git("commit-tree", tree, "-p", head, "-m", "remote-ci snapshot")).text().trim();
  } finally {
    await Bun.file(scratch).delete().catch(() => {});
  }
}

export type Valve = "on" | "off";
export const valveFile = () => `${process.env.RUSTYBUNS_HOME ?? `${homedir()}/.rustybuns`}/valve`;
// The file's text ("" when there is none) and BUILDER_HOST: an explicit on/off wins, else shut once there is a builder.
export const valveOf = (text: string, host = process.env.BUILDER_HOST): Valve =>
  text.trim() === "on" ? "on" : text.trim() === "off" || host ? "off" : "on";
export const valve = async (): Promise<Valve> => valveOf(await Bun.file(valveFile()).text().catch(() => ""));

// `pmset -g batt`: on power (AC, charging or charged), or the battery's percent while it drains. No pmset (a Linux
// builder) or no battery reads as on power.
export type Battery = { onPower: boolean; pct: number };
export function battery(pmset: string): Battery {
  const pct = Number(pmset.match(/(\d+)%/)?.[1] ?? 100);
  const draining = /Battery Power/.test(pmset) || /;\s*discharging/.test(pmset);
  return { onPower: !draining, pct };
}

// Where a run goes: the builder (with how many suites at once), here, or wait for him. A builder draining under 20% counts as off.
export type Plan = { where: "bob" | "here" | "wait"; cap: number; why?: string };
export function plan(v: Valve, up: boolean, batt: Battery, cap: number): Plan {
  const low = up && !batt.onPower && batt.pct < 20;
  if (!up || low) {
    const why = low ? `builder is on battery at ${batt.pct}%` : "Bob isn't taking runs (on him: bun run builder serve)";
    return v === "off" ? { where: "wait", cap, why: `valve shut, waiting for Bob (${why})` } : { where: "here", cap, why };
  }
  if (!batt.onPower) return { where: "bob", cap: 1, why: `builder is on battery (${batt.pct}%): one suite at a time` };
  return { where: "bob", cap };
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const BUSY = 75;
// A run touches its slot's lock every HEARTBEAT_MS while it holds it, however long its tests take. A lock untouched
// for STALE_MIN is a run that died (its worker sent home, its ssh dropped, its Mac asleep): the next claim takes it back.
// It was 90 minutes with no heartbeat, and one dead run held its slot that long while every other run waited.
const STALE_MIN = 3;
const HEARTBEAT_MS = 60_000;
// A push to a slot that hasn't finished in this long is hung (seen at over 2 hours): give up and give the slot back.
const PUSH_MS = 5 * 60_000;
/** What `load` answers when the push to the slot failed or hung: Bob went away. */
const PUSH_FAILED = 254;

export type Builder = { host: string; dir: string; ssh: string[] };

function remote(b: Builder, script: string) {
  const path = `export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; cd ${q(b.dir)} && `;
  return Bun.spawn([...b.ssh, b.host, path + script], { stdout: "pipe", stderr: "pipe" });
}

async function stream(p: ReturnType<typeof remote>, label: string, quiet = false) {
  let out = "";
  const pipe = async (s: ReadableStream<Uint8Array>) => {
    let rest = "";
    const dec = new TextDecoder();
    for await (const chunk of s) {
      const lines = (rest + dec.decode(chunk, { stream: true })).split("\n");
      rest = lines.pop()!;
      for (const line of lines) { out += line + "\n"; if (!quiet) console.log(`[${label}] ${line}`); }
    }
    if (rest) { out += rest; if (!quiet) console.log(`[${label}] ${rest}`); }
  };
  await Promise.all([pipe(p.stdout as ReadableStream<Uint8Array>), pipe(p.stderr as ReadableStream<Uint8Array>)]);
  return { code: await p.exited, out };
}

// What a run leaves on the builder for its menu bar (scripts/builder-bar.ts): runs/<slot>.json and .log while it
// runs, then both in runs/done, the last KEEP of them.
export type RunRecord = { who: string; cmd: string; started: number; ended?: number; code?: number };
const KEEP = 10;
const LOG = (slot: string) => `L="$PWD/runs/${slot}.log"; `;
// The command's own exit code, not tee's, without pipefail (dash has none): each ssh shell has its own $$.
const teed = (cmd: string) => `{ ${cmd}; echo $? > "$L.$$"; } 2>&1 | tee -a "$L"; c=$(cat "$L.$$"); rm -f "$L.$$"; exit "\${c:-1}"`;

// Claim a free slot, waiting while every slot is busy. The same round trip writes the slot's run record and
// reads the builder's battery.
export async function claim(b: Builder, rec?: RunRecord): Promise<{ slot: string; batt: Battery }> {
  const write = rec ? `printf '%s' ${q(JSON.stringify(rec))} > "runs/$d.json"; : > "runs/$d.log"; ` : "";
  const script = `mkdir -p locks runs/done && find locks -mindepth 1 -maxdepth 1 -mmin +${STALE_MIN} -exec rmdir {} + ; `
    + `for d in slot-*; do [ -d "$d/.git" ] && mkdir "locks/$d" 2>/dev/null && { ${write}echo "$d"; pmset -g batt 2>/dev/null; exit 0; }; done; exit ${BUSY}`;
  for (let waited = false; ; waited = true) {
    const { code, out } = await stream(remote(b, script), "claim", true);
    if (code === 0) { const [slot = "", ...rest] = out.trim().split("\n"); return { slot, batt: battery(rest.join("\n")) }; }
    if (code !== BUSY) throw new Error(`could not reach the builder (${code}): ${out.trim() || "no slots? run scripts/builder-setup.sh there"}`);
    if (!waited) console.log("every builder slot is busy; waiting");
    await Bun.sleep(5000);
  }
}

// Give the slot back; with its record, mark the run done and keep only the last KEEP finished ones. Without one
// (a slot claimed and handed back unrun), its record goes.
export function release(b: Builder, slot: string, rec?: RunRecord) {
  const s = q(slot), id = q(`done/${rec?.started ?? 0}-${slot}`);
  const done = rec ? `printf '%s' ${q(JSON.stringify(rec))} > runs/${id}.json; mv -f runs/${s}.log runs/${id}.log 2>/dev/null; rm -f runs/${s}.json; `
    + `ls -t runs/done/*.json 2>/dev/null | tail -n +${KEEP + 1} | while read -r f; do rm -f "$f" "${"$"}{f%.json}.log"; done; `
    : `rm -f runs/${s}.json runs/${s}.log; `;
  return stream(remote(b, `${done}rmdir locks/${s}`), "release", true);
}

// Send the commit straight to the slot's own repo, then check it out on top of its warm node_modules.
// The ref is the slot's scratch: one a run left behind (it failed before its checkout) is overwritten, not a reason to refuse.
export async function load(b: Builder, slot: string, sha: string, cwd: string) {
  const ref = `refs/remote-ci/${slot}`;
  const push = Bun.spawn(["git", "push", "-q", `${b.host}:${b.dir}/${slot}`, `+${sha}:${ref}`], {
    cwd, stdout: "inherit", stderr: "inherit", env: { ...process.env, GIT_SSH_COMMAND: b.ssh.join(" ") },
  });
  const hung = setTimeout(() => { console.error(`the push to ${slot} hung for ${PUSH_MS / 60_000} minutes; giving up`); push.kill(); }, PUSH_MS);
  const pushed = await push.exited;
  clearTimeout(hung);
  if (pushed) return PUSH_FAILED;
  const { code } = await stream(remote(b, LOG(slot) + teed(`cd ${q(slot)} && git checkout -q -f --detach ${sha} && git update-ref -d ${ref} `
    + `&& git clean -fdq && bun install --frozen-lockfile --silent`)), "setup");
  return code;
}

/** The file `bun run builder serve` keeps fresh in Bob's builder folder while he takes runs, and how often. */
export const SERVING = "serving";
const SERVE_BEAT_MS = 20_000;
/** An ssh exit that means the connection, not the command: Bob went away. */
const LOST = 255;

// One quick ssh round trip: true only while Bob is serving (`serving` touched in the last 2 minutes). Off, asleep,
// or not serving reads false, so nothing is sent to him until he says he takes runs.
export async function reachable(b: Builder): Promise<boolean> {
  const p = remote(b, `[ -n "$(find ${SERVING} -mmin -2 2>/dev/null)" ]`);
  const timer = setTimeout(() => p.kill(), 10_000);
  try { return (await p.exited) === 0; } finally { clearTimeout(timer); }
}

// typecheck.yml's steps, one after another, as one job: keep it in step with the workflow.
export const TYPECHECK = [
  "bun run typecheck", "bun scripts/conflict-markers.ts", "bun scripts/boundary-audit.ts", "bun scripts/migration-numbers.ts",
  "bun test ./scripts/conflict-markers.test.ts ./scripts/boundary-audit.test.ts ./scripts/ci-test-count.test.ts ./scripts/trial-github-cache.test.ts ./scripts/trial-flags.test.ts ./scripts/migration-numbers.test.ts",
  "bun run docs --check", "bun run site --check", "bun scripts/ci-guard.ts",
].join(" && ");

type RemoteJob = { label: string; dir: string; cmd: string };

/**
 * The jobs for `ci-apps.ts test`'s output: each touched app's suite, as apps.yml runs it. With `all`, everything both
 * required checks run: typecheck.yml as one job, apps.yml's packages, hooks and scripts suites when the branch touched
 * them, and each app's boot check. Not run: apps.yml's container images (Docker for linux/amd64); GitHub still builds those.
 */
export function ciJobs(out: string, all = false): RemoteJob[] {
  const apps = parseJobs(out).flatMap((j) => {
    const dir = appDir(j.app);
    const steps = [j.test, all && j.boot ? `bun ${upFrom(dir)}scripts/boot.ts` : ""].filter(Boolean);
    // A shard's label is the test swarm's suite name for it ("codesplitter:2/3").
    return steps.length ? [{ label: j.shard ? `${j.app}:${j.shard}` : j.app, dir, cmd: [j.prep, ...steps].filter(Boolean).join(" && ") }] : [];
  });
  if (!all) return apps;
  const flag = (k: string) => out.split("\n").includes(`${k}=true`);
  return [
    { label: "typecheck", dir: ".", cmd: TYPECHECK },
    ...(flag("packages") ? [{ label: "packages", dir: ".", cmd: "bun test packages" }] : []),
    ...(flag("hooks") ? [{ label: "hooks", dir: ".", cmd: "bun test ./.claude/hooks" }] : []),
    ...(flag("scripts") ? [{ label: "scripts", dir: ".", cmd: "bun test ./scripts" }] : []),
    ...apps,
  ];
}

// The suites the branch touched, as apps.yml would run them (`all`: everything both checks run).
const touched = async (base: string, cwd: string, all = false) => ciJobs(await Bun.$`bun scripts/ci-apps.ts test ${base}`.cwd(cwd).text(), all);

// What `all` passed, one JSON line per commit, on this Mac beside the valve: the list to merge from when GitHub is back.
export const Pass = obj({ sha: str(64, { re: /^[0-9a-f]{40,64}$/ }), branch: str(200), base: str(200), at: num(0, 1e15), jobs: arr(str(200), 500) });
export type Pass = Of<typeof Pass>;
export const passedFile = () => process.env.BUILDER_PASSED ?? `${homedir()}/.rustybuns/passed.jsonl`;
export async function recordPass(p: Pass) {
  const file = Bun.file(passedFile());
  await Bun.write(file, ((await file.exists()) ? await file.text() : "") + JSON.stringify(p) + "\n");
}
export async function readPasses(): Promise<Pass[]> {
  const file = Bun.file(passedFile());
  if (!(await file.exists())) return [];
  return (await file.text()).split("\n").flatMap((line) => {
    try { const p = check(Pass, JSON.parse(line)); return p ? [p] : []; } catch { return []; }
  });
}

/** The newest pass per branch, newest first, each with what the branch's head is now ("" when the branch is gone). */
export async function passes(cwd: string): Promise<(Pass & { now: string })[]> {
  const latest = new Map<string, Pass>();
  for (const p of await readPasses()) latest.set(p.branch, p);
  const head = async (b: string) => {
    for (const ref of [b, `origin/${b}`]) {
      const r = await Bun.$`git rev-parse --verify --quiet ${ref}^{commit}`.cwd(cwd).quiet().nothrow();
      if (r.exitCode === 0) return r.text().trim();
    }
    return "";
  };
  const sorted = [...latest.values()].sort((a, b) => b.at - a.at);
  return Promise.all(sorted.map(async (p) => ({ ...p, now: await head(p.branch) })));
}

async function passed(cwd: string): Promise<number> {
  const list = await passes(cwd);
  if (!list.length) console.log(`nothing passed yet (${passedFile()})`);
  for (const p of list) {
    const state = !p.now ? "branch gone" : p.now === p.sha ? "ready" : "moved since: run it again";
    console.log(`${p.sha.slice(0, 8)} ${p.branch}: ${state} (${new Date(p.at).toLocaleString()}; ${p.jobs.join(", ")})`);
  }
  return 0;
}

// No builder: one command runs here; every touched suite is GitHub CI's job, so say which and move on. With a swarm, a
// pushed HEAD is queued there as well, so whichever answers first (GitHub or one of our Macs) posts the checks.
async function fallback(argv: string[], cwd: string, why: string): Promise<number> {
  if (argv[0] === "run") {
    console.log(`${why}: running here`);
    return Bun.spawn(argv.slice(2), { cwd: resolve(cwd, argv[1]!), stdio: ["inherit", "inherit", "inherit"] }).exited;
  }
  const jobs = await touched(argv[0]!, cwd);
  console.log(`${why}: GitHub CI runs ${jobs.length ? jobs.map((j) => j.label).join(", ") : "no app suites"} for this branch`);
  if (swarm()) await queue(argv[0]!, cwd, true);
  console.log("push, then `bun run pr <n>` waits for them");
  return 0;
}

// The test swarm's Worker and token, when this Mac has them.
const swarm = () => (process.env.SWARM_URL && process.env.SWARM_TOKEN ? { url: process.env.SWARM_URL, token: process.env.SWARM_TOKEN } : undefined);
// Imported when used: build scripts import this file for `offload`, and their CI install may not have the swarm app's packages.
const runner = () => import("../apps/test-swarm/src/runner.ts");

/** `bun run builder queue`: HEAD's suites, as both required checks would run them, onto the swarm. Only a clean HEAD
 *  that origin has: a runner fetches the SHA from GitHub, and the statuses land on what the PR merges. `quiet`: from a
 *  fallback run, where not being pushed yet is normal and just skips it. */
export async function queue(base: string, cwd: string, quiet = false): Promise<number> {
  const s = swarm();
  if (!s) { console.error("SWARM_URL and SWARM_TOKEN aren't set: no test swarm to send to"); return 2; }
  const say = (why: string) => { (quiet ? console.log : console.error)(`not sent to the swarm: ${why}`); return quiet ? 0 : 1; };
  const branch = (await Bun.$`git rev-parse --abbrev-ref HEAD`.cwd(cwd).quiet().nothrow().text()).trim();
  const sha = (await Bun.$`git rev-parse HEAD`.cwd(cwd).quiet().text()).trim();
  if (!branch || branch === "HEAD") return say("HEAD isn't on a branch");
  if ((await Bun.$`git status --porcelain --untracked-files=no`.cwd(cwd).quiet().text()).trim()) return say("the working tree has uncommitted changes");
  const pushed = (await Bun.$`git ls-remote origin refs/heads/${branch}`.cwd(cwd).quiet().nothrow().text()).split(/\s/)[0];
  if (pushed !== sha) return say(`origin's ${branch} isn't at ${sha.slice(0, 8)}: push first`);
  const suites = (await touched(base, cwd, true)).map((j) => j.label);
  const res = await (await runner()).enqueue(s, { sha, branch, suites });
  if (!res?.ok) { say(`the swarm answered ${res ? res.status : "nothing"}`); return 1; }
  console.log(`queued ${suites.join(", ")} for ${sha.slice(0, 8)} on the swarm; its typecheck and apps statuses land on the PR`);
  return 0;
}

/** `bun run builder join [--slots N]`: this Mac takes jobs until Ctrl-C. Each slot looks its suite up with
 *  `ci-apps.ts test <root commit>` (every suite, as apps.yml asks when it has no base) at the job's own SHA, so a suite
 *  runs what that commit's checks would. */
async function joinSwarm(argv: string[], cwd: string): Promise<number> {
  const s = swarm();
  if (!s) { console.error("SWARM_URL and SWARM_TOKEN aren't set: no test swarm to join"); return 2; }
  const i = argv.indexOf("--slots"), slots = i < 0 ? 1 : Number(argv[i + 1]);
  if (!Number.isInteger(slots) || slots < 1 || slots > 16) { console.error("--slots takes 1 to 16"); return 2; }
  const remote = (await Bun.$`git remote get-url origin`.cwd(cwd).quiet().text()).trim();
  const stop = new AbortController();
  process.once("SIGINT", () => { console.log("leaving the swarm: running suites stop, and their jobs go back on the queue"); stop.abort(); });
  process.once("SIGTERM", () => stop.abort());
  await (await runner()).join({
    swarm: s, slots, source: cwd, remote, signal: stop.signal,
    name: (process.env.SWARM_NAME || (await Bun.$`hostname -s`.quiet().text()).trim()).slice(0, 70),
    home: process.env.SWARM_DIR ?? `${homedir()}/.rustybuns/swarm`,
    resolve: async (slot, suite) => {
      const root = (await Bun.$`git rev-list --max-parents=0 HEAD`.cwd(slot).quiet().nothrow().text()).split("\n")[0]!;
      const out = await Bun.$`bun scripts/ci-apps.ts test ${root}`.cwd(slot).quiet().nothrow();
      if (out.exitCode) return { why: `ci-apps.ts test failed at this commit:\n${out.stderr.toString().slice(-2000)}` };
      const job = ciJobs(out.text(), true).find((j) => j.label === suite);
      return job ? { dir: job.dir, cmd: job.cmd } : { why: `no suite "${suite}" at this commit (ci-apps.ts doesn't list it)` };
    },
  });
  return 0;
}

/** `bun run builder serve`, on Bob: he takes runs until Ctrl-C. `serving` stays fresh while this runs (a run is sent only
 *  then), and caffeinate keeps him awake so a run isn't cut off by sleep. Stopping lets running runs finish; new ones wait. */
async function serve(): Promise<number> {
  const dir = resolve(homedir(), process.env.BUILDER_DIR ?? "builder"), file = `${dir}/${SERVING}`;
  if (!(await Bun.file(`${dir}/slot-1/.git/HEAD`).exists())) { console.error(`no slots in ${dir}: run scripts/builder-setup.sh here first`); return 2; }
  const beat = () => Bun.write(file, `${new Date().toISOString()}\n`);
  await beat();
  const timer = setInterval(beat, SERVE_BEAT_MS);
  const awake = Bun.which("caffeinate") ? Bun.spawn(["caffeinate", "-i", "-w", String(process.pid)], { stdout: "ignore", stderr: "ignore" }) : null;
  console.log(`taking runs (${dir}); Ctrl-C to stop: runs already going finish, new ones wait for the next serve`);
  await new Promise<void>((done) => { process.once("SIGINT", done); process.once("SIGTERM", done); });
  clearInterval(timer);
  awake?.kill();
  await Bun.$`rm -f ${file}`.quiet().nothrow();
  console.log("not taking runs");
  return 0;
}

const builder = (host: string): Builder =>
  ({ host, dir: process.env.BUILDER_DIR ?? "builder", ssh: (process.env.BUILDER_SSH ?? "ssh -o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=15 -o ServerAliveCountMax=4").split(" ") });

// `bun run builder off|on` sets the valve; bare `bun run builder` says which way it is and whether the builder answers.
async function setValve(arg: string | undefined): Promise<number> {
  if (arg === "on" || arg === "off") await Bun.write(valveFile(), `${arg}\n`);
  const v = await valve(), host = process.env.BUILDER_HOST;
  const bob = host ? ((await reachable(builder(host))) ? `builder ${host} is taking runs` : `builder ${host} isn't taking runs (off, asleep, or not serving: bun run builder serve on him)`) : "no BUILDER_HOST";
  console.log(`valve ${v === "off" ? "shut: heavy work goes to the builder, and waits for him" : "open: with no builder, work runs here"}; ${bob}`);
  return 0;
}

/** What `main` answers when it was given a commit (`at`) and the builder couldn't take it now: nothing ran. */
export const NOT_RUN = 125;

/** `at`: run that commit (it must be in `cwd`'s repo) instead of the working tree, on the builder only: no builder now
 *  (unset, off, charging) answers NOT_RUN at once instead of running here or waiting. scripts/ring-red.ts bisects with it. */
export async function main(argv: string[], cwd: string, at?: string): Promise<number> {
  const host = process.env.BUILDER_HOST;
  const usage = "usage: bun run builder [on|off]  |  bun run builder queue [base-ref]  |  bun run builder join [--slots N]  |  bun run builder serve  |  bun run builder <base-ref>  |  bun run builder all [base-ref]  |  bun run builder passed  |  bun run builder run <dir> <cmd...>  |  bun run builder nightly";
  if (!argv.length || argv[0] === "on" || argv[0] === "off") return setValve(argv[0]);
  if (argv[0] === "nightly") return nightly(host);
  if (argv[0] === "passed") return passed(cwd);
  if (argv[0] === "queue") return queue(argv[1] ?? "origin/main", cwd);
  if (argv[0] === "join") return joinSwarm(argv, cwd);
  if (argv[0] === "serve") return serve();
  const all = argv[0] === "all";
  if (all) argv = [argv[1] ?? "origin/main"];
  if (argv[0] === "run" && argv.length < 3) { console.error(usage); return 2; }
  const v = await valve();
  if (!host) {
    if (at) { console.error("BUILDER_HOST is not set: a run at a commit needs the builder"); return NOT_RUN; }
    if (v === "off") { console.error(`valve shut but BUILDER_HOST is not set, so nothing runs: \`bun run builder on\` to run here`); return 1; }
    return fallback(argv, cwd, "BUILDER_HOST is not set, so there is no builder (scripts/builder-setup.sh sets one up)");
  }
  const b = builder(host);
  let jobs: { label: string; dir: string; cmd: string }[];
  if (argv[0] === "run") {
    jobs = [{ label: argv[1]!, dir: argv[1]!, cmd: argv.slice(2).map(q).join(" ") }];
  } else {
    const files = (await Bun.$`git diff --name-only ${argv[0]!}...HEAD`.cwd(cwd).quiet().nothrow().text()).split("\n").filter(Boolean);
    console.log(tierLine(files));
    jobs = await touched(argv[0]!, cwd, all);
    if (!jobs.length) { console.log("no suites touched"); return 0; }
  }

  const poll = Number(process.env.BUILDER_POLL_MS ?? 30_000);
  const branch = (await Bun.$`git rev-parse --abbrev-ref HEAD`.cwd(cwd).quiet().nothrow().text()).trim();
  // Who, for the builder's menu bar: the worker (office/<name>), or the worktree's folder on a detached HEAD.
  const who = process.env.BUILDER_WHO || (branch && branch !== "HEAD" ? branch.replace(/^office\//, "") : basename(cwd));
  const rec: RunRecord = { who, started: Date.now(),
    cmd: argv[0] === "run" ? `${argv[1]}: ${argv.slice(2).join(" ")}` : `suites: ${jobs.map((j) => j.label).join(", ")}` };
  for (;;) {
    const r = await attempt();
    if (r !== LOST) return r;
    if (at) { console.error("the builder went away mid-run"); return NOT_RUN; }
    console.log("lost Bob mid-run: waiting for him again, then running it from the start");
  }

  /** Wait for Bob and a slot, then run: the run's code, or LOST when Bob went away under it (nothing to blame on the code). */
  async function attempt(): Promise<number> {
    let slot = "", cap = Number(process.env.BUILDER_WORKERS ?? 4);
    for (let said = ""; ; ) {
      const up = await reachable(b);
      // he can go between the check and the claim: that is waiting, not a failure
      const got = up ? await claim(b, { ...rec, started: (rec.started = Date.now()) }).catch(() => undefined) : undefined;
      const p = plan(v, !!got, got?.batt ?? { onPower: true, pct: 100 }, cap);
      if (p.where === "bob") { slot = got!.slot; cap = p.cap; if (p.why) console.log(p.why); break; }
      if (got) await release(b, got.slot);
      if (at) { console.error(`the builder can't take a run now (${p.why ?? "off"})`); return NOT_RUN; }
      if (p.where === "here") return fallback(argv, cwd, p.why!);
      if (said !== p.why) console.log((said = p.why!));
      await Bun.sleep(poll);
    }

    // The heartbeat: while this run holds the slot, its lock stays fresh, so only a dead run's lock goes stale.
    const beat = setInterval(() => { remote(b, `touch locks/${q(slot)}`); }, HEARTBEAT_MS);
    const finish = (code: number) => { clearInterval(beat); return code === LOST ? release(b, slot) : release(b, slot, { ...rec, ended: Date.now(), code }); };
    const giveBack = () => { finish(130).finally(() => process.exit(130)); };
    process.once("SIGINT", giveBack);
    process.once("SIGTERM", giveBack);
    let code = 1;
    try {
      const sent = at ?? await snapshot(cwd);
      const setup = await load(b, slot, sent, cwd);
      // a push that failed or hung, or a setup whose ssh dropped, is Bob going away, not the branch
      if (setup === PUSH_FAILED || setup === LOST) return (code = LOST);
      if (setup) return (code = setup);
      console.log(`running ${jobs.map((j) => j.label).join(", ")} on ${host} (${slot}), ${cap} at a time`);
      const t0 = performance.now();
      const codes: number[] = [];
      const worst = await pool(jobs, cap, async (j) => { const c = (await stream(remote(b, LOG(slot) + teed(`cd ${q(`${slot}/${j.dir}`)} && ${j.cmd}`)), j.label)).code; codes.push(c); return c; });
      if (codes.includes(LOST)) return (code = LOST);
      console.log(`${worst ? "failed" : "passed"} in ${((performance.now() - t0) / 1000).toFixed(1)}s on ${host}`);
      if (all && !worst) {
        // Only a committed HEAD is written down: uncommitted changes aren't what the PR would merge.
        const head = (await Bun.$`git rev-parse HEAD`.cwd(cwd).quiet().text()).trim();
        if (sent !== head) console.log("not written down as ready: the working tree has uncommitted changes");
        else {
          const named = branch && branch !== "HEAD" ? branch
            : (await Bun.$`git branch -a --points-at HEAD ${"--format=%(refname:short)"}`.cwd(cwd).quiet().nothrow().text()).split("\n").find((r) => r && !r.startsWith("(")) ?? who;
          await recordPass({ sha: head, branch: named.replace(/^origin\//, ""), base: argv[0]!, at: Date.now(), jobs: jobs.map((j) => j.label) });
          console.log(`${head.slice(0, 8)} ${named} written down as ready: bun run builder passed`);
        }
      }
      return (code = worst);
    } finally {
      process.off("SIGINT", giveBack);
      process.off("SIGTERM", giveBack);
      // Bob gone: giving the slot back may not reach him either (a lock untouched for STALE_MIN is taken back anyway)
      await finish(code).catch(() => {});
    }
  }
}

// `bun run builder nightly`: the last nightly desktop build's failures, read from the builder (or this Mac, when it is one).
async function nightly(host: string | undefined): Promise<number> {
  let text = "";
  if (host) {
    const b = builder(host);
    if (!(await reachable(b))) { console.log(`builder ${host} isn't taking runs`); return 1; }
    text = (await stream(remote(b, "cat nightly/results.json"), "nightly", true)).out;
  } else {
    const f = Bun.file(resolve(homedir(), "builder", "nightly", "results.json"));
    text = (await f.exists()) ? await f.text() : "";
  }
  const r = report(text);
  console.log(r.text);
  return r.ok ? 0 : 1;
}

const top = async () => (await Bun.$`git rev-parse --show-toplevel`.cwd(process.cwd()).text()).trim();

// For a heavy build script, first thing: with the valve shut, run this same command on the builder instead and exit with
// its code. Open, or already on the builder (no BUILDER_HOST there), it returns and the build runs here.
// --optional is the web build's own call (`bun run build`, which a deploy runs and needs here), so it stays here.
export async function offload(): Promise<void> {
  if (!process.env.BUILDER_HOST || process.argv.includes("--optional") || (await valve()) === "on") return;
  const root = await top();
  const cmd = ["bun", relative(process.cwd(), process.argv[1]!), ...process.argv.slice(2)];
  process.exit(await main(["run", relative(root, process.cwd()) || ".", ...cmd], root));
}

if (import.meta.main) process.exit(await main(process.argv.slice(2), await top()));
