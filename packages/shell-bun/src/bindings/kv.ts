// KVNamespace-compatible binding over a single sqlite table.
// get/put/delete/list with expirationTtl and metadata.

import { Database } from "bun:sqlite";

interface Row { key: string; value: string; metadata: string | null; expires_at: number | null }

export class KVNamespace {
  private db: Database;
  constructor(path: string = ":memory:", private table = "kv") {
    this.db = new Database(path, { create: true });
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, metadata TEXT, expires_at INTEGER)`);
  }

  private live(row: Row | null): Row | null {
    if (!row) return null;
    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      this.db.query(`DELETE FROM ${this.table} WHERE key = ?`).run(row.key);
      return null;
    }
    return row;
  }

  async get(key: string, type?: "text"): Promise<string | null>;
  async get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  async get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  async get(key: string, type: "text" | "json" | "arrayBuffer" = "text"): Promise<unknown> {
    const row = this.live(this.db.query(`SELECT * FROM ${this.table} WHERE key = ?`).get(key) as Row | null);
    if (!row) return null;
    if (type === "json") return JSON.parse(row.value);
    if (type === "arrayBuffer") return new TextEncoder().encode(row.value).buffer;
    return row.value;
  }

  async getWithMetadata<T = unknown, M = unknown>(key: string): Promise<{ value: T | null; metadata: M | null }> {
    const row = this.live(this.db.query(`SELECT * FROM ${this.table} WHERE key = ?`).get(key) as Row | null);
    return { value: (row?.value ?? null) as T | null, metadata: row?.metadata ? JSON.parse(row.metadata) : null };
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView, opts?: { expirationTtl?: number; expiration?: number; metadata?: unknown }): Promise<void> {
    const v = typeof value === "string" ? value : new TextDecoder().decode(value as ArrayBuffer);
    const expires = opts?.expiration ? opts.expiration * 1000 : opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    this.db.query(`INSERT OR REPLACE INTO ${this.table} (key, value, metadata, expires_at) VALUES (?, ?, ?, ?)`)
      .run(key, v, opts?.metadata === undefined ? null : JSON.stringify(opts.metadata), expires);
  }

  async delete(key: string): Promise<void> {
    this.db.query(`DELETE FROM ${this.table} WHERE key = ?`).run(key);
  }

  async list<M = unknown>(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string; expiration?: number; metadata?: M }[]; list_complete: boolean; cursor?: string }> {
    const limit = Math.min(opts?.limit ?? 1000, 1000);
    const after = opts?.cursor ?? "";
    const prefix = opts?.prefix ?? "";
    const rows = this.db.query(`SELECT * FROM ${this.table} WHERE key LIKE ? AND key > ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key LIMIT ?`)
      .all(prefix + "%", after, Date.now(), limit + 1) as Row[];
    const page = rows.slice(0, limit);
    return {
      keys: page.map((r) => ({ name: r.key, ...(r.expires_at ? { expiration: Math.floor(r.expires_at / 1000) } : {}), ...(r.metadata ? { metadata: JSON.parse(r.metadata) as M } : {}) })),
      list_complete: rows.length <= limit,
      ...(rows.length > limit ? { cursor: page[page.length - 1]!.key } : {}),
    };
  }
}

export const kv = (path?: string, table?: string) => new KVNamespace(path, table);
