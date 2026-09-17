// StoragePort (DO storage shape) over sqlite. Alarm is a setTimeout; the
// shell never evicts, so the loop's own timer is the only clock that matters.

import { Database } from "bun:sqlite";
import { serialize, deserialize } from "bun:jsc";
import type { StoragePort } from "@rustybuns/ports";

export interface StorageOptions {
  /**
   * "json": readable, fine for strings/numbers/arrays (the default).
   * "v8": structured-clone semantics like DO storage. Use it if you persist
   * TypedArrays, Maps, Sets or Dates: JSON turns a Float32Array into a plain
   * object with no error and the world restores subtly wrong.
   */
  codec?: "json" | "v8";
  onAlarm?: () => void;
}

export function storage(path: string = ":memory:", opts: StorageOptions | (() => void) = {}): StoragePort {
  const o: StorageOptions = typeof opts === "function" ? { onAlarm: opts } : opts;
  const onAlarm = o.onAlarm;
  const v8 = o.codec === "v8";
  const enc = (v: unknown) => v8 ? Buffer.from(serialize(v)) : JSON.stringify(v);
  const dec = <T>(v: string | Uint8Array) => (v8 ? deserialize(v as Uint8Array) : JSON.parse(v as string)) as T;
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY, value ${v8 ? "BLOB" : "TEXT"} NOT NULL)`);
  let alarm: ReturnType<typeof setTimeout> | null = null;
  return {
    async get<T>(key: string) {
      const r = db.query("SELECT value FROM storage WHERE key = ?").get(key) as { value: string | Uint8Array } | null;
      return r ? dec<T>(r.value) : undefined;
    },
    async put(key, value) {
      db.query("INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?)").run(key, enc(value) as any);
    },
    async delete(key) {
      return db.query("DELETE FROM storage WHERE key = ?").run(key).changes > 0;
    },
    async list<T>(opts?: { prefix?: string; limit?: number }) {
      const rows = db.query("SELECT key, value FROM storage WHERE key LIKE ? ORDER BY key LIMIT ?")
        .all((opts?.prefix ?? "") + "%", opts?.limit ?? 10_000) as { key: string; value: string | Uint8Array }[];
      return new Map(rows.map((r) => [r.key, dec<T>(r.value)]));
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
