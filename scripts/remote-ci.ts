// Run tests on the builder Mac over SSH (notes/local-build-monster.md, #2329). The builder holds a few warm
// checkouts (slots, made by scripts/builder-setup.sh); each run claims a free one, so agents can share it.
// What runs is your working tree as it is, committed or not, untracked files included. Nothing goes to GitHub.
//
//   bun run builder <base-ref>                 the suites the branch touched (what apps.yml would run)
//   bun run builder run <dir> <cmd...>         one command in <dir>, e.g. run apps/skate-tech-park bun test test/ramp.test.ts
//   bun run builder off | on                   shut or open this Mac's valve; bare `bun run builder` says which, and if Bob answers
//
// The valve (~/.rustybuns/valve, per machine) is the water main for heavy work here. Shut, nothing heavy runs on this Mac:
// tests and native builds go to the builder, and wait for him while he is off. Open, a run with no builder runs here.
// With no file it is shut when BUILDER_HOST is set (this Mac coordinates, the builder builds) and open otherwise.
//
// BUILDER_HOST is an ssh name (user@max.local, or a Tailscale name). BUILDER_DIR is the builder's folder,
// relative to its home (default builder). BUILDER_WORKERS caps the suites one run starts at once (default 4).
// Exits with the worst code. Only send your own branches: the builder runs what it gets.
// No builder (unset, or ssh can't reach it in 5 s): `run` runs its command here; a base-ref run names the
// suites GitHub CI will run and exits 0, so you push and let `bun run pr <n>` wait for them.
import { homedir, tmpdir } from "node:os";
import { relative, resolve } from "node:path";

export type Job = { app: string; test: string; prep: string };

// The `apps=` line of `ci-apps.ts test`: only apps with a test command run here.
export function parseJobs(out: string): Job[] {
  const line = out.split("\n").find((l) => l.startsWith("apps="));
  if (!line) throw new Error("no apps= line in ci-apps output");
  const parsed: unknown = JSON.parse(line.slice(5));
  const include = typeof parsed === "object" && parsed !== null && "include" in parsed && Array.isArray(parsed.include) ? parsed.include : [];
  const jobs: Job[] = [];
  for (const j of include) {
    if (typeof j !== "object" || j === null) continue;
    const { app, test, prep } = j as Record<string, unknown>;
    if (typeof app === "string" && typeof test === "string" && test && typeof prep === "string") jobs.push({ app, test, prep });
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
    const why = low ? `builder is on battery at ${batt.pct}%` : "builder is off";
    return v === "off" ? { where: "wait", cap, why: `valve shut, waiting for Bob (${why})` } : { where: "here", cap, why };
  }
  if (!batt.onPower) return { where: "bob", cap: 1, why: `builder is on battery (${batt.pct}%): one suite at a time` };
  return { where: "bob", cap };
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const BUSY = 75;
// Locks older than this are from a run whose ssh died; take them back.
const STALE_MIN = 90;

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

// Claim a free slot, waiting while every slot is busy. The same round trip reads the builder's battery.
export async function claim(b: Builder): Promise<{ slot: string; batt: Battery }> {
  const script = `mkdir -p locks && find locks -mindepth 1 -maxdepth 1 -mmin +${STALE_MIN} -exec rmdir {} + ; `
    + `for d in slot-*; do [ -d "$d/.git" ] && mkdir "locks/$d" 2>/dev/null && { echo "$d"; pmset -g batt 2>/dev/null; exit 0; }; done; exit ${BUSY}`;
  for (let waited = false; ; waited = true) {
    const { code, out } = await stream(remote(b, script), "claim", true);
    if (code === 0) { const [slot = "", ...rest] = out.trim().split("\n"); return { slot, batt: battery(rest.join("\n")) }; }
    if (code !== BUSY) throw new Error(`could not reach the builder (${code}): ${out.trim() || "no slots? run scripts/builder-setup.sh there"}`);
    if (!waited) console.log("every builder slot is busy; waiting");
    await Bun.sleep(5000);
  }
}

export const release = (b: Builder, slot: string) => stream(remote(b, `rmdir locks/${q(slot)}`), "release", true);

// Send the commit straight to the slot's own repo, then check it out on top of its warm node_modules.
export async function load(b: Builder, slot: string, sha: string, cwd: string) {
  const ref = `refs/remote-ci/${slot}`;
  const push = Bun.spawn(["git", "push", "-q", `${b.host}:${b.dir}/${slot}`, `${sha}:${ref}`], {
    cwd, stdout: "inherit", stderr: "inherit", env: { ...process.env, GIT_SSH_COMMAND: b.ssh.join(" ") },
  });
  if (await push.exited) return 1;
  const { code } = await stream(remote(b, `cd ${q(slot)} && git checkout -q -f --detach ${sha} && git update-ref -d ${ref} `
    + `&& git clean -fdq && bun install --frozen-lockfile --silent`), "setup");
  return code;
}

// One quick ssh round trip: false when Bob is off, charging or asleep, so a run never hangs on him.
export async function reachable(b: Builder): Promise<boolean> {
  const p = Bun.spawn([...b.ssh, b.host, "true"], { stdout: "ignore", stderr: "ignore" });
  const timer = setTimeout(() => p.kill(), 10_000);
  try { return (await p.exited) === 0; } finally { clearTimeout(timer); }
}

// The suites the branch touched, as apps.yml would run them.
const touched = async (base: string, cwd: string) =>
  parseJobs(await Bun.$`bun scripts/ci-apps.ts test ${base}`.cwd(cwd).text())
    .map((j) => ({ label: j.app, dir: `apps/${j.app}`, cmd: j.prep ? `${j.prep} && ${j.test}` : j.test }));

// No builder: one command runs here; every touched suite is GitHub CI's job, so say which and move on.
async function fallback(argv: string[], cwd: string, why: string): Promise<number> {
  if (argv[0] === "run") {
    console.log(`${why}: running here`);
    return Bun.spawn(argv.slice(2), { cwd: resolve(cwd, argv[1]!), stdio: ["inherit", "inherit", "inherit"] }).exited;
  }
  const jobs = await touched(argv[0]!, cwd);
  console.log(`${why}: GitHub CI runs ${jobs.length ? jobs.map((j) => j.label).join(", ") : "no app suites"} for this branch`);
  console.log("push, then `bun run pr <n>` waits for them");
  return 0;
}

const builder = (host: string): Builder =>
  ({ host, dir: process.env.BUILDER_DIR ?? "builder", ssh: (process.env.BUILDER_SSH ?? "ssh -o BatchMode=yes -o ConnectTimeout=5").split(" ") });

// `bun run builder off|on` sets the valve; bare `bun run builder` says which way it is and whether the builder answers.
async function setValve(arg: string | undefined): Promise<number> {
  if (arg === "on" || arg === "off") await Bun.write(valveFile(), `${arg}\n`);
  const v = await valve(), host = process.env.BUILDER_HOST;
  const bob = host ? ((await reachable(builder(host))) ? `builder ${host} answers` : `builder ${host} is off`) : "no BUILDER_HOST";
  console.log(`valve ${v === "off" ? "shut: heavy work goes to the builder, and waits for him" : "open: with no builder, work runs here"}; ${bob}`);
  return 0;
}

export async function main(argv: string[], cwd: string): Promise<number> {
  const host = process.env.BUILDER_HOST;
  const usage = "usage: bun run builder [on|off]  |  bun run builder <base-ref>  |  bun run builder run <dir> <cmd...>";
  if (!argv.length || argv[0] === "on" || argv[0] === "off") return setValve(argv[0]);
  if (argv[0] === "run" && argv.length < 3) { console.error(usage); return 2; }
  const v = await valve();
  if (!host) {
    if (v === "off") { console.error(`valve shut but BUILDER_HOST is not set, so nothing runs: \`bun run builder on\` to run here`); return 1; }
    return fallback(argv, cwd, "BUILDER_HOST is not set, so there is no builder (scripts/builder-setup.sh sets one up)");
  }
  const b = builder(host);
  let jobs: { label: string; dir: string; cmd: string }[];
  if (argv[0] === "run") {
    jobs = [{ label: argv[1]!, dir: argv[1]!, cmd: argv.slice(2).map(q).join(" ") }];
  } else {
    jobs = await touched(argv[0]!, cwd);
    if (!jobs.length) { console.log("no suites touched"); return 0; }
  }

  const poll = Number(process.env.BUILDER_POLL_MS ?? 30_000);
  let slot = "", cap = Number(process.env.BUILDER_WORKERS ?? 4);
  for (let said = ""; ; ) {
    const up = await reachable(b);
    const got = up ? await claim(b) : undefined;
    const p = plan(v, up, got?.batt ?? { onPower: true, pct: 100 }, cap);
    if (p.where === "bob") { slot = got!.slot; cap = p.cap; if (p.why) console.log(p.why); break; }
    if (got) await release(b, got.slot);
    if (p.where === "here") return fallback(argv, cwd, p.why!);
    if (said !== p.why) console.log((said = p.why!));
    await Bun.sleep(poll);
  }

  const giveBack = () => { release(b, slot).finally(() => process.exit(130)); };
  process.once("SIGINT", giveBack);
  process.once("SIGTERM", giveBack);
  try {
    const setup = await load(b, slot, await snapshot(cwd), cwd);
    if (setup) return setup;
    console.log(`running ${jobs.map((j) => j.label).join(", ")} on ${host} (${slot}), ${cap} at a time`);
    const t0 = performance.now();
    const worst = await pool(jobs, cap, async (j) => (await stream(remote(b, `cd ${q(`${slot}/${j.dir}`)} && ${j.cmd}`), j.label)).code);
    console.log(`${worst ? "failed" : "passed"} in ${((performance.now() - t0) / 1000).toFixed(1)}s on ${host}`);
    return worst;
  } finally {
    process.off("SIGINT", giveBack);
    process.off("SIGTERM", giveBack);
    await release(b, slot);
  }
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
