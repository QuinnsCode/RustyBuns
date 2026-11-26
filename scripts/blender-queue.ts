// The Blender queue (#6007): every Blender job goes to the builder Mac (Bob) and runs there one at a time, first in
// first out. Blender never runs on the office Mac (the owner banned it on 2026-11-23: it crashes the Mac).
//
//   bun run blender add [--out <dir>]... [--minutes N] <script.py> [args...] [--out <dir>]
//                                 queue a headless Blender run of the script on your working tree as it is (committed
//                                 or not); prints its id and place in line. --out (relative to here, more than one is
//                                 fine, default this folder) is where it writes: what it makes there comes back on `wait`
//   bun run blender add [--out <dir>]... -- <cmd...>
//                                 queue a whole command that calls Blender (`bun scripts/beasts.ts squonk`), run in this
//                                 folder of the tree on Bob; what a script's `await queued()` sends
//   bun run blender               the queue: waiting, running, done and failed jobs, with who and when
//   bun run blender wait <id>     wait for a job, print its log, and bring what it wrote under --out back here;
//                                 exits 0 when it passed
//
// On Bob, `bun run builder serve` drains the queue (`drain`): one job at a time, in the order they were added. The queue
// is one file, blender/queue.jsonl in his builder folder, written only under one lock (the folder blender/lock), so two
// agents adding at the same moment both get in, in order. The run lock (blender/run.lock) lets one drainer run jobs.
// A job runs in its own checkout (blender/repo, cloned from slot-1, with its own node_modules) at the commit `add`
// pushed. One past its time limit (--minutes, default 60) is killed and marked failed, and the next one starts. One
// cut short by Bob going away (serve stopped, Bob off or asleep) goes back in line and runs again from the start.
// While Bob is off, `add` and `wait` wait for him.
//
// A build script calls `await queued()` first thing (like `offload()` in remote-ci.ts): on the office Mac (BUILDER_HOST
// set) it sends itself through the queue and exits with the job's code; on Bob, in a job, it returns and the script runs.
// `runBlender` refuses to start Blender on the office Mac, and .claude/hooks/guard.ts turns away a direct `blender`.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { arr, bool, check, num, obj, oneOf, opt, str, type Of } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

const STATES = ["waiting", "running", "done", "failed"] as const;
export type State = (typeof STATES)[number];
const ID = /^[a-z0-9]+-[a-z0-9]+$/;
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** What `add` asks for: the command (a .py for Blender, or a whole command), where in the tree it runs and writes, and its commit. */
export const Add = obj({
  who: str(200), dir: str(500), py: bool(), cmd: arr(str(20_000), 1000, { min: 1 }), out: arr(str(500), 50, { min: 1 }),
  minutes: num(1, 24 * 60), sha: str(40, { re: /^[0-9a-f]{40}$/ }),
});
export type Add = Of<typeof Add>;
/** One line of the queue file: a job added, or a job's state changing. */
export const Event = obj({
  id: str(40, { re: ID }), at: num(0, 1e14), add: opt(Add), state: opt(oneOf(STATES)), code: opt(num(-1e6, 1e6)), note: opt(str(2000)),
});
export type Event = Of<typeof Event>;
export type Job = Add & { id: string; added: number; state: State; started?: number; ended?: number; code?: number; note?: string; tries: number };

/** The queue file's lines folded into its jobs, in the order they were added. A line that doesn't read is skipped. */
export function fold(text: string): Job[] {
  const jobs = new Map<string, Job>();
  for (const line of text.split("\n")) {
    const e = line.trim() ? check(Event, safeParse(line)) : null;
    if (!e) continue;
    if (e.add) { if (!jobs.has(e.id)) jobs.set(e.id, { ...e.add, id: e.id, added: e.at, state: "waiting", tries: 0 }); continue; }
    const j = jobs.get(e.id);
    if (!j || !e.state) continue;
    j.state = e.state;
    j.note = e.note;
    if (e.state === "running") { j.started = e.at; j.ended = undefined; j.code = undefined; j.tries++; }
    if (e.state === "done" || e.state === "failed") { j.ended = e.at; j.code = e.code; }
  }
  return [...jobs.values()];
}
function safeParse(line: string): unknown {
  try { return JSON.parse(line); } catch { return null; }
}

/** Where a job stands: "running", "2nd in line", "done". */
export function place(jobs: Job[], id: string): string {
  const j = jobs.find((x) => x.id === id);
  if (!j) return "not in the queue";
  if (j.state !== "waiting") return j.state;
  const n = jobs.filter((x) => x.state === "waiting").findIndex((x) => x.id === id) + 1;
  const ahead = jobs.some((x) => x.state === "running") ? ", after the one running" : "";
  const th = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${th} in line${ahead}`;
}

// ---------------------------------------------------------------- Bob's side: the lock, the file, the drainer

const QDIR = "blender", FILE = `${QDIR}/queue.jsonl`, LOCK = `${QDIR}/lock`, RUN_LOCK = `${QDIR}/run.lock`, REPO = `${QDIR}/repo`;
/** Edits under the lock take milliseconds: one held this long was left by a process that died holding it. */
const STALE_LOCK_MS = 10_000;
/** How many finished jobs the file keeps when it is compacted. */
const KEEP = 30;

/** The lock every write to the queue file takes, as `add` takes it over ssh (sh, so no Bun needed for it). */
export const SH_LOCK = `mkdir -p ${QDIR}/log ${QDIR}/out; n=0; until mkdir ${LOCK} 2>/dev/null; do n=$((n+1)); [ $n -gt ${STALE_LOCK_MS / 100} ] && { rmdir ${LOCK} 2>/dev/null; n=0; }; sleep 0.1; done; trap 'rmdir ${LOCK} 2>/dev/null' EXIT; `;

async function withLock<T>(dir: string, fn: () => T): Promise<T> {
  mkdirSync(`${dir}/${QDIR}/log`, { recursive: true });
  for (;;) {
    try { mkdirSync(`${dir}/${LOCK}`); break; } catch {
      const age = Date.now() - (statSync(`${dir}/${LOCK}`, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > STALE_LOCK_MS) rmSync(`${dir}/${LOCK}`, { recursive: true, force: true });
      else await Bun.sleep(100);
    }
  }
  try { return fn(); } finally { rmSync(`${dir}/${LOCK}`, { recursive: true, force: true }); }
}
const read = (dir: string) => existsSync(`${dir}/${FILE}`) ? readFileSync(`${dir}/${FILE}`, "utf8") : "";
const append = (dir: string, e: Event) => withLock(dir, () => appendFileSync(`${dir}/${FILE}`, JSON.stringify(e) + "\n"));

/** Rewrite the file with every unfinished job and the last KEEP finished ones; their logs and outputs go with them. */
function compact(dir: string) {
  return withLock(dir, () => {
    const text = read(dir), jobs = fold(text);
    const done = jobs.filter((j) => j.state === "done" || j.state === "failed");
    const drop = new Set(done.slice(0, Math.max(0, done.length - KEEP)).map((j) => j.id));
    if (!drop.size) return;
    const kept = text.split("\n").filter((l) => { const e = l.trim() ? check(Event, safeParse(l)) : null; return e && !drop.has(e.id); });
    writeFileSync(`${dir}/${FILE}.new`, kept.map((l) => l + "\n").join(""));
    renameSync(`${dir}/${FILE}.new`, `${dir}/${FILE}`);
    for (const id of drop) for (const f of [`log/${id}.log`, `log/${id}.stamp`, `out/${id}.tgz`]) rmSync(`${dir}/${QDIR}/${f}`, { force: true });
  });
}

function pidAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e) { return e instanceof Error && "code" in e && e.code === "EPERM"; }
}

/** Take the run lock: only one drainer runs jobs. One left by a drainer that is gone is taken back. */
function runLock(dir: string): (() => void) | null {
  const lock = `${dir}/${RUN_LOCK}`;
  mkdirSync(`${dir}/${QDIR}`, { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      mkdirSync(lock);
      writeFileSync(`${lock}/pid`, String(process.pid));
      return () => rmSync(lock, { recursive: true, force: true });
    } catch {
      const pid = Number((() => { try { return readFileSync(`${lock}/pid`, "utf8"); } catch { return "0"; } })());
      if (pid && pidAlive(pid)) return null;
      rmSync(lock, { recursive: true, force: true });
    }
  }
  return null;
}

export type DrainOpts = {
  /** How often an idle drainer looks for a job (ms). */
  every?: number;
  /** The Blender a .py job runs (default: findBlender on Bob). */
  blender?: string;
  log?: (line: string) => void;
  /** How long a job's minute is (ms): a test's time limit in milliseconds. */
  minuteMs?: number;
};

/**
 * On Bob, inside `bun run builder serve`: run the queue's jobs one at a time until `signal`. A job left "running" by a
 * drainer that went away goes back in line first; a job cut short when `signal` fires goes back in line too.
 * `dir` is his builder folder (its slot-1 is where the job checkout is cloned from the first time).
 */
export async function drain(dir: string, signal: AbortSignal, o: DrainOpts = {}): Promise<void> {
  const log = o.log ?? ((l: string) => console.log(`[blender] ${l}`));
  const unlock = runLock(dir);
  if (!unlock) { log("another drainer holds the Blender queue; this one stays out"); return; }
  try {
    if (!existsSync(`${dir}/${REPO}/.git`)) {
      if (!existsSync(`${dir}/slot-1/.git`)) { log(`no ${REPO} and no slot-1 to clone it from: the Blender queue is off`); return; }
      log(`making ${REPO} (a clone of slot-1) for Blender jobs`);
      const c = Bun.spawnSync(["git", "clone", "-q", "slot-1", REPO], { cwd: dir, stdout: "ignore", stderr: "inherit" });
      if (c.exitCode) { rmSync(`${dir}/${REPO}`, { recursive: true, force: true }); log("the clone failed: the Blender queue is off"); return; }
    }
    for (const j of fold(read(dir)).filter((x) => x.state === "running"))
      await append(dir, { id: j.id, at: Date.now(), state: "waiting", note: "Bob went away mid-job; back in line" });
    while (!signal.aborted) {
      const job = fold(read(dir)).find((j) => j.state === "waiting");
      if (!job) { await sleep(o.every ?? 3000, signal); continue; }
      log(`${job.id} (${job.who}): ${job.cmd.join(" ")}`);
      await runJob(dir, job, signal, o);
      await compact(dir);
    }
  } finally { unlock(); }
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((ok) => {
  const t = setTimeout(ok, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true });
});

async function runJob(dir: string, job: Job, signal: AbortSignal, o: DrainOpts) {
  const at = () => Date.now(), id = job.id, repo = `${dir}/${REPO}`;
  const logFile = `${dir}/${QDIR}/log/${id}.log`, stamp = `${dir}/${QDIR}/log/${id}.stamp`, tgz = `${dir}/${QDIR}/out/${id}.tgz`;
  mkdirSync(`${dir}/${QDIR}/out`, { recursive: true });
  await append(dir, { id, at: at(), state: "running" });
  writeFileSync(logFile, "");
  const prep = Bun.spawnSync(["sh", "-c", `{ git checkout -q -f --detach ${job.sha} && git clean -fdq `
    + `&& { [ ! -f bun.lock ] || bun install --frozen-lockfile --silent; }; } >> ${q(logFile)} 2>&1`], { cwd: repo });
  if (prep.exitCode) return append(dir, { id, at: at(), state: "failed", code: prep.exitCode, note: "its commit didn't check out on Bob (see the log)" });
  writeFileSync(stamp, "");
  await Bun.sleep(20);
  let cmd = job.cmd;
  if (job.py) {
    const exe = o.blender ?? (await import("../packages/cli/src/blender.ts")).findBlender();
    if (!exe) return append(dir, { id, at: at(), state: "failed", code: 127, note: "no Blender on Bob" });
    cmd = [exe, "-b", "--factory-startup", "--python-exit-code", "1", "-P", job.cmd[0]!, "--", ...job.cmd.slice(1)];
  }
  // its own process group, so a kill takes the Blender a script started with it; its output appended to the log
  const p = Bun.spawn(["perl", "-e", `setpgrp(0,0); open(STDOUT,">>",shift) or die "$!"; open(STDERR,">&STDOUT"); exec @ARGV or die "$!"`, logFile, ...cmd], {
    cwd: resolve(repo, job.dir), env: { ...process.env, BLENDER_JOB: id }, stdout: "ignore", stderr: "ignore",
  });
  let why: "time" | "lost" | null = null;
  const kill = (w: "time" | "lost") => { why ??= w; try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); } };
  const timer = setTimeout(() => kill("time"), job.minutes * (o.minuteMs ?? 60_000));
  const onAbort = () => kill("lost");
  signal.addEventListener("abort", onAbort, { once: true });
  const code = await p.exited;
  clearTimeout(timer);
  signal.removeEventListener("abort", onAbort);
  if (why === "lost") return append(dir, { id, at: at(), state: "waiting", note: "Bob stopped serving mid-job; back in line" });
  // what the job made or changed under its --out folders, for `wait` to bring back
  const outs = job.out.map((x) => q(x)).join(" ");
  Bun.spawnSync(["sh", "-c", `find ${outs} -name node_modules -prune -o -type f -newer ${q(stamp)} -print 2>/dev/null | tar -czf ${q(tgz)} -T -`], { cwd: repo });
  Bun.spawnSync(["git", "update-ref", "-d", `refs/blender/${id}`], { cwd: repo, stderr: "ignore" });
  if (why === "time") return append(dir, { id, at: at(), state: "failed", code: 124, note: `ran past its ${job.minutes}-minute limit and was stopped` });
  return append(dir, { id, at: at(), state: code ? "failed" : "done", code });
}

// ---------------------------------------------------------------- the office's side: add, wait, list over ssh

/** Bob as `add` and `wait` reach him: a shell in his builder folder, and a push into the job checkout. */
export type Bob = {
  spawn(script: string): { stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array>; exited: Promise<number> };
  push(sha: string, ref: string, cwd: string): Promise<number>;
};

async function sh(bob: Bob, script: string) {
  const p = bob.spawn(script);
  const [out] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out };
}

/** The real Bob: BUILDER_HOST over ssh (scripts/remote-ci.ts). */
export async function realBob(host: string): Promise<Bob> {
  const { builder, pushTo, remote } = await import("./remote-ci.ts");
  const b = builder(host);
  return { spawn: (s) => remote(b, s), push: (sha, ref, cwd) => pushTo(b, REPO, sha, ref, cwd) };
}

export type AddOpts = { dir: string; py: boolean; cmd: string[]; out: string[]; minutes?: number; who?: string };
export type Talk = { log?: (line: string) => void; every?: number };

/** Queue a job on the tree at `sha`: waits while Bob is away, then answers its id and place in line. */
export async function add(bob: Bob, root: string, sha: string, a: AddOpts, t: Talk = {}): Promise<{ id: string; place: string }> {
  const log = t.log ?? console.log, every = t.every ?? 30_000;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job: Add = { who: a.who ?? process.env.BUILDER_WHO ?? basename(root), dir: a.dir, py: a.py, cmd: a.cmd, out: a.out, minutes: a.minutes ?? 60, sha };
  for (let said = false; ; said = true) {
    if ((await sh(bob, `[ -d ${REPO}/.git ]`)).code === 0 && (await bob.push(sha, `refs/blender/${id}`, root)) === 0) break;
    if (!said) log("Bob isn't taking Blender jobs (off, asleep, or not serving: `bun run builder serve` on him); waiting");
    await Bun.sleep(every);
  }
  const line = JSON.stringify({ id, at: Date.now(), add: job } satisfies Event);
  for (let said = false; ; said = true) {
    const r = await sh(bob, `${SH_LOCK}printf '%s\\n' ${q(line)} >> ${FILE} && cat ${FILE}`);
    if (r.code === 0) return { id, place: place(fold(r.out), id) };
    if (!said) log("lost Bob while queueing; waiting");
    await Bun.sleep(every);
  }
}

/** Wait for a job to finish, print its log, and bring what it wrote back into `root`. Answers 0 when it passed. */
export async function wait(bob: Bob, root: string, id: string, t: Talk = {}): Promise<number> {
  const log = t.log ?? console.log, every = t.every ?? 5000;
  let last = "", away = false;
  for (;;) {
    const r = await sh(bob, `cat ${FILE} 2>/dev/null; true`);
    if (r.code !== 0) { if (!away) log("can't reach Bob; waiting"); away = true; await Bun.sleep(every); continue; }
    away = false;
    const jobs = fold(r.out), j = jobs.find((x) => x.id === id);
    if (!j) { log(`no job ${id} in the queue`); return 2; }
    const now = `${place(jobs, id)}${j.note ? ` (${j.note})` : ""}`;
    if (now !== last) log(`${id}: ${now}`);
    last = now;
    if (j.state === "done" || j.state === "failed") {
      const tail = await sh(bob, `tail -n 200 ${QDIR}/log/${id}.log 2>/dev/null; true`);
      if (tail.out.trim()) log(tail.out.trimEnd());
      const got = await bring(bob, root, id);
      log(`${id} ${j.state}${j.code ? ` (exit ${j.code})` : ""}${j.note ? `: ${j.note}` : ""}; ${got} file(s) back under ${j.out.join(", ")}`);
      return j.state === "done" ? 0 : 1;
    }
    await Bun.sleep(every);
  }
}

/** Unpack a job's outputs into `root`: answers how many files came back. */
async function bring(bob: Bob, root: string, id: string): Promise<number> {
  const p = bob.spawn(`cat ${QDIR}/out/${id}.tgz 2>/dev/null || true`);
  const tar = Bun.spawn(["tar", "-xzvf", "-", "-C", root], { stdin: p.stdout, stdout: "pipe", stderr: "pipe" });
  const [, listed] = await Promise.all([p.exited, new Response(tar.stderr).text(), new Response(tar.stdout).text()]);
  await tar.exited;
  return listed.split("\n").filter((l) => l.trim() && !l.endsWith("/")).length;
}

export async function list(bob: Bob, t: Talk = {}): Promise<number> {
  const log = t.log ?? console.log;
  const r = await sh(bob, `cat ${FILE} 2>/dev/null; true`);
  if (r.code !== 0) { log("can't reach Bob"); return 1; }
  const jobs = fold(r.out);
  if (!jobs.length) { log("the Blender queue is empty"); return 0; }
  const time = (ms?: number) => ms ? new Date(ms).toTimeString().slice(0, 5) : "--:--";
  const mins = (a?: number, b?: number) => a ? `${Math.max(0, Math.round(((b ?? Date.now()) - a) / 60_000))} min` : "";
  for (const j of jobs)
    log([j.id, j.state.padEnd(7), j.who.slice(0, 16).padEnd(16), `added ${time(j.added)}`, j.started ? `ran ${time(j.started)}, ${mins(j.started, j.ended)}` : "",
      j.code ? `exit ${j.code}` : "", j.cmd.join(" ").slice(0, 70), j.note ?? ""].filter(Boolean).join("  "));
  return 0;
}

// ---------------------------------------------------------------- a build script's first line

const top = async () => (await Bun.$`git rev-parse --show-toplevel`.cwd(process.cwd()).quiet().text()).trim();

/**
 * First thing in a script that runs Blender: on the office Mac (BUILDER_HOST set) it queues this same command for Bob,
 * waits, brings back what it wrote under `out` (folders relative to here; default here), and exits with its code.
 * In a queue job on Bob, or on a Mac with no builder, it returns and the script runs.
 */
export async function queued(out: string[] = ["."]): Promise<void> {
  const host = process.env.BUILDER_HOST;
  if (process.env.BLENDER_JOB || !host || process.argv.some((a) => a === "--help" || a === "-h")) return;
  const root = await top(), cwd = process.cwd();
  const { snapshot } = await import("./remote-ci.ts");
  const bob = await realBob(host);
  const { id, place: at } = await add(bob, root, await snapshot(root), {
    dir: relative(root, cwd) || ".", py: false, cmd: ["bun", relative(cwd, process.argv[1]!), ...process.argv.slice(2)],
    out: out.map((o) => relative(root, resolve(cwd, o)) || "."),
  });
  console.log(`Blender runs on the builder Mac, never here: queued as ${id} (${at}); \`bun run blender wait ${id}\` if this stops`);
  process.exit(await wait(bob, root, id));
}

/** `add`'s arguments: the queue's own flags before the script (and a trailing `--out <dir>`), then the script or `-- <cmd...>`. */
export function parseAdd(argv: string[]): { py: boolean; cmd: string[]; out: string[]; minutes?: number } | string {
  const out: string[] = [];
  let minutes: number | undefined, i = 0;
  for (; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) out.push(argv[++i]!);
    else if (argv[i] === "--minutes" && argv[i + 1]) minutes = Number(argv[++i]);
    else break;
  }
  let rest = argv.slice(i);
  const py = rest[0] !== "--";
  if (!py) rest = rest.slice(1);
  if (py && rest.length >= 3 && rest.at(-2) === "--out") { out.push(rest.at(-1)!); rest = rest.slice(0, -2); }
  if (!rest.length) return "nothing to run";
  if (py && !rest[0]!.endsWith(".py")) return `${rest[0]} isn't a .py: a whole command goes after \`--\``;
  if (minutes !== undefined && !(minutes >= 1 && minutes <= 1440)) return "--minutes is 1 to 1440";
  return { py, cmd: rest, out: out.length ? out : ["."], minutes };
}

async function main(argv: string[]): Promise<number> {
  const host = process.env.BUILDER_HOST;
  if (!host) { console.error("BUILDER_HOST is not set: the Blender queue lives on the builder Mac (scripts/builder-setup.sh)"); return 2; }
  const bob = await realBob(host);
  if (!argv.length || argv[0] === "list") return list(bob);
  const root = await top(), cwd = process.cwd();
  if (argv[0] === "wait" && argv[1] && ID.test(argv[1])) return wait(bob, root, argv[1]);
  if (argv[0] === "add") {
    const a = parseAdd(argv.slice(1));
    if (typeof a === "string") { console.error(`${a}\nusage: bun run blender add [--out <dir>]... [--minutes N] <script.py> [args...]  |  bun run blender add [--out <dir>] -- <cmd...>`); return 2; }
    const { snapshot } = await import("./remote-ci.ts");
    const { id, place: at } = await add(bob, root, await snapshot(root), { ...a, dir: relative(root, cwd) || ".", out: a.out.map((o) => relative(root, resolve(cwd, o)) || ".") });
    console.log(`queued ${id}: ${at}. \`bun run blender wait ${id}\` brings its output back`);
    return 0;
  }
  console.error("usage: bun run blender [list]  |  bun run blender add ...  |  bun run blender wait <id>   (--help for more)");
  return 2;
}

help(import.meta.path);
if (import.meta.main) process.exit(await main(process.argv.slice(2)));
