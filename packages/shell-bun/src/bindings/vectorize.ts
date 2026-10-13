// Cloudflare Vectorize off the edge: an index in one sqlite table, queried by brute force. A desktop
// index holds what one person's app wrote, thousands of vectors not millions, so a scan with
// cosine / euclidean / dot-product scoring is quick enough and exact. Metadata filters take the
// edge's operators ($eq $ne $in $nin $lt $lte $gt $gte, or a bare value for $eq).

import { Database } from "bun:sqlite";

export type VectorizeMetric = "cosine" | "euclidean" | "dot-product";
export type VectorizeMetadata = Record<string, unknown>;
export interface VectorizeVector { id: string; values: number[] | Float32Array | Float64Array; namespace?: string; metadata?: VectorizeMetadata }
export interface VectorizeMatch { id: string; score: number; values?: number[]; namespace?: string; metadata?: VectorizeMetadata }
export interface VectorizeQueryOptions {
  topK?: number; namespace?: string;
  returnValues?: boolean;
  /** true or "all"/"indexed" returns metadata; false or "none" doesn't. */
  returnMetadata?: boolean | "all" | "indexed" | "none";
  filter?: Record<string, unknown>;
}

interface Row { id: string; namespace: string | null; vec: Uint8Array; metadata: string | null }

export class LocalVectorize {
  private db: Database;

  constructor(path: string = ":memory:", readonly name = "index", readonly opts: { dimensions?: number; metric?: VectorizeMetric } = {}) {
    this.db = new Database(path, { create: true });
    this.db.exec(`CREATE TABLE IF NOT EXISTS vectors (idx TEXT NOT NULL, id TEXT NOT NULL, namespace TEXT, vec BLOB NOT NULL,
      metadata TEXT, PRIMARY KEY (idx, id))`);
  }

  async describe() {
    const n = (this.db.query(`SELECT COUNT(*) AS n FROM vectors WHERE idx = ?`).get(this.name) as { n: number }).n;
    return { vectorCount: n, dimensions: this.opts.dimensions ?? 0, config: { dimensions: this.opts.dimensions ?? 0, metric: this.metric } };
  }

  /** insert keeps a vector whose id is already there; upsert replaces it. */
  async insert(vectors: VectorizeVector[]) { return this.write(vectors, "INSERT OR IGNORE"); }
  async upsert(vectors: VectorizeVector[]) { return this.write(vectors, "INSERT OR REPLACE"); }

  private write(vectors: VectorizeVector[], verb: string) {
    const q = this.db.query(`${verb} INTO vectors (idx, id, namespace, vec, metadata) VALUES (?, ?, ?, ?, ?)`);
    this.db.transaction(() => {
      for (const v of vectors) {
        if (this.opts.dimensions && v.values.length !== this.opts.dimensions) throw new Error(`Vectorize ${this.name}: vector "${v.id}" has ${v.values.length} dimensions, the index takes ${this.opts.dimensions}`);
        q.run(this.name, v.id, v.namespace ?? null, new Uint8Array(Float32Array.from(v.values).buffer), v.metadata ? JSON.stringify(v.metadata) : null);
      }
    })();
    return { ids: vectors.map((v) => v.id), count: vectors.length, mutationId: crypto.randomUUID() };
  }

  async query(vector: number[] | Float32Array | Float64Array, o: VectorizeQueryOptions = {}): Promise<{ matches: VectorizeMatch[]; count: number }> {
    const rows = (o.namespace
      ? this.db.query(`SELECT * FROM vectors WHERE idx = ? AND namespace = ?`).all(this.name, o.namespace)
      : this.db.query(`SELECT * FROM vectors WHERE idx = ?`).all(this.name)) as Row[];
    const q = Float32Array.from(vector);
    const scored = rows
      .map((r) => ({ r, meta: r.metadata ? JSON.parse(r.metadata) as VectorizeMetadata : undefined }))
      .filter(({ meta }) => !o.filter || matches(meta ?? {}, o.filter))
      .map(({ r, meta }) => { const v = vecOf(r); return { r, meta, v, score: score(this.metric, q, v) }; })
      // euclidean is a distance: nearer is better. The others are similarities.
      .sort((a, b) => this.metric === "euclidean" ? a.score - b.score : b.score - a.score)
      .slice(0, o.topK ?? 5);
    const withMeta = o.returnMetadata === true || o.returnMetadata === "all" || o.returnMetadata === "indexed";
    const matches_ = scored.map(({ r, meta, v, score }): VectorizeMatch => ({
      id: r.id, score,
      ...(r.namespace ? { namespace: r.namespace } : {}),
      ...(o.returnValues ? { values: [...v] } : {}),
      ...(withMeta && meta ? { metadata: meta } : {}),
    }));
    return { matches: matches_, count: matches_.length };
  }

  async queryById(id: string, o: VectorizeQueryOptions = {}) {
    const [v] = await this.getByIds([id]);
    return v ? this.query(v.values, o) : { matches: [], count: 0 };
  }

  async getByIds(ids: string[]): Promise<{ id: string; values: number[]; namespace?: string; metadata?: VectorizeMetadata }[]> {
    const q = this.db.query(`SELECT * FROM vectors WHERE idx = ? AND id = ?`);
    return ids.flatMap((id) => {
      const r = q.get(this.name, id) as Row | null;
      return r ? [{ id: r.id, values: [...vecOf(r)], ...(r.namespace ? { namespace: r.namespace } : {}), ...(r.metadata ? { metadata: JSON.parse(r.metadata) } : {}) }] : [];
    });
  }

  async deleteByIds(ids: string[]) {
    const q = this.db.query(`DELETE FROM vectors WHERE idx = ? AND id = ?`);
    this.db.transaction(() => { for (const id of ids) q.run(this.name, id); })();
    return { ids, count: ids.length, mutationId: crypto.randomUUID() };
  }

  private get metric(): VectorizeMetric { return this.opts.metric ?? "cosine"; }
}

const vecOf = (r: Row) => new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength));

function score(metric: VectorizeMetric, a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0, d2 = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; d2 += (a[i]! - b[i]!) ** 2; }
  if (metric === "dot-product") return dot;
  if (metric === "euclidean") return Math.sqrt(d2);
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The edge's metadata filter: each key's condition must hold. */
function matches(meta: VectorizeMetadata, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    const v = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], meta);
    if (cond === null || typeof cond !== "object" || Array.isArray(cond)) return v === cond;
    return Object.entries(cond).every(([op, x]) => {
      switch (op) {
        case "$eq": return v === x;
        case "$ne": return v !== x;
        case "$in": return (x as unknown[]).includes(v);
        case "$nin": return !(x as unknown[]).includes(v);
        case "$lt": return (v as number) < (x as number);
        case "$lte": return (v as number) <= (x as number);
        case "$gt": return (v as number) > (x as number);
        case "$gte": return (v as number) >= (x as number);
        default: throw new Error(`Vectorize: unknown filter operator ${op}`);
      }
    });
  });
}

export const vectorize = (path?: string, name?: string, opts?: { dimensions?: number; metric?: VectorizeMetric }) => new LocalVectorize(path, name, opts);
