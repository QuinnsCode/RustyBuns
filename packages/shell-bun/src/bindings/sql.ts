// `ctx.storage.sql` for local Durable Objects: Cloudflare's SqlStorage shape
// (exec -> cursor, databaseSize) over bun:sqlite. FTS5 and the rest of SQLite
// come along, as they do on Cloudflare.

import { Database } from "bun:sqlite";
import type { SqlStoragePort, SqlCursor } from "@rustybuns/ports";

/** SqlStorage over `db`, opened on first use (most DOs never touch sql). */
export function sqlStorage(open: () => Database): SqlStoragePort {
  let db: Database | null = null;
  const get = () => (db ??= open());
  return {
    exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlCursor<T> {
      const d = get();
      // Like Cloudflare, several statements run in one call when nothing is bound.
      const many = !bindings.length && /;\s*\S/.test(query.trim().replace(/;\s*$/, ""));
      let rows: T[] = [], rowsWritten = 0;
      if (many) d.run(query);
      else {
        const stmt = d.query(query);
        // A statement with columns gives rows (RETURNING counts each as written); one without, its changes.
        if (stmt.columnNames.length) { rows = stmt.all(...(bindings as any[])) as T[]; if (/\bRETURNING\b/i.test(query)) rowsWritten = rows.length; }
        else rowsWritten = stmt.run(...(bindings as any[])).changes;
      }
      let i = 0;
      return {
        rowsWritten,
        toArray: () => rows.slice(i),
        one() {
          if (rows.length !== 1) throw new Error(`Expected exactly one result from SQL query, but got ${rows.length === 0 ? "no results" : "more than one"}.`);
          return rows[0]!;
        },
        next: () => (i < rows.length ? { done: false as const, value: rows[i++]! } : { done: true as const, value: undefined }),
        [Symbol.iterator]() { return this; },
      };
    },
    get databaseSize() {
      const d = get();
      const { page_count } = d.query("PRAGMA page_count").get() as { page_count: number };
      const { page_size } = d.query("PRAGMA page_size").get() as { page_size: number };
      return page_count * page_size;
    },
  };
}
