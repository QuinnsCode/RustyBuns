// Workers Analytics Engine off the edge: writeDataPoint() lands in a sqlite table instead of
// nowhere, so what the app records is there to look at (`sqlite3 analytics.sqlite`). Same limits
// as the edge: up to 20 blobs, 20 doubles and one index per point.

import { Database } from "bun:sqlite";

export interface AnalyticsEngineDataPoint { indexes?: (string | ArrayBuffer | null)[]; blobs?: (string | ArrayBuffer | null)[]; doubles?: number[] }

const text = (v: string | ArrayBuffer | null | undefined) => v == null ? null : typeof v === "string" ? v : new TextDecoder().decode(v);

export class LocalAnalyticsEngine {
  private db: Database;

  constructor(path: string = ":memory:", readonly dataset = "dataset") {
    this.db = new Database(path, { create: true });
    this.db.exec(`CREATE TABLE IF NOT EXISTS data_points (dataset TEXT NOT NULL, timestamp INTEGER NOT NULL, idx TEXT,
      blobs TEXT NOT NULL, doubles TEXT NOT NULL)`);
  }

  writeDataPoint(p: AnalyticsEngineDataPoint = {}): void {
    if ((p.indexes?.length ?? 0) > 1) throw new Error("Analytics Engine: a data point takes at most one index");
    if ((p.blobs?.length ?? 0) > 20 || (p.doubles?.length ?? 0) > 20) throw new Error("Analytics Engine: a data point takes at most 20 blobs and 20 doubles");
    this.db.query(`INSERT INTO data_points (dataset, timestamp, idx, blobs, doubles) VALUES (?, ?, ?, ?, ?)`)
      .run(this.dataset, Date.now(), text(p.indexes?.[0]), JSON.stringify((p.blobs ?? []).map(text)), JSON.stringify(p.doubles ?? []));
  }

  /** The points written so far, oldest first. */
  points(): { timestamp: Date; index: string | null; blobs: (string | null)[]; doubles: number[] }[] {
    return (this.db.query(`SELECT * FROM data_points WHERE dataset = ? ORDER BY rowid`).all(this.dataset) as { timestamp: number; idx: string | null; blobs: string; doubles: string }[])
      .map((r) => ({ timestamp: new Date(r.timestamp), index: r.idx, blobs: JSON.parse(r.blobs), doubles: JSON.parse(r.doubles) }));
  }
}

export const analyticsEngine = (path?: string, dataset?: string) => new LocalAnalyticsEngine(path, dataset);
