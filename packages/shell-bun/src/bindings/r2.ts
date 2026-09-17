// R2Bucket-compatible binding over a directory. get/put/head/delete/list with
// the R2Object surface app code actually touches (body, arrayBuffer, text,
// json, size, etag, httpMetadata, customMetadata, writeHttpMetadata).
// Keys map to files; a sidecar .meta.json carries metadata when set.

import { mkdirSync, readdirSync, statSync, existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

export interface R2ObjectLike {
  key: string; size: number; etag: string; httpEtag: string; uploaded: Date;
  httpMetadata: Record<string, string>; customMetadata: Record<string, string>;
  body: ReadableStream; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; json<T = unknown>(): Promise<T>;
  writeHttpMetadata(h: Headers): void;
}

export class R2Bucket {
  /**
   * @param dir      where objects live. May be read-only (an embedded /$bunfs dir).
   * @param overlay  writable dir for puts/deletes when `dir` is read-only; reads
   *                 check the overlay first, then `dir`. Defaults to `dir`.
   */
  constructor(private dir: string, private overlay: string = dir) {
    if (!overlay.startsWith("/$bunfs")) mkdirSync(overlay, { recursive: true });
  }

  private within(root: string, key: string) {
    const p = join(root, key);
    if (!p.startsWith(root)) throw new Error("bad key");
    return p;
  }
  /** Resolve a key for reading: overlay wins, then base. Tombstones hide base keys. */
  private path(key: string) {
    const o = this.within(this.overlay, key);
    if (existsSync(o)) return o;
    if (existsSync(o + ".deleted")) return o;   // deleted from a read-only base
    return this.within(this.dir, key);
  }
  private wpath(key: string) { return this.within(this.overlay, key); }
  private meta(key: string): { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> } {
    try { return JSON.parse(readFileSync(this.path(key) + ".meta.json", "utf8")); } catch { return {}; }
  }
  private obj(key: string, withBody: boolean): R2ObjectLike | null {
    const p = this.path(key);
    if (!existsSync(p) || !statSync(p).isFile()) return null;
    const st = statSync(p); const f = Bun.file(p); const m = this.meta(key);
    const etag = Bun.hash(`${key}:${st.size}:${st.mtimeMs}`).toString(16);
    const http = m.httpMetadata ?? { contentType: f.type || "application/octet-stream" };
    return {
      key, size: st.size, etag, httpEtag: `"${etag}"`, uploaded: st.mtime,
      httpMetadata: http, customMetadata: m.customMetadata ?? {},
      get body() { return withBody ? f.stream() : (null as unknown as ReadableStream); },
      arrayBuffer: () => f.arrayBuffer(), text: () => f.text(), json: () => f.json(),
      writeHttpMetadata(h: Headers) {
        if (http.contentType) h.set("content-type", http.contentType);
        if (http.cacheControl) h.set("cache-control", http.cacheControl);
        if (http.contentEncoding) h.set("content-encoding", http.contentEncoding);
      },
    };
  }

  async get(key: string) { return this.obj(key, true); }
  async head(key: string) { return this.obj(key, false); }
  async put(key: string, value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob | null, opts?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }) {
    const p = this.wpath(key); mkdirSync(dirname(p), { recursive: true });
    rmSync(p + ".deleted", { force: true });
    await Bun.write(p, value instanceof ReadableStream ? new Response(value) : (value ?? ""));
    if (opts?.httpMetadata || opts?.customMetadata) await Bun.write(p + ".meta.json", JSON.stringify(opts));
    return this.obj(key, false)!;
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      const p = this.wpath(k);
      rmSync(p, { force: true }); rmSync(p + ".meta.json", { force: true });
      // A key that only exists in a read-only base gets a tombstone.
      if (existsSync(this.within(this.dir, k)) && this.dir !== this.overlay) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p + ".deleted", ""); }
    }
  }
  async list(opts?: { prefix?: string; limit?: number; cursor?: string; delimiter?: string }) {
    const set = new Set<string>(); const dead = new Set<string>();
    const walk = (d: string, rel: string) => { if (!existsSync(d)) return; for (const e of readdirSync(d)) { const p = join(d, e); const r = rel ? `${rel}/${e}` : e; if (statSync(p).isDirectory()) walk(p, r); else if (e.endsWith(".deleted")) dead.add(r.slice(0, -8)); else if (!e.endsWith(".meta.json")) set.add(r); } };
    walk(this.dir, ""); walk(this.overlay, "");
    const all = [...set].filter((k) => !dead.has(k));
    const prefix = opts?.prefix ?? ""; const limit = opts?.limit ?? 1000; const after = opts?.cursor ?? "";
    const keys = all.filter((k) => k.startsWith(prefix) && k > after).sort();
    const page = keys.slice(0, limit);
    const objects = page.map((k) => this.obj(k, false)!);
    return { objects, truncated: keys.length > limit, cursor: keys.length > limit ? page[page.length - 1] : undefined, delimitedPrefixes: [] as string[] };
  }
}

export const r2 = (dir: string, overlay?: string) => new R2Bucket(dir, overlay);
