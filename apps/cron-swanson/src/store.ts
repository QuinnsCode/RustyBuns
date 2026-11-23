// Jobs and runs in one SQLite file (bun:sqlite). A job is kept whole as JSON beside the two columns the
// ticker asks about (next_at, enabled); a run is a row. Each job keeps its last KEEP_RUNS runs.
import { Database } from "bun:sqlite";
import { parseJson } from "@rustybuns/util/http";
import { Job, Run, type Stats } from "./api.ts";

const KEEP_RUNS = 200;
/** A reminder nobody ticked off within this long (or before its job fired again) counts as ignored. */
const IGNORE_AFTER_MS = 60 * 60_000;

interface RunRow { id: number; job_id: string; scheduled_at: number; fired_at: number; manual: number; status: string; code: number | null; ms: number | null; error: string; done_at: number | null; snooze_until: number | null }

const toRun = (r: RunRow): Run =>
  Run({ id: r.id, jobId: r.job_id, scheduledAt: r.scheduled_at, firedAt: r.fired_at, manual: r.manual === 1, status: r.status, code: r.code, ms: r.ms, error: r.error, doneAt: r.done_at, snoozedUntil: r.snooze_until });

export class Store {
  readonly db: Database;

  constructor(path = ":memory:") {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL, next_at INTEGER, enabled INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs (enabled, next_at);
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, scheduled_at INTEGER NOT NULL, fired_at INTEGER NOT NULL,
        manual INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, code INTEGER, ms INTEGER, error TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS runs_job ON runs (job_id, id);`);
    // Files made before reminders could be ticked off get the column; it's null on every old run.
    const cols = this.db.query<{ name: string }, []>("PRAGMA table_info(runs)").all();
    if (!cols.some((c) => c.name === "done_at")) this.db.exec("ALTER TABLE runs ADD COLUMN done_at INTEGER");
    if (!cols.some((c) => c.name === "snooze_until")) this.db.exec("ALTER TABLE runs ADD COLUMN snooze_until INTEGER");
  }

  private read(body: string): Job { return Job(parseJson(body)); }

  jobs(): Job[] {
    return this.db.query<{ body: string }, []>("SELECT body FROM jobs").all().map((r) => this.read(r.body));
  }

  job(id: string): Job | null {
    const row = this.db.query<{ body: string }, [string]>("SELECT body FROM jobs WHERE id = ?").get(id);
    return row ? this.read(row.body) : null;
  }

  put(job: Job): void {
    this.db.query("INSERT OR REPLACE INTO jobs (id, body, next_at, enabled) VALUES (?, ?, ?, ?)")
      .run(job.id, JSON.stringify(job), job.nextAt, job.enabled ? 1 : 0);
  }

  remove(id: string): boolean {
    this.db.query("DELETE FROM runs WHERE job_id = ?").run(id);
    return this.db.query("DELETE FROM jobs WHERE id = ?").run(id).changes > 0;
  }

  /** Enabled jobs whose next run is at or before `now`. */
  due(now: number): Job[] {
    return this.db.query<{ body: string }, [number]>("SELECT body FROM jobs WHERE enabled = 1 AND next_at IS NOT NULL AND next_at <= ?")
      .all(now).map((r) => this.read(r.body));
  }

  addRun(run: Omit<Run, "id" | "doneAt" | "snoozedUntil">): Run {
    const { lastInsertRowid } = this.db.query("INSERT INTO runs (job_id, scheduled_at, fired_at, manual, status, code, ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(run.jobId, run.scheduledAt, run.firedAt, run.manual ? 1 : 0, run.status, run.code, run.ms, run.error);
    this.db.query("DELETE FROM runs WHERE job_id = ?1 AND id NOT IN (SELECT id FROM runs WHERE job_id = ?1 ORDER BY id DESC LIMIT ?2)").run(run.jobId, KEEP_RUNS);
    return { ...run, id: Number(lastInsertRowid), doneAt: null, snoozedUntil: null };
  }

  /** Ticks a reminder off (once: a second tick keeps the first time). The run, or null when there's no such run. */
  done(id: number, at: number): Run | null {
    this.db.query("UPDATE runs SET done_at = ? WHERE id = ? AND done_at IS NULL").run(at, id);
    const row = this.db.query<RunRow, [number]>("SELECT * FROM runs WHERE id = ?").get(id);
    return row ? toRun(row) : null;
  }

  /** Puts a reminder off until `until`. The run, or null when there's no such run. */
  snooze(id: number, until: number): Run | null {
    this.db.query("UPDATE runs SET snooze_until = ? WHERE id = ?").run(until, id);
    const row = this.db.query<RunRow, [number]>("SELECT * FROM runs WHERE id = ?").get(id);
    return row ? toRun(row) : null;
  }

  /** Each job's counts over its kept runs (see Stats). A job with no runs isn't in the map. */
  stats(now: number): Map<string, Stats> {
    const rows = this.db.query<{ job_id: string; fired: number; done: number; ignored: number; last_done: number | null; last_fired: number | null }, [number, number]>(`
      SELECT job_id, COUNT(*) AS fired, COUNT(done_at) AS done, MAX(done_at) AS last_done, MAX(fired_at) AS last_fired,
        SUM(status = 'reminded' AND done_at IS NULL AND (snooze_until IS NULL OR snooze_until < ?2) AND (fired_at < ?1 OR id < (SELECT MAX(id) FROM runs l WHERE l.job_id = r.job_id))) AS ignored
      FROM runs r GROUP BY job_id`).all(now - IGNORE_AFTER_MS, now);
    return new Map(rows.map((r) => [r.job_id, { fired: r.fired, done: r.done, ignored: r.ignored, lastDoneAt: r.last_done, lastFiredAt: r.last_fired }]));
  }

  /** The latest runs, newest first: one job's, or everyone's. */
  runs(limit: number, jobId?: string): Run[] {
    const rows = jobId
      ? this.db.query<RunRow, [string, number]>("SELECT * FROM runs WHERE job_id = ? ORDER BY id DESC LIMIT ?").all(jobId, limit)
      : this.db.query<RunRow, [number]>("SELECT * FROM runs ORDER BY id DESC LIMIT ?").all(limit);
    return rows.map(toRun);
  }

  /** Each job's newest run. */
  lastRuns(): Map<string, Run> {
    const rows = this.db.query<RunRow, []>("SELECT * FROM runs WHERE id IN (SELECT MAX(id) FROM runs GROUP BY job_id)").all();
    return new Map(rows.map((r) => [r.job_id, toRun(r)]));
  }
}
