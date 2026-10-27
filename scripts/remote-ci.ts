// Run tests on the builder Mac over SSH (notes/local-build-monster.md, #2329). The builder holds a few warm
// checkouts (slots, made by scripts/builder-setup.sh); each run claims a free one, so agents can share it.
// What runs is your working tree as it is, committed or not, untracked files included. Nothing goes to GitHub.
//
//   bun run builder <base-ref>                 the suites the branch touched (what apps.yml would run)
//   bun run builder run <dir> <cmd...>         one command in <dir>, e.g. run apps/skate-tech-park bun test test/ramp.test.ts
//
// BUILDER_HOST is an ssh name (user@max.local, or a Tailscale name). BUILDER_DIR is the builder's folder,
// relative to its home (default builder). BUILDER_WORKERS caps the suites one run starts at once (default 4).
// Exits with the worst code. Only send your own branches: the builder runs what it gets.
import { tmpdir } from "node:os";

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
  await Bun.write(scratch, Bun.file(`${cwd}/${(await git("rev-parse", "--git-path", "index")).text().trim()}`));
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
    for await (const chunk of s.pipeThrough(new TextDecoderStream())) {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop()!;
      for (const line of lines) { out += line + "\n"; if (!quiet) console.log(`[${label}] ${line}`); }
    }
    if (rest) { out += rest; if (!quiet) console.log(`[${label}] ${rest}`); }
  };
  await Promise.all([pipe(p.stdout as ReadableStream<Uint8Array>), pipe(p.stderr as ReadableStream<Uint8Array>)]);
  return { code: await p.exited, out };
}

// Claim a free slot, waiting while every slot is busy.
export async function claim(b: Builder): Promise<string> {
  const script = `mkdir -p locks && find locks -mindepth 1 -maxdepth 1 -mmin +${STALE_MIN} -exec rmdir {} + ; `
    + `for d in slot-*; do [ -d "$d/.git" ] && mkdir "locks/$d" 2>/dev/null && { echo "$d"; exit 0; }; done; exit ${BUSY}`;
  for (let waited = false; ; waited = true) {
    const { code, out } = await stream(remote(b, script), "claim", true);
    if (code === 0) return out.trim();
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

export async function main(argv: string[], cwd: string): Promise<number> {
  const host = process.env.BUILDER_HOST;
  const usage = "usage: bun run builder <base-ref>  |  bun run builder run <dir> <cmd...>";
  if (!argv.length || (argv[0] === "run" && argv.length < 3)) { console.error(usage); return 2; }
  if (!host) { console.error("BUILDER_HOST is not set, so there is no builder: run the tests here instead (scripts/builder-setup.sh sets one up)"); return 2; }
  const b: Builder = { host, dir: process.env.BUILDER_DIR ?? "builder", ssh: (process.env.BUILDER_SSH ?? "ssh -o BatchMode=yes").split(" ") };
  const cap = Number(process.env.BUILDER_WORKERS ?? 4);

  let jobs: { label: string; dir: string; cmd: string }[];
  if (argv[0] === "run") {
    jobs = [{ label: argv[1]!, dir: argv[1]!, cmd: argv.slice(2).map(q).join(" ") }];
  } else {
    jobs = parseJobs(await Bun.$`bun scripts/ci-apps.ts test ${argv[0]!}`.cwd(cwd).text())
      .map((j) => ({ label: j.app, dir: `apps/${j.app}`, cmd: j.prep ? `${j.prep} && ${j.test}` : j.test }));
    if (!jobs.length) { console.log("no suites touched"); return 0; }
  }

  const sha = await snapshot(cwd);
  const slot = await claim(b);
  const giveBack = () => { release(b, slot).finally(() => process.exit(130)); };
  process.once("SIGINT", giveBack);
  process.once("SIGTERM", giveBack);
  try {
    const setup = await load(b, slot, sha, cwd);
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

if (import.meta.main) process.exit(await main(process.argv.slice(2), (await Bun.$`git rev-parse --show-toplevel`.text()).trim()));
