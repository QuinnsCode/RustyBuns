// The runners codeSplitter brings itself (#750), beside the ones you run (scripts/runner.ts):
// each claims a queued run through the same claimRun as any runner (checks.ts), so one of
// your own can still take work, and runs it the way scripts/runner.ts does: a fresh clone at
// the run's sha (or main with a branch's files laid over it, for a branch not pushed), the
// check's command with sh, its output streamed to the run's log every couple of seconds (the
// heartbeat), exit 0 passing it, and a junit.xml left behind going up as the report.
//
//   - The desktop drains its own queue, in-process: when checks are queued here, and on the
//     5-minute cron for any left over, one run at a time per repo, in a temp dir on this
//     machine, as the repo's owner. Off in the tests (CHECKS_RUNNER=off, set by local()), so
//     they claim runs themselves.
//   - On Cloudflare, with CI_RUNNER bound (deploy with CODESPLITTERS_CHECKS=1), a CiRunner
//     Durable Object per repo runs them in containers (deploy-sandbox/ci.Dockerfile): one run
//     per alarm, so one at a time per repo, each in a fresh container that is destroyed after.
//     The container gets no secrets, starts with the internet off, and reaches only the clone
//     and the package registries through the egress gate (#681). A run gets RUN_BUDGET_MS of
//     the alarm's 15 minutes. Each one counts against the `checks` rate limit (limits.ts),
//     charged to the repo's owner, and its minutes against the site-wide `containers` budget,
//     which admins' runs count against too: one over either is cancelled, saying so. The
//     hourly cron wakes any repo with runs still queued, in case a kick went missing.
//
// It costs container time: see "Checks in a container" in REFERENCE.md for the price.

import { claimRun, get, readAt, updateRun, type CheckRun } from "./checks.ts";
import { RUN_BUDGET_MS, readExec } from "./deploy-runner.ts";
import { gate, hostList, hostOf, REGISTRIES, type GateExports } from "./egress.ts";
import { json, type Env } from "./env.ts";
import { isAdmin } from "./identity.ts";
import { charge, SITE } from "./limits.ts";
import { portFetch, type ContainerApi } from "./sandbox.ts";

/** A run as claimRun hands it out. */
export type Job = NonNullable<Awaited<ReturnType<typeof claimRun>>>;

/** Where a run happens, in its own empty directory: a temp dir on this machine, or a container. */
export interface Machine {
  /** Run a command there; its output goes to `out` as it comes. Resolves to the exit code. */
  exec(cmd: string[], out: (s: string) => void): Promise<number>;
  /** Write files (relative paths), or remove the null ones. */
  write(files: Record<string, string | null>): Promise<void>;
  /** A file's text, or undefined when there's none. */
  read(path: string): Promise<string | undefined>;
  /** Stop whatever's running: the run lost its claim. */
  stop(): void;
}

/** A branch's own files as they are now, null for one it deleted: what goes over main's clone. */
export async function branchFiles(env: Env, owner: string, repo: string, ref: string) {
  const { results } = await env.DB.prepare("SELECT path, deleted FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0").bind(owner, repo, ref).all();
  const files: Record<string, string | null> = {};
  for (const { path, deleted } of results as { path: string; deleted: number }[]) {
    if (path.split("/").some((s) => s === ".." || s === "")) throw new Error(`${path} is outside the repo`);
    if (deleted) { files[path] = null; continue; }
    const text = await readAt(env, owner, repo, ref, path);
    if (text === null) throw new Error(`reading ${path} on ${ref}`);
    files[path] = text + "\n";
  }
  return files;
}

/**
 * One claimed run, start to finish, on `m`, reporting as `label`. A report that finds the
 * run isn't this runner's any more (it went quiet and was requeued, or was cancelled) stops it.
 */
export async function runJob(env: Env, owner: string, repo: string, job: Job, label: string, start: () => Promise<Machine>, fallback = "bun test") {
  let out = "", lost = false, m: Machine | undefined;
  const report = async (u: Parameters<typeof updateRun>[2]) => {
    const run = await get(env, job.id);
    if (!run || run.runner_label !== label || run.status !== "running") { lost = true; m?.stop(); return; }
    await updateRun(env, run, u, "codesplitters");
  };
  const flush = async () => { const append = out; out = ""; if (append) await report({ append }); };
  let tick: ReturnType<typeof setInterval> | undefined;
  try {
    m = await start();
    if (!job.clone_url) throw new Error("the repo has no git to clone yet");
    // Its output stays out of the log: the clone URL carries a read token.
    let said = "";
    if (await m.exec(["git", "clone", "--quiet", job.clone_url, "."], (s) => { said += s; }))
      throw new Error(`git clone failed: ${said.split(job.clone_url).join("<the repo>")}`);
    // A branch that hasn't gone up as a git commit (`<branch>@<time>`): main, with the branch's files laid over it as they are now.
    if (/^[0-9a-f]{40}$/.test(job.sha)) { if (await m.exec(["git", "checkout", "--quiet", job.sha], () => {})) throw new Error(`${job.sha} isn't a commit in the repo's git`); }
    else if (/@\d+$/.test(job.sha)) {
      const files = await branchFiles(env, owner, repo, job.ref);
      await m.write(files);
      const n = Object.keys(files).length;
      out = `main, with ${n} file${n === 1 ? "" : "s"} from branch ${job.ref} as they are now\n`;
    } else throw new Error(`${job.sha} isn't a commit in the repo's git`);
    const command = job.command ?? fallback;
    out += `$ ${command}\n`;
    tick = setInterval(() => void flush().catch(() => null), 2000);
    const code = await m.exec(["sh", "-c", command], (s) => { out += s; });
    clearInterval(tick);
    if (lost) return;
    const junit = await m.read("junit.xml");
    await report({ append: out + `\nexit ${code}\n`, status: code === 0 ? "passed" : "failed", ...(junit && { junit }) });
  } catch (e) {
    clearInterval(tick);
    if (!lost) await report({ append: `${out}\n${(e as Error).message}\n`, status: "failed" }).catch(() => null);
  }
}

// ---- The desktop: its own queue, in-process ----

/** Whether this is the desktop app running its own checks: Bun, no accounts, and not turned off. */
export const desktopRuns = (env: Env) => typeof Bun !== "undefined" && !env.BETTER_AUTH_SECRET && env.CHECKS_RUNNER !== "off" && !env.CI_RUNNER;

/** A temp dir on this machine. The command gets this process's env, as a runner started from a shell would, and CI=1. */
async function localMachine(): Promise<Machine & { dispose(): Promise<void> }> {
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { dirname, join, relative, resolve } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "cs-checks-"));
  const inside = (p: string) => {
    const at = resolve(dir, p);
    if (!relative(dir, at) || relative(dir, at).startsWith("..")) throw new Error(`${p} is outside the repo`);
    return at;
  };
  const live = new Set<{ kill(): void }>();
  return {
    async exec(cmd, out) {
      const p = Bun.spawn(cmd, { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "1" } });
      live.add(p);
      const pump = async (s: ReadableStream<Uint8Array>) => { const d = new TextDecoder(); for await (const b of s) out(d.decode(b, { stream: true })); out(d.decode()); };
      const [code] = await Promise.all([p.exited, pump(p.stdout), pump(p.stderr)]).finally(() => live.delete(p));
      return code;
    },
    async write(files) {
      for (const [path, text] of Object.entries(files)) {
        const at = inside(path);
        if (text === null) { await rm(at, { force: true }); continue; }
        await mkdir(dirname(at), { recursive: true });
        await Bun.write(at, text);
      }
    },
    read: (path) => Bun.file(inside(path)).text().catch(() => undefined),
    stop() { for (const p of live) p.kill(); },
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

const draining = new Map<string, Promise<void>>(), again = new Set<string>();

/** Run the repo's queued checks here, one at a time, until there are none. A kick while it's at it goes round once more. */
function drain(env: Env, owner: string, repo: string) {
  const key = `${owner}/${repo}`;
  if (draining.has(key)) { again.add(key); return draining.get(key)!; }
  const go = (async () => {
    const { hostname } = await import("node:os");
    const label = `desktop@${hostname()}`;
    do {
      again.delete(key);
      for (let job = await claimRun(env, owner, repo, label, [], Date.now(), owner); job; job = await claimRun(env, owner, repo, label, [], Date.now(), owner)) {
        let m: Awaited<ReturnType<typeof localMachine>> | undefined;
        await runJob(env, owner, repo, job, label, async () => (m = await localMachine())).finally(() => m?.dispose());
      }
    } while (again.has(key));
  })().catch((e) => console.error("codeSplitter: desktop checks", String((e as Error)?.message ?? e))).finally(() => draining.delete(key));
  draining.set(key, go);
  return go;
}

// ---- Cloudflare: a container per run ----

const LABEL = "codesplitter container";
type Namespace = NonNullable<Env["CI_RUNNER"]>;
const stub = (ns: Namespace, owner: string, repo: string) => ns.get(ns.idFromName(`${owner}/${repo}`));

/** The container's server (deploy-sandbox/server.mjs), each run in its own directory under /work. */
function containerMachine(c: ContainerApi, cwd: string, deadline: number, budgetMs: number): Machine {
  return {
    async exec(cmd, out) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`out of time: a check in a container gets ${Math.round(budgetMs / 60_000)} minutes`);
      return readExec(await portFetch(c, "/exec", JSON.stringify({ cmd, cwd, limit_ms: left })), out);
    },
    async write(files) {
      const res = await portFetch(c, "/files", JSON.stringify({ cwd, files }));
      if (!res.ok) throw new Error(`laying the branch's files over the clone: ${res.status} ${await res.text()}`);
    },
    async read(path) {
      let text = "";
      return (await this.exec(["cat", path], (s) => { text += s; })) === 0 ? text : undefined;
    },
    stop() { void c.destroy("the run lost its claim").catch(() => {}); },
  };
}

/** The slice of a container Durable Object's state CiRunner uses. */
export interface CiRunnerState {
  container?: ContainerApi;
  exports?: GateExports;
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; setAlarm(at: number): Promise<void> };
}

/** One per repo: POST /kick {owner, repo} says there's work, and each alarm runs one queued check in a fresh container. */
export class CiRunner {
  constructor(private ctx: CiRunnerState, private env: Env, private budgetMs = RUN_BUDGET_MS) {}

  async fetch(req: Request): Promise<Response> {
    const { owner, repo } = (await req.json()) as { owner: string; repo: string };
    await this.ctx.storage.put("repo", { owner, repo });
    await this.ctx.storage.setAlarm(Date.now());
    return json({ kicked: true });
  }

  async alarm() {
    const at = await this.ctx.storage.get<{ owner: string; repo: string }>("repo");
    if (!at) return;
    const { owner, repo } = at, c = this.ctx.container;
    const job = await claimRun(this.env, owner, repo, LABEL, [], Date.now(), null);
    if (!job) return;
    try {
      // Its first minute comes off the site's budget up front, so a spent budget starts no container.
      const over = (this.env.ADMINS && isAdmin(this.env, owner) ? null : await charge(this.env, "checks", `@${owner}`))
        ?? await charge(this.env, "containers", SITE);
      if (over) {
        const run = await get(this.env, job.id) as CheckRun;
        await updateRun(this.env, run, { status: "cancelled", append: `${over} Run it on the desktop app or a runner of your own (scripts/runner.ts), or press Run later.\n` }, "codesplitters");
        return;
      }
      const began = Date.now(), deadline = began + this.budgetMs;
      await runJob(this.env, owner, repo, job, LABEL, async () => {
        if (!c) throw new Error("this Durable Object has no container");
        // The clone and the package registries, nothing else (#681): no secrets go in, so there's nothing to send anywhere.
        await gate(c, this.ctx.exports, hostList([job.clone_url && hostOf(job.clone_url)], REGISTRIES));
        c.start({ env: { CI: "1" }, enableInternet: false });
        return containerMachine(c, `run-${job.id}`, deadline, this.budgetMs);
      });
      // The rest of its minutes, rounded up. It ran already, so going over only stops the next one.
      const rest = Math.ceil((Date.now() - began) / 60_000) - 1;
      if (rest > 0) await charge(this.env, "containers", SITE, rest).catch(() => null);
    } finally {
      await c?.destroy().catch(() => {});
      // The next one, if any, in an alarm of its own: each run gets its own 15 minutes.
      await this.ctx.storage.setAlarm(Date.now());
    }
  }
}

/** There's work queued on the repo: tell its built-in runner, if it has one. */
export async function kick(env: Env, owner: string, repo: string) {
  if (env.CI_RUNNER) await stub(env.CI_RUNNER, owner, repo).fetch(new Request("http://ci/kick", { method: "POST", body: JSON.stringify({ owner, repo }) }));
  else if (desktopRuns(env)) void drain(env, owner, repo);
}

/** The cron: wake the runner of every repo with runs of ours still queued, in case a kick went missing. */
export async function kickQueued(env: Env) {
  if (!env.CI_RUNNER && !desktopRuns(env)) return 0;
  const { results } = await env.DB.prepare("SELECT DISTINCT owner, repo FROM check_runs WHERE status = 'queued' AND runner IN ('desktop', 'container')").all();
  for (const r of results as { owner: string; repo: string }[]) await kick(env, r.owner, r.repo).catch(() => null);
  return results.length;
}

/** Wait for the desktop's runs on a repo to finish: for tests. */
export const drained = (owner: string, repo: string) => draining.get(`${owner}/${repo}`) ?? Promise.resolve();
