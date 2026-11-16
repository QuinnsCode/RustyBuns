// A Mac in the test swarm (#4758): `bun run builder join [--slots N]` (scripts/remote-ci.ts) runs this. Each slot is a warm
// clone of the repo; it leases a job, fetches that SHA from GitHub, runs the suite and reports. While the suite runs it
// extends its lease; when the swarm says the lease is gone (the job went to someone else), the suite is stopped.
// A Mac that sleeps simply stops extending, and its job goes back on the queue when the lease runs out.
// Bun only: this is the runner's side, not the Worker's.
import { existsSync, mkdirSync } from "node:fs";
import { join as path } from "node:path";
import { readJson } from "@rustybuns/util/http";
import type { Guard } from "@rustybuns/util/guard";
import { LEASE_SECONDS, LeaseReply, Ok, type Enqueue, type Job } from "./api.ts";

export type Swarm = { url: string; token: string };
/** What a suite runs: a folder in the slot and a shell command, or why it can't run at this SHA. */
export type Resolved = { dir: string; cmd: string } | { why: string };

export type JoinOptions = {
  swarm: Swarm;
  /** Who this Mac is, for the swarm's view: each slot leases as `<name>/<n>`. */
  name: string;
  /** How many jobs run at once. */
  slots: number;
  /** Where the slots live (slot-1, slot-2, ...). */
  home: string;
  /** A repo to clone a new slot from (this checkout: fast, shares objects). */
  source: string;
  /** Where a slot fetches a SHA from (GitHub). */
  remote: string;
  /** The suite's command, read from the slot once it is on the job's SHA. */
  resolve(slot: string, suite: string): Promise<Resolved>;
  /** The lease each job is held on, extended a third of the way through. */
  seconds?: number;
  /** How long a slot waits after an empty queue (or the swarm not answering). */
  pollMs?: number;
  /** Abort to stop: running suites are killed, their leases run out and the jobs go back. */
  signal?: AbortSignal;
  log?: (line: string) => void;
};

/** One POST to the swarm with our token; null when it didn't answer. */
export const post = (swarm: Swarm, route: string, body: unknown) => fetch(new URL(route, swarm.url), {
  method: "POST",
  headers: { authorization: `Bearer ${swarm.token}`, "content-type": "application/json" },
  body: JSON.stringify(body),
}).catch(() => null);

/** One call read through `guard`; null on a refusal (409: the lease ran out) or a network error. */
export async function call<T>(swarm: Swarm, route: string, body: unknown, guard: Guard<T>): Promise<T | null> {
  const res = await post(swarm, route, body);
  return res ? readJson(res, guard) : null;
}

/** An agent queues a pushed SHA's suites. */
export const enqueue = (swarm: Swarm, job: Enqueue) => post(swarm, "/enqueue", job);

const git = (cwd: string, ...args: string[]) => Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
async function sh(p: ReturnType<typeof git>): Promise<{ code: number; out: string }> {
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}

/** A slot on the job's SHA, clean, with its packages: cloned the first time, fetched and checked out after. */
export async function checkout(o: Pick<JoinOptions, "source" | "remote">, slot: string, sha: string): Promise<{ code: number; out: string }> {
  if (!existsSync(path(slot, ".git"))) {
    mkdirSync(slot, { recursive: true });
    const c = await sh(git(slot, "clone", "-q", "--no-checkout", o.source, "."));
    if (c.code) return c;
    await sh(git(slot, "remote", "set-url", "origin", o.remote));
  }
  for (const args of [["fetch", "-q", "origin", sha], ["checkout", "-q", "-f", "--detach", sha], ["clean", "-fdq"]]) {
    const r = await sh(git(slot, ...args));
    if (r.code) return r;
  }
  if (!existsSync(path(slot, "bun.lock"))) return { code: 0, out: "" };
  return sh(Bun.spawn(["bun", "install", "--frozen-lockfile", "--silent"], { cwd: slot, stdout: "pipe", stderr: "pipe" }));
}

/** The last `n` characters, which is all the swarm keeps of a log. */
const tail = (s: string, n = 4000) => (s.length > n ? s.slice(-n) : s);

/** One job, start to report. Returns how it went, or "lost" when the lease went first. */
export async function work(o: JoinOptions, slot: string, job: Job): Promise<"passed" | "failed" | "lost"> {
  const seconds = o.seconds ?? LEASE_SECONDS, log = o.log ?? console.log;
  let lost = false, child: ReturnType<typeof Bun.spawn> | undefined;
  // Keep the lease while we work. A 409 means it is someone else's job now; a network blip isn't a no, so it carries on.
  const beat = setInterval(async () => {
    if ((await post(o.swarm, "/extend", { lease: job.lease, seconds }))?.status === 409) { lost = true; child?.kill(); }
  }, Math.max(200, (seconds * 1000) / 3));
  const stop = () => child?.kill();
  o.signal?.addEventListener("abort", stop);
  try {
    let out = "", ok = false;
    const co = await checkout(o, slot, job.sha);
    if (co.code) out = `checkout of ${job.sha} failed:\n${co.out}`;
    else {
      const r = await o.resolve(slot, job.suite);
      if ("why" in r) out = r.why;
      else {
        log(`[${job.suite}] ${job.sha.slice(0, 8)} ${job.branch}: ${r.cmd}`);
        child = Bun.spawn(["sh", "-c", `${r.cmd} 2>&1`], { cwd: path(slot, r.dir), stdout: "pipe", stderr: "inherit" });
        const dec = new TextDecoder();
        for await (const chunk of child.stdout as ReadableStream<Uint8Array>) out = tail(out + dec.decode(chunk, { stream: true }), 16_000);
        ok = (await child.exited) === 0;
      }
    }
    if (lost || o.signal?.aborted) return "lost";
    const said = await call(o.swarm, "/report", { lease: job.lease, ok, log: tail(out) }, Ok);
    log(`[${job.suite}] ${ok ? "passed" : "failed"}${said ? "" : " (the swarm didn't take the report: the lease ran out)"}`);
    return said ? (ok ? "passed" : "failed") : "lost";
  } finally {
    clearInterval(beat);
    o.signal?.removeEventListener("abort", stop);
  }
}

/** An empty queue doubles a slot's wait up to this many polls: 15 s grows to 2 min. */
export const IDLE_BACKOFF = 8;

/** Every slot leases, works and reports until `signal` aborts. Resolves once each slot has stopped. */
export async function join(o: JoinOptions): Promise<void> {
  const log = o.log ?? console.log, poll = o.pollMs ?? 15_000;
  const nap = (ms: number) => new Promise<void>((done) => {
    const t = setTimeout(done, ms);
    o.signal?.addEventListener("abort", () => { clearTimeout(t); done(); }, { once: true });
  });
  log(`joined ${o.swarm.url} as ${o.name} with ${o.slots} slot${o.slots === 1 ? "" : "s"} (${o.home})`);
  await Promise.all(Array.from({ length: o.slots }, async (_, i) => {
    const runner = `${o.name}/${i + 1}`, slot = path(o.home, `slot-${i + 1}`);
    // An idle Mac asks less and less often (up to IDLE_BACKOFF times the poll), so one left joined for good costs next to
    // nothing on the Worker's bill; the first job found puts it back to the quick poll.
    for (let wait = poll; !o.signal?.aborted; ) {
      const got = await call(o.swarm, "/lease", { runner, seconds: o.seconds ?? LEASE_SECONDS }, LeaseReply);
      if (!got?.job) { await nap(wait); wait = Math.min(wait * 2, poll * IDLE_BACKOFF); continue; }
      wait = poll;
      await work(o, slot, got.job);
    }
  }));
}
