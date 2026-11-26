// The Blender queue with Bob faked: his builder folder is a temp dir, his ssh is a local sh, and his "Blender" runs
// the job's script with sh. Covers the order and the lock (two adds at once, two drainers), a failed job, a job past
// its time limit, and a job re-queued after Bob went away. Run it on the builder: `bun run builder run . bun test scripts/blender-queue.test.ts`.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add, type Bob, drain, Event, fold, wait } from "./blender-queue.ts";

setDefaultTimeout(30_000);
const tmp = mkdtempSync(join(tmpdir(), "blender-queue-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const git = (cwd: string, ...a: string[]) => Bun.spawnSync(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();

// The office's worktree: a repo with the job script (sh, as the fake Blender runs it).
const root = join(tmp, "office");
mkdirSync(root);
git(root, "init", "-q");
writeFileSync(join(root, "job.py"), `echo "start $1" >> "$TRACE"; sleep "\${2:-0.3}"; mkdir -p out; echo "made by $1" > "out/$1.txt"; echo "end $1" >> "$TRACE"; [ "$1" != bad ] || exit 3\n`);
git(root, "add", "-A");
git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "job");
const sha = git(root, "rev-parse", "HEAD");

// Bob's builder folder, with the job checkout the drainer would have cloned from slot-1.
const bobDir = join(tmp, "bob");
mkdirSync(join(bobDir, "blender"), { recursive: true });
git(join(bobDir, "blender"), "clone", "-q", root, "repo");
const bob: Bob = {
  spawn: (script) => Bun.spawn(["sh", "-c", script], { cwd: bobDir, stdout: "pipe", stderr: "pipe" }),
  push: async (s, ref, cwd) => Bun.spawnSync(["git", "push", "-q", join(bobDir, "blender/repo"), `+${s}:${ref}`], { cwd }).exitCode,
};
const blender = join(tmp, "fake-blender");
writeFileSync(blender, `#!/bin/sh\nwhile [ "$1" != "-P" ]; do shift; done; s=$2; shift 3; exec sh "$s" "$@"\n`);
chmodSync(blender, 0o755);
const trace = join(tmp, "trace");
process.env.TRACE = trace;
const quiet = { log: () => {}, every: 50 };
const job = (name: string, ...more: string[]) => ({ dir: ".", py: true, cmd: ["job.py", name, ...more], out: ["out"], who: name });
const traced = () => readFileSync(trace, "utf8").trim().split("\n");
const jobs = () => fold(existsSync(join(bobDir, "blender/queue.jsonl")) ? readFileSync(join(bobDir, "blender/queue.jsonl"), "utf8") : "");

/** Run the drainer until `until` says so, then stop it the way serve's Ctrl-C does. */
async function draining<T>(until: () => Promise<T>, o: { minuteMs?: number } = {}): Promise<T> {
  const stop = new AbortController();
  const d = drain(bobDir, stop.signal, { every: 20, blender, log: () => {}, ...o });
  try { return await until(); } finally { stop.abort(); await d; }
}

test("two adds at once both get in, and run one after the other in the order they were queued", async () => {
  writeFileSync(trace, "");
  const [a, b] = await Promise.all([add(bob, root, sha, job("a"), quiet), add(bob, root, sha, job("b"), quiet)]);
  expect(a.id).not.toBe(b.id);
  expect([a.place, b.place].sort()).toEqual(["1st in line", "2nd in line"]);
  const order = jobs().map((j) => j.cmd[1]);
  rmSync(join(root, "out"), { recursive: true, force: true });
  const codes = await draining(() => Promise.all([wait(bob, root, a.id, quiet), wait(bob, root, b.id, quiet)]));
  expect(codes).toEqual([0, 0]);
  const [x, y] = order;
  expect(traced()).toEqual([`start ${x}`, `end ${x}`, `start ${y}`, `end ${y}`]);
  // what each wrote under --out came back to the office's tree
  expect(readFileSync(join(root, "out/a.txt"), "utf8")).toBe("made by a\n");
  expect(readFileSync(join(root, "out/b.txt"), "utf8")).toBe("made by b\n");
});

test("only one drainer takes jobs", async () => {
  const stop = new AbortController(), said: string[] = [];
  const first = drain(bobDir, stop.signal, { every: 20, blender, log: () => {} });
  await Bun.sleep(100);
  await drain(bobDir, stop.signal, { every: 20, blender, log: (l) => said.push(l) });
  expect(said.join("\n")).toContain("another drainer");
  stop.abort();
  await first;
});

test("a failed job is marked failed and the next one still runs; one past its time limit is stopped", async () => {
  writeFileSync(trace, "");
  const bad = await add(bob, root, sha, job("bad"), quiet);
  const slow = await add(bob, root, sha, { ...job("slow", "5"), minutes: 1 }, quiet);
  const ok = await add(bob, root, sha, job("ok"), quiet);
  const codes = await draining(() => Promise.all([bad, slow, ok].map((j) => wait(bob, root, j.id, quiet))), { minuteMs: 500 });
  expect(codes).toEqual([1, 1, 0]);
  const by = new Map(jobs().map((j) => [j.id, j]));
  expect(by.get(bad.id)).toMatchObject({ state: "failed", code: 3 });
  expect(by.get(slow.id)).toMatchObject({ state: "failed", code: 124 });
  expect(by.get(slow.id)?.note).toContain("limit");
  expect(by.get(ok.id)?.state).toBe("done");
  expect(traced()).not.toContain("end slow");
});

test("a job cut short when Bob goes away goes back in line and runs again from the start", async () => {
  writeFileSync(trace, "");
  const j = await add(bob, root, sha, job("long", "1"), quiet);
  // Bob stops serving mid-job
  await draining(async () => { while (!existsSync(trace) || !readFileSync(trace, "utf8").includes("start long")) await Bun.sleep(20); });
  expect(jobs().find((x) => x.id === j.id)).toMatchObject({ state: "waiting", tries: 1 });
  // a drainer that died outright leaves it "running": the next one puts it back in line first
  writeFileSync(join(bobDir, "blender/queue.jsonl"), readFileSync(join(bobDir, "blender/queue.jsonl"), "utf8")
    + JSON.stringify({ id: j.id, at: Date.now(), state: "running" } satisfies Event) + "\n");
  expect(await draining(() => wait(bob, root, j.id, quiet))).toBe(0);
  expect(jobs().find((x) => x.id === j.id)).toMatchObject({ state: "done", tries: 3 });
  expect(traced().filter((l) => l === "start long")).toHaveLength(2);
});
