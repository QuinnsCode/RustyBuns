// The test swarm's one Durable Object (#4758): every job in one SQLite table, so a lease, a retry and the green light for a
// SHA are each one statement in one place. A lease that runs out isn't swept by a timer: the next runner to check in
// finds it and the job goes back on the queue, which is the only moment it matters.
import { json, readJson } from "@rustybuns/util/http";
import { hex } from "@rustybuns/util/bytes";
import { CONTEXTS, Enqueue, Extend, LEASE_SECONDS, LeaseAsk, Report, STATES, Sha, type Job, type JobsReply, type LeaseReply, type QueueReply } from "./api.ts";
import { check } from "@rustybuns/util/guard";

type Cursor<T> = { toArray(): T[]; rowsWritten: number };
type Sql = { exec<T>(query: string, ...bindings: unknown[]): Cursor<T> };
export type QueueEnv = {
  /** A token that may post commit statuses on GITHUB_REPO. Unset, the queue runs and posts nothing. */
  GITHUB_STATUS_TOKEN?: string;
  /** owner/name the statuses land on. */
  GITHUB_REPO?: string;
  /** GitHub's API; a test points it at a stub. */
  GITHUB_API?: string;
};

type Row = { id: number; sha: string; branch: string; suite: string; state: (typeof STATES)[number]; runner: string; lease: string | null; until: number; tries: number; log: string };
type Context = (typeof CONTEXTS)[number];
/** Which status a suite counts toward: typecheck is its own, every app's tests are `apps`. */
const contextOf = (suite: string): Context => (suite === "typecheck" ? "typecheck" : "apps");
/** Finished jobs are kept this long, for `GET /jobs` and reruns, then dropped. */
const KEEP_MS = 7 * 24 * 3600_000;

export class Queue {
  private sql: Sql;

  constructor(ctx: { storage: { sql?: Sql } }, private env: QueueEnv) {
    if (!ctx.storage.sql) throw new Error("the Queue keeps its jobs in SQLite storage (new_sqlite_classes)");
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sha TEXT NOT NULL, branch TEXT NOT NULL, suite TEXT NOT NULL,
      state TEXT NOT NULL, runner TEXT NOT NULL DEFAULT '', lease TEXT, until INTEGER NOT NULL DEFAULT 0,
      tries INTEGER NOT NULL DEFAULT 0, log TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, UNIQUE (sha, suite));
    CREATE TABLE IF NOT EXISTS statuses (sha TEXT NOT NULL, context TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (sha, context));`);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const now = Date.now();
    if (req.method === "GET" && url.pathname === "/jobs") {
      const sha = check(Sha, url.searchParams.get("sha"));
      if (sha) await this.settle(sha);
      return sha ? json(this.jobs(sha) satisfies JobsReply) : json({ error: "sha: a full 40-character commit" }, 400);
    }
    if (req.method === "GET" && url.pathname === "/queue") return json(this.queue(now) satisfies QueueReply);
    if (req.method !== "POST") return json({ error: "not a swarm route" }, 404);
    if (url.pathname === "/enqueue") {
      const b = await readJson(req, Enqueue);
      return b ? json(this.enqueue(b, now)) : bad("{ sha, branch, suites: [...] }");
    }
    if (url.pathname === "/lease") {
      const b = await readJson(req, LeaseAsk);
      return b ? json(this.lease(b.runner, (b.seconds ?? LEASE_SECONDS) * 1000, now) satisfies LeaseReply) : bad("{ runner, seconds? }");
    }
    if (url.pathname === "/extend") {
      const b = await readJson(req, Extend);
      if (!b) return bad("{ lease, seconds? }");
      const n = this.sql.exec("UPDATE jobs SET until = ? WHERE lease = ? AND state = 'leased' AND until >= ?", now + (b.seconds ?? LEASE_SECONDS) * 1000, b.lease, now).rowsWritten;
      return json({ ok: n > 0 }, n ? 200 : 409);
    }
    if (url.pathname === "/report") {
      const b = await readJson(req, Report);
      if (!b) return bad("{ lease, ok, log }");
      const [job] = this.sql.exec<Row>("SELECT * FROM jobs WHERE lease = ? AND state = 'leased' AND until >= ?", b.lease, now).toArray();
      // Ran out (and maybe went to someone else), or never was: this runner's result doesn't count.
      if (!job) return json({ ok: false }, 409);
      this.sql.exec("UPDATE jobs SET state = ?, lease = NULL, log = ? WHERE id = ?", b.ok ? "passed" : "failed", b.log, job.id);
      await this.settle(job.sha);
      return json({ ok: true });
    }
    return json({ error: "not a swarm route" }, 404);
  }

  /** Queues each suite of a SHA, or queues it again: a rerun clears the statuses posted for that SHA. */
  private enqueue(b: Enqueue, now: number) {
    this.sql.exec("DELETE FROM jobs WHERE at < ? AND state IN ('passed', 'failed')", now - KEEP_MS);
    for (const suite of new Set(b.suites)) {
      this.sql.exec(`INSERT INTO jobs (sha, branch, suite, state, at) VALUES (?, ?, ?, 'queued', ?)
        ON CONFLICT (sha, suite) DO UPDATE SET state = 'queued', branch = excluded.branch, runner = '', lease = NULL, until = 0, log = '', at = excluded.at`, b.sha, b.branch, suite, now);
    }
    this.sql.exec("DELETE FROM statuses WHERE sha = ?", b.sha);
    return { queued: new Set(b.suites).size };
  }

  /** The oldest queued job, held for `ms`. Leases that ran out go back on the queue first. */
  private lease(runner: string, ms: number, now: number): LeaseReply {
    this.sql.exec("UPDATE jobs SET state = 'queued', lease = NULL, runner = '' WHERE state = 'leased' AND until < ?", now);
    const [row] = this.sql.exec<Row>("SELECT * FROM jobs WHERE state = 'queued' ORDER BY id LIMIT 1").toArray();
    if (!row) return { job: null };
    const lease = hex(crypto.getRandomValues(new Uint8Array(16)));
    const until = now + ms;
    this.sql.exec("UPDATE jobs SET state = 'leased', runner = ?, lease = ?, until = ?, tries = tries + 1 WHERE id = ?", runner, lease, until, row.id);
    const job: Job = { id: row.id, sha: row.sha, branch: row.branch, suite: row.suite, lease, until };
    return { job };
  }

  /** What is waiting and what is running, in lease order. Read-only: a lease that ran out is shown queued, not put back. */
  private queue(now: number): QueueReply {
    const rows = this.sql.exec<Row & { at: number }>("SELECT * FROM jobs WHERE state IN ('queued', 'leased') ORDER BY id LIMIT 1000").toArray();
    return {
      jobs: rows.map((r) => {
        const held = r.state === "leased" && r.until >= now;
        return { sha: r.sha, branch: r.branch, suite: r.suite, state: held ? "leased" : "queued", runner: held ? r.runner : "", at: r.at, until: held ? r.until : 0, tries: r.tries };
      }),
    };
  }

  private jobs(sha: string): JobsReply {
    const jobs = this.sql.exec<Row>("SELECT * FROM jobs WHERE sha = ? ORDER BY id", sha).toArray()
      .map((r) => ({ suite: r.suite, state: r.state, runner: r.runner, tries: r.tries, log: r.log }));
    const states = this.sql.exec<{ state: string }>("SELECT state FROM statuses WHERE sha = ?", sha).toArray().map((r) => r.state);
    const posted = states.includes("failure") ? "failure" : states.length === CONTEXTS.length ? "success" : undefined;
    return { jobs, ...(posted ? { posted } : {}) };
  }

  /**
   * Posts what a SHA has earned: a context fails on its first failed suite, and both go green once every suite is.
   * Each is posted once; one GitHub refused is tried again on the next report.
   */
  private async settle(sha: string) {
    const rows = this.sql.exec<Row>("SELECT * FROM jobs WHERE sha = ?", sha).toArray();
    const done = new Set(this.sql.exec<{ context: string }>("SELECT context FROM statuses WHERE sha = ?", sha).toArray().map((r) => r.context));
    const green = rows.every((r) => r.state === "passed");
    for (const context of CONTEXTS) {
      if (done.has(context)) continue;
      const failed = rows.find((r) => r.state === "failed" && contextOf(r.suite) === context);
      if (!failed && !green) continue;
      const state = failed ? "failure" : "success";
      const description = failed ? `${failed.suite} failed on ${failed.runner}` : `${rows.length} suite${rows.length === 1 ? "" : "s"} passed on the swarm`;
      if (await this.post(sha, context, state, description)) this.sql.exec("INSERT OR REPLACE INTO statuses (sha, context, state) VALUES (?, ?, ?)", sha, context, state);
    }
  }

  private async post(sha: string, context: Context, state: "success" | "failure", description: string): Promise<boolean> {
    const { GITHUB_STATUS_TOKEN: token, GITHUB_REPO: repo, GITHUB_API: api = "https://api.github.com" } = this.env;
    if (!token || !repo) return false;
    const res = await fetch(`${api}/repos/${repo}/statuses/${sha}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "rustybuns-test-swarm", "content-type": "application/json" },
      body: JSON.stringify({ state, context, description: description.slice(0, 140) }),
    }).catch(() => null);
    return !!res?.ok;
  }
}

const bad = (shape: string) => json({ error: `expected ${shape}` }, 400);
