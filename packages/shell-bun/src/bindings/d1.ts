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
    const results = this.stmt().all(...(this.params as any[])) as T[];
    return { results, success: true, meta: this.meta(t0, results.length, 0) };
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
  readonly db: Database;
  constructor(path: string = ":memory:") {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
  }
  prepare(sql: string): D1PreparedStatement {
    return new D1PreparedStatement(this.db, sql);
  }
  async batch<T = Record<string, unknown>>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const out: D1Result<T>[] = [];
    this.db.transaction(() => { /* wrapped below */ });
    const tx = this.db.transaction(async () => {
      for (const s of stmts) out.push(await s.all<T>());
    });
    await tx();
    return out;
  }
  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const t0 = performance.now();
    this.db.exec(sql);
    return { count: sql.split(";").filter((s) => s.trim()).length, duration: performance.now() - t0 };
  }
  close(): void { this.db.close(); }
}

export const d1 = (path?: string) => new D1Database(path);
