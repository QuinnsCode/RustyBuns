// StoragePort (DO storage shape) over sqlite. Alarm is a setTimeout; the
// shell never evicts, so the loop's own timer is the only clock that matters.

import { Database } from "bun:sqlite";
import type { StoragePort } from "@rustybuns/ports";

export function storage(path: string = ":memory:", onAlarm?: () => void): StoragePort {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  let alarm: ReturnType<typeof setTimeout> | null = null;
  return {
    async get<T>(key: string) {
      const r = db.query("SELECT value FROM storage WHERE key = ?").get(key) as { value: string } | null;
      return r ? (JSON.parse(r.value) as T) : undefined;
    },
    async put(key, value) {
      db.query("INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
    },
    async delete(key) {
      return db.query("DELETE FROM storage WHERE key = ?").run(key).changes > 0;
    },
    async list<T>(opts?: { prefix?: string; limit?: number }) {
      const rows = db.query("SELECT key, value FROM storage WHERE key LIKE ? ORDER BY key LIMIT ?")
        .all((opts?.prefix ?? "") + "%", opts?.limit ?? 10_000) as { key: string; value: string }[];
      return new Map(rows.map((r) => [r.key, JSON.parse(r.value) as T]));
    },
    async setAlarm(at) {
      if (alarm) clearTimeout(alarm);
      alarm = setTimeout(() => { alarm = null; onAlarm?.(); }, Math.max(0, at - Date.now()));
    },
    async deleteAlarm() {
      if (alarm) clearTimeout(alarm);
      alarm = null;
    },
  };
}
