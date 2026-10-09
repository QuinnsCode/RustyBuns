// D1-compatible binding over bun:sqlite. Same surface a Worker sees:
// prepare().bind().all()/first()/run()/raw(), batch(), exec().
// Only the shape RWSDK / drizzle-d1 / raw handlers actually call.

import { Database, type Statement } from "bun:sqlite";

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: { changes: number; last_row_id: number; duration: number; rows_read: number; rows_written: number };
}

export class D1PreparedStatement {
  constructor(private db: Database, private sql: string, private params: unknown[] = []) {}

  bind(...params: unknown[]): D1PreparedStatement {
    return new D1PreparedStatement(this.db, this.sql, params);
  }

  private stmt(): Statement {
    return this.db.query(this.sql);
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const t0 = performance.now();
    // D1 reports writes made through all() too (INSERT ... RETURNING, or a
    // query builder that runs everything via all()); count them the same way.
    const total = () => (this.db.query("SELECT total_changes() AS c").get() as { c: number }).c;
    const before = total();
    const results = this.stmt().all(...(this.params as any[])) as T[];
    const changes = total() - before;
    const last = changes ? Number((this.db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id) : 0;
    return { results, success: true, meta: { ...this.meta(t0, results.length, changes), last_row_id: last } };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.stmt().get(...(this.params as any[])) as Record<string, unknown> | null;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const t0 = performance.now();
    const r = this.stmt().run(...(this.params as any[]));
    return {
      results: [], success: true,
      meta: { ...this.meta(t0, 0, r.changes), last_row_id: Number(r.lastInsertRowid) },
    };
  }

  async raw<T = unknown[]>(opts?: { columnNames?: boolean }): Promise<T[]> {
    const s = this.stmt();
    const rows = s.values(...(this.params as any[])) as T[];
    if (opts?.columnNames) return [s.columnNames as unknown as T, ...rows];
    return rows;
  }

  private meta(t0: number, read: number, written: number) {
    return { changes: written, last_row_id: 0, duration: performance.now() - t0, rows_read: read, rows_written: written };
  }
}

export class D1Database {
  /**
   * The sqlite underneath. Not called `db`: real D1 has no such property, and
   * libraries (Better Auth's Kysely adapter) read a `db` field as "already a
   * Kysely config" and mistake this for one.
   */
  readonly sqlite: Database;
  constructor(path: string = ":memory:") {
    this.sqlite = new Database(path, { create: true });
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
  }
  prepare(sql: string): D1PreparedStatement {
    return new D1PreparedStatement(this.sqlite, sql);
  }
  async batch<T = Record<string, unknown>>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const out: D1Result<T>[] = [];
    this.sqlite.transaction(() => { /* wrapped below */ });
    const tx = this.sqlite.transaction(async () => {
      for (const s of stmts) out.push(await s.all<T>());
    });
    await tx();
    return out;
  }
  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const t0 = performance.now();
    this.sqlite.exec(sql);
    return { count: sql.split(";").filter((s) => s.trim()).length, duration: performance.now() - t0 };
  }
  close(): void { this.sqlite.close(); }
}

/**
 * Apply a wrangler-style migrations dir (0001_*.sql, 0002_*.sql ...) to this
 * sqlite file, tracking what ran in d1_migrations exactly as D1 does. D1 is
 * sqlite, so the same files work unchanged. Idempotent; call at every boot.
 */
export async function applyD1Migrations(db: D1Database, dir: string): Promise<string[]> {
  const { readdirSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  if (!existsSync(dir)) return [];
  db.sqlite.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const done = new Set((db.sqlite.query("SELECT name FROM d1_migrations").all() as { name: string }[]).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await Bun.file(join(dir, f)).text();
    db.sqlite.transaction(() => {
      db.sqlite.exec(sql);
      db.sqlite.query("INSERT INTO d1_migrations (name) VALUES (?)").run(f);
    })();
    applied.push(f);
  }
  return applied;
}

export const d1 = (path?: string) => new D1Database(path);
