// A Mac joins the swarm with two slots (#4758, step 2): it clones a slot, fetches the queued SHA, runs each suite, keeps a
// long one's lease alive past its first lease, reports a failure with its log, and leaves when told.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as path } from "node:path";
import { durableObject } from "@rustybuns/shell-bun";
import { readJson } from "@rustybuns/util/http";
import worker, { Queue, type Env } from "../src/worker.ts";
import { JobsReply } from "../src/api.ts";
import { enqueue, join, type Swarm } from "../src/runner.ts";

setDefaultTimeout(30_000);
const TOKEN = "swarm-test-token";
const env: Env = { SWARM_TOKEN: TOKEN, QUEUE: durableObject(Queue, {}) };
const server = Bun.serve({ port: 0, fetch: (req) => worker.fetch(req, env) });
const swarm: Swarm = { url: server.url.origin, token: TOKEN };

// "GitHub": a repo with one commit on a branch, and the folder this Mac keeps its slots in.
const tmp = mkdtempSync(path(tmpdir(), "swarm-"));
const origin = path(tmp, "origin"), home = path(tmp, "slots");
const git = (...args: string[]) => Bun.$`git -c user.name=t -c user.email=t@t ${args}`.cwd(origin).quiet().text();
await Bun.$`mkdir -p ${origin} && git init -q -b office/x ${origin}`.quiet();
writeFileSync(path(origin, "a.txt"), "hello\n");
await git("add", ".");
await git("commit", "-qm", "one");
const sha = (await git("rev-parse", "HEAD")).trim();
afterAll(() => { server.stop(true); rmSync(tmp, { recursive: true, force: true }); });

const COMMANDS: Record<string, string> = {
  typecheck: "test -f a.txt",
  slow: "sleep 2.5 && cat a.txt",          // outlives its 1 s lease: only the slot's extends keep it
  broken: "echo 'expected 1, got 2' && exit 3",
};

test("a Mac with two slots takes a SHA's suites, keeps a long one's lease, and reports a failure with its log", async () => {
  expect((await enqueue(swarm, { sha, branch: "office/x", suites: ["typecheck", "slow", "broken"] }))?.status).toBe(200);
  const stop = new AbortController(), lines: string[] = [];
  const joined = join({
    swarm, name: "mac", slots: 2, home, source: origin, remote: origin, seconds: 1, pollMs: 100, signal: stop.signal,
    log: (l) => lines.push(l),
    resolve: async (_slot, suite) => (COMMANDS[suite] ? { dir: ".", cmd: COMMANDS[suite] } : { why: `no suite ${suite}` }),
  });

  let jobs: JobsReply | null = null;
  for (const t0 = Date.now(); Date.now() - t0 < 20_000; await Bun.sleep(200)) {
    jobs = await readJson(await worker.fetch(new Request(`${swarm.url}/jobs?sha=${sha}`, { headers: { authorization: `Bearer ${TOKEN}` } }), env), JobsReply);
    if (jobs?.jobs.every((j) => j.state === "passed" || j.state === "failed")) break;
  }
  stop.abort();
  await joined;

  const by = Object.fromEntries(jobs!.jobs.map((j) => [j.suite, j]));
  expect([by.typecheck!.state, by.slow!.state, by.broken!.state]).toEqual(["passed", "passed", "failed"]);
  expect(by.slow!.tries).toBe(1);                 // never went back on the queue
  expect(by.slow!.log).toBe("hello\n");
  expect(by.broken!.log).toContain("expected 1, got 2");
  expect(new Set(jobs!.jobs.map((j) => j.runner))).toEqual(new Set(["mac/1", "mac/2"]));
  expect(lines[0]).toContain("with 2 slots");
});
