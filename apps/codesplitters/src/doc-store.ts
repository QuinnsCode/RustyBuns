// A file's doc in storage, in chunks (#624). One key per doc used to hold every line, and a
// Durable Object's value is capped at 2 MB, so a file of ~15–20k lines stopped saving and
// every edit rewrote the lot. Now:
//   <key>             the manifest: rev, nextId, the chunk numbers in order, the next number
//   <key>:<n>         a run of lines, in file order
// An edit rewrites the chunks its lines are in, and the manifest. A chunk is a run of
// neighbouring lines: an inserted line joins the chunk of the line before it, so runs stay
// runs, and a chunk that grows past CHUNK_LINES or CHUNK_CHARS splits. Plain get, put and
// prefix list, so it runs on Cloudflare and on the shell-bun twin alike.
//
// A doc stored the old way (one key, lines and all) loads as it is and is rewritten in chunks.

import type { Doc, Line } from "./lines.ts";

/** A chunk is filled to about this many lines, or this many characters of JSON, and splits at twice either. */
export const CHUNK_LINES = 500;
export const CHUNK_CHARS = 128 * 1024;

interface Manifest { rev: number; nextId: number; chunks: number[]; next: number }

const pad = (n: number) => String(n).padStart(10, "0");
const size = (l: Line) => JSON.stringify(l).length;

/** Lines in runs of about CHUNK_LINES and CHUNK_CHARS each, in order. */
function fill(lines: Line[]): Line[][] {
  const out: Line[][] = [];
  let run: Line[] = [], chars = 0;
  for (const l of lines) {
    const c = size(l);
    if (run.length && (run.length >= CHUNK_LINES || chars + c > CHUNK_CHARS)) { out.push(run); run = []; chars = 0; }
    run.push(l); chars += c;
  }
  if (run.length) out.push(run);
  return out;
}

const tooBig = (lines: Line[]) => lines.length > 2 * CHUNK_LINES || lines.reduce((s, l) => s + size(l), 0) > 2 * CHUNK_CHARS;

export class DocStore {
  /** Line id -> the chunk it is in. */
  chunkOf = new Map<string, number>();
  chunks: number[] = [];
  next = 0;

  constructor(private storage: any, readonly key: string) {}

  chunkKey(n: number) { return `${this.key}:${pad(n)}`; }

  /** The stored doc, or null if there is none. One stored the old way is rewritten in chunks. */
  async load(): Promise<Doc | null> {
    const m = (await this.storage.get(this.key)) as (Manifest | Doc | undefined);
    if (!m) return null;
    if ("lines" in m) { await Promise.all(this.replace(m)); return m; }
    const stored = (await this.storage.list({ prefix: this.key + ":" })) as Map<string, Line[]>;
    const lines: Line[] = [];
    for (const n of m.chunks) {
      const run = stored.get(this.chunkKey(n)) ?? [];
      for (const l of run) { this.chunkOf.set(l.id, n); lines.push(l); }
    }
    [this.chunks, this.next] = [m.chunks, m.next];
    return { rev: m.rev, nextId: m.nextId, lines };
  }

  /** Write the whole doc, in place of whatever was stored. Every write is issued before the first await, so they land together. */
  replace(doc: Doc): Promise<unknown>[] {
    const old = this.chunks;
    this.chunkOf.clear();
    this.chunks = [];
    const writes: Promise<unknown>[] = [];
    for (const run of fill(doc.lines)) {
      const n = this.next++;
      this.chunks.push(n);
      for (const l of run) this.chunkOf.set(l.id, n);
      writes.push(this.storage.put(this.chunkKey(n), run));
    }
    for (const n of old) writes.push(this.storage.delete(this.chunkKey(n)));
    writes.push(this.manifest(doc));
    return writes;
  }

  /**
   * Write what an edit changed: the chunks holding `touched` (ids of lines set, inserted or
   * deleted) and the manifest. `doc` is the doc after the edit.
   */
  save(doc: Doc, touched: Iterable<string>): Promise<unknown>[] {
    const dirty = new Set<number>(), gone = new Set<string>();
    for (const id of touched) { const n = this.chunkOf.get(id); if (n !== undefined) { dirty.add(n); gone.add(id); } }
    // One pass in file order: new lines join the chunk before them (or after them, at the top),
    // and each chunk's lines are gathered in case it's one to write.
    const runs = new Map<number, Line[]>(), order: number[] = [], lead: Line[] = [];
    let prev: number | undefined;
    for (const l of doc.lines) {
      gone.delete(l.id);
      let n = this.chunkOf.get(l.id);
      if (n === undefined) {
        if (prev === undefined) { lead.push(l); continue; }
        n = prev; this.chunkOf.set(l.id, n); dirty.add(n);
      }
      if (n !== prev) {
        // A chunk turning up twice means its lines aren't one run any more: write it all afresh.
        if (runs.has(n)) return this.replace(doc);
        runs.set(n, []); order.push(n);
      }
      if (lead.length) { for (const x of lead) this.chunkOf.set(x.id, n); runs.get(n)!.push(...lead); lead.length = 0; dirty.add(n); }
      runs.get(n)!.push(l);
      prev = n;
    }
    for (const id of gone) this.chunkOf.delete(id);

    const writes: Promise<unknown>[] = [];
    const chunks: number[] = [];
    // Lines with no chunk to join: the file was empty.
    if (lead.length) for (const run of fill(lead)) {
      const n = this.next++;
      chunks.push(n);
      for (const l of run) this.chunkOf.set(l.id, n);
      writes.push(this.storage.put(this.chunkKey(n), run));
    }
    for (const n of order) {
      const run = runs.get(n)!;
      if (!dirty.has(n)) { chunks.push(n); continue; }
      const parts = tooBig(run) ? fill(run) : [run];
      parts.forEach((part, i) => {
        const k = i ? this.next++ : n;
        if (i) for (const l of part) this.chunkOf.set(l.id, k);
        chunks.push(k);
        writes.push(this.storage.put(this.chunkKey(k), part));
      });
    }
    // Chunks whose lines all went.
    const kept = new Set(chunks);
    for (const n of this.chunks) if (!kept.has(n)) writes.push(this.storage.delete(this.chunkKey(n)));
    this.chunks = chunks;
    writes.push(this.manifest(doc));
    return writes;
  }

  /** Forget the layout, after the storage under it was wiped. */
  clear() { this.chunkOf.clear(); this.chunks = []; this.next = 0; }

  manifest(doc: Doc) {
    return this.storage.put(this.key, { rev: doc.rev, nextId: doc.nextId, chunks: this.chunks, next: this.next } satisfies Manifest);
  }
}
