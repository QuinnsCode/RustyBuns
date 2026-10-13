// Hyperdrive's offline twin: PGlite (Postgres compiled to WASM) in the data dir,
// served over the Postgres wire protocol on 127.0.0.1. `pg`, `postgres` and
// Drizzle get a postgres:// URL and connect to it unchanged, with no network.
// Its own entry point (@rustybuns/shell-bun/pglite) so only apps that ask for
// it need @electric-sql/pglite and @electric-sql/pglite-socket installed.
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { LocalHyperdrive } from "./hyperdrive.ts";

export interface PgliteFiles {
  /** pglite.wasm, initdb.wasm and pglite.data. A compiled binary embeds them and passes their
   *  $bunfs paths; without them PGlite finds its own next to its module, as in dev. */
  wasm?: string; initdb?: string; data?: string;
}

export interface PgliteHyperdrive extends LocalHyperdrive {
  readonly db: PGlite;
  close(): Promise<void>;
}

/**
 * Start PGlite in `dir` and serve it on a free 127.0.0.1 port. PGlite runs one
 * query at a time; the socket server takes many connections and queues their
 * queries, so a pg.Pool needs no cap. It is one Postgres session, so SessionQueue makes it
 * pass for many: named prepared statements, the default in postgres.js and Bun.SQL, work
 * from a pool unchanged, the same client code as against Hyperdrive; so do SQL PREPARE and
 * COPY FROM STDIN.
 * `migrations` apply at boot, tracked in rb_migrations.
 */
export async function pgliteHyperdrive(dir: string, name = "HYPERDRIVE", opts: PgliteFiles & { migrations?: string } = {}): Promise<PgliteHyperdrive> {
  mkdirSync(dir, { recursive: true });
  const [pgliteWasmModule, initdbWasmModule] = await Promise.all([opts.wasm, opts.initdb].map((p) => p ? Bun.file(p).arrayBuffer().then((b) => WebAssembly.compile(b)) : undefined));
  const db = await PGlite.create({
    dataDir: dir,
    ...(pgliteWasmModule ? { pgliteWasmModule } : {}),
    ...(initdbWasmModule ? { initdbWasmModule } : {}),
    ...(opts.data ? { fsBundle: Bun.file(opts.data) } : {}),
  });
  if (opts.migrations) for (const f of await applyPgMigrations(db, opts.migrations)) console.log(`[${name}] migrate ${f}`);
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 100 });
  // handlers read server.queryQueue when they connect, so ours stands in from the first one
  (server as unknown as { queryQueue: SessionQueue }).queryQueue = new SessionQueue(db);
  await server.start();
  const port = Number(server.getServerConn().split(":").pop());
  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  console.log(`[${name}] no Postgres URL set: PGlite in ${dir} on 127.0.0.1:${port}`);
  return {
    connectionString, host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres", db,
    async close() { await server.stop(); await db.close(); },
  };
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const SYNC = new Uint8Array([0x53, 0, 0, 0, 4]);
function frame(type: string, body: Uint8Array): Uint8Array {
  const m = new Uint8Array(5 + body.length);
  m[0] = type.charCodeAt(0);
  new DataView(m.buffer).setInt32(1, 4 + body.length);
  m.set(body, 5);
  return m;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * Stands in for pglite-socket's query queue (same three methods its handlers call) so many
 * connections share PGlite's one session without seeing each other:
 * - a connection keeps its turn from its first extended-protocol message to its Sync, and
 *   through a transaction, so another's Parse can't replace its unnamed statement mid-query;
 * - named prepared statements get a per-connection prefix, at the protocol level (Parse, Bind,
 *   Describe, Close) and in SQL (PREPARE, EXECUTE, DEALLOCATE), so two pooled connections can
 *   both prepare "s1" (42P05 otherwise, #1145); DEALLOCATE ALL drops only the connection's own;
 * - DISCARD ALL, a pooler's reset on release, does the same and leaves the shared session's temp
 *   tables, settings and locks alone; DISCARD TEMP is refused, as there's no telling whose they are (#1167);
 * - COPY ... FROM STDIN (a simple query) is answered here and its data held until CopyDone,
 *   then run in one go: PGlite reads a message's input to the end, so copy-in can't stream (#1150);
 * - a connection that leaves gets its batch synced, its transaction rolled back and its
 *   statements dropped, on its turn.
 */
export class SessionQueue {
  private queue: { handlerId: number; run: () => Promise<number>; resolve(n: number): void; reject(e: unknown): void }[] = [];
  private busy = false;
  private owner: number | null = null;          // whose turn it is, while a batch or transaction is open
  private open = new Set<number>();             // connections between an extended message and its Sync
  private named = new Set<number>();            // connections that have prepared a named statement
  private copying = new Map<number, Uint8Array[]>();   // a COPY FROM STDIN query and the data so far
  constructor(private db: PGlite) {}

  enqueue(handlerId: number, message: Uint8Array, onData: (data: Uint8Array) => void): Promise<number> {
    const held = this.copying.get(handlerId);
    if (held) {
      held.push(message);
      if (message[0] !== 0x63 && message[0] !== 0x66) return Promise.resolve(0);   // until CopyDone or CopyFail
      this.copying.delete(handlerId);
      return this.push(handlerId, () => this.copyIn(concat(held), onData));
    }
    const { msg, copyIn } = this.rewrite(handlerId, this.rename(handlerId, message));
    if (copyIn) {
      this.copying.set(handlerId, [msg]);
      onData(copyIn);
      return Promise.resolve(copyIn.length);
    }
    const type = String.fromCharCode(msg[0]!);   // extended messages open a batch, Sync and the rest end it; Flush leaves it be
    return this.push(handlerId, async () => {
      let n = 0;
      try {
        await this.db.runExclusive(() => this.db.execProtocolRawStream(msg, { onRawData: (d) => { n += d.length; onData(d); } }));
      } finally { if ("PBDEC".includes(type)) this.open.add(handlerId); else if (type !== "H") this.open.delete(handlerId); }
      return n;
    });
  }

  getQueueLength() { return this.queue.length; }

  clearQueueForHandler(handlerId: number) {
    this.queue = this.queue.filter((q) => q.handlerId !== handlerId || (q.reject(new Error("Handler disconnected")), false));
    this.copying.delete(handlerId);
    const named = this.named.delete(handlerId);
    if (this.owner !== handlerId && !this.open.has(handlerId) && !named) return;
    this.push(handlerId, async () => {
      await this.db.runExclusive(async () => {
        if (this.open.delete(handlerId)) await this.db.execProtocolRaw(SYNC);
        if (this.db.isInTransaction()) await this.db.execProtocolRaw(frame("Q", enc.encode("ROLLBACK\0")));
        if (named) await this.db.execProtocolRaw(frame("Q", enc.encode(`${deallocateAll(handlerId)}\0`)));
      });
      return 0;
    }).catch(() => {});   // the db may be closing under it
  }

  /** clearQueueForHandler already queued the rollback, on the leaving connection's turn. */
  async clearTransactionIfNeeded(_handlerId: number) {}

  private push(handlerId: number, run: () => Promise<number>): Promise<number> {
    return new Promise((resolve, reject) => { this.queue.push({ handlerId, run, resolve, reject }); void this.drain(); });
  }

  private async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const i = this.owner === null ? 0 : this.queue.findIndex((q) => q.handlerId === this.owner);
        if (i < 0 || !this.queue.length) break;   // the owner's next message will wake us
        const [q] = this.queue.splice(i, 1);
        try { q!.resolve(await q!.run()); } catch (e) { q!.reject(e); }
        this.owner = this.open.has(q!.handlerId) || this.isInTransaction() ? q!.handlerId : null;
      }
    } finally { this.busy = false; }
  }

  private isInTransaction() { try { return this.db.isInTransaction(); } catch { return false; } }

  /** The held COPY query, its CopyData and CopyDone/CopyFail as one input; the client already has its CopyInResponse. */
  private async copyIn(all: Uint8Array, onData: (data: Uint8Array) => void): Promise<number> {
    const out: Uint8Array[] = [];
    await this.db.runExclusive(() => this.db.execProtocolRawStream(all, { onRawData: (d) => out.push(d.slice()) }));
    let res = concat(out);
    if (res[0] === 0x47) res = res.subarray(1 + new DataView(res.buffer, res.byteOffset).getInt32(1));
    if (res.length) onData(res);
    return res.length;
  }

  /** Prefix a Parse/Bind/Describe/Close statement name with the connection's. */
  private rename(handlerId: number, m: Uint8Array): Uint8Array {
    const type = String.fromCharCode(m[0]!);
    if (m.length < 6 || !"PBCD".includes(type) || !m[0]) return m;
    let at = 5;
    if (type === "B") at = m.indexOf(0, 5) + 1;              // past the portal name
    else if (type === "C" || type === "D") { if (m[5] !== 0x53) return m; at = 6; }   // 'S'tatement, not 'P'ortal
    const end = m.indexOf(0, at);
    if (at <= 0 || end <= at) return m;                      // unnamed: the turn keeps it ours
    const prefix = enc.encode(`rb${handlerId}_`);
    if (type === "P") this.named.add(handlerId);
    const body = new Uint8Array(m.length - 5 + prefix.length);
    body.set(m.subarray(5, at));
    body.set(prefix, at - 5);
    body.set(m.subarray(at), at - 5 + prefix.length);
    return frame(type, body);
  }

  /** The SQL of a Query or Parse, with statement names prefixed; copyIn is set for a lone COPY FROM STDIN query. */
  private rewrite(handlerId: number, m: Uint8Array): { msg: Uint8Array; copyIn?: Uint8Array } {
    const type = String.fromCharCode(m[0]!);
    if (type !== "Q" && type !== "P") return { msg: m };
    const from = type === "Q" ? 5 : m.indexOf(0, 5) + 1;
    const to = m.indexOf(0, from);
    if (from <= 0 || to < from) return { msg: m };
    const sql = dec.decode(m.subarray(from, to));
    if (!/prepare|execute|deallocate|copy|discard/i.test(sql)) return { msg: m };
    const r = rewriteSql(sql, handlerId);
    if (r.named) this.named.add(handlerId);
    const lone = type === "Q" && r.copyIn && r.statements === 1;
    const text = r.copyIn && !lone ? COPY_REFUSED : r.sql;
    const msg = text === sql ? m : frame(type, concat([m.subarray(5, from), enc.encode(text), m.subarray(to)]));
    if (!lone) return { msg };
    // CopyInResponse: text or binary, column count unknown before the COPY runs (clients don't read it)
    return { msg, copyIn: frame("G", new Uint8Array([r.binary ? 1 : 0, 0, 0])) };
  }
}

/** Fails at parse with a readable error, so a COPY FROM STDIN the queue can't hold doesn't kill PGlite. */
const COPY_REFUSED = `SELECT "rustybuns: use a simple query for COPY FROM STDIN"`;
/** The same for DISCARD TEMP: every connection's temp tables live in the one session. */
const DISCARD_TEMP_REFUSED = `SELECT "rustybuns: DROP temp tables by name, not DISCARD TEMP"`;

/** DEALLOCATE ALL for one connection: its own prefixed statements, not everyone's. */
function deallocateAll(handlerId: number): string {
  const prefix = `rb${handlerId}_`;
  return `DO $rb$DECLARE n text; BEGIN FOR n IN SELECT name FROM pg_prepared_statements WHERE left(name, ${prefix.length}) = '${prefix}' LOOP EXECUTE format('DEALLOCATE %I', n); END LOOP; END$rb$`;
}

interface Tok { s: string; at: number; end: number; quoted?: boolean; depth: number }

/** SQL's top-level words ("quoted" ones too) and ; ( ), past strings, comments and dollar quotes. */
export function sqlTokens(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0, depth = 0;
  const skipQuoted = (q: string, escapes: boolean) => {
    for (i++; i < sql.length; i++) {
      if (escapes && sql[i] === "\\") i++;
      else if (sql[i] === q) { if (sql[i + 1] === q) i++; else { i++; return; } }
    }
  };
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "-" && sql[i + 1] === "-") { const e = sql.indexOf("\n", i); i = e < 0 ? sql.length : e + 1; }
    else if (c === "/" && sql[i + 1] === "*") {
      let d = 1;
      for (i += 2; i < sql.length && d; ) {
        if (sql.startsWith("/*", i)) { d++; i += 2; } else if (sql.startsWith("*/", i)) { d--; i += 2; } else i++;
      }
    }
    else if (c === "'") skipQuoted("'", false);
    else if (c === '"') { const at = i; skipQuoted('"', false); out.push({ s: sql.slice(at + 1, i - 1).replaceAll('""', '"'), at, end: i, quoted: true, depth }); }
    else if (c === "$" && /^\$([A-Za-z_]\w*)?\$/.test(sql.slice(i, i + 64))) {
      const tag = sql.slice(i).match(/^\$([A-Za-z_]\w*)?\$/)![0];
      const e = sql.indexOf(tag, i + tag.length);
      i = e < 0 ? sql.length : e + tag.length;
    }
    else if (/[A-Za-z_\u0080-￿]/.test(c)) {
      const at = i;
      while (i < sql.length && /[\w$\u0080-￿]/.test(sql[i]!)) i++;
      const s = sql.slice(at, i);
      if (sql[i] === "'") skipQuoted("'", s === "e" || s === "E");   // E'..', B'..', X'..', U&'..'
      else out.push({ s: s.toLowerCase(), at, end: i, depth });
    }
    else if (/\d/.test(c)) { while (i < sql.length && /[\w.]/.test(sql[i]!)) i++; }
    else {
      if (c === "(") depth++;
      if (c === ";" || c === "(" || c === ")") out.push({ s: c, at: i, end: i + 1, depth });
      if (c === ")") depth = Math.max(0, depth - 1);
      i++;
    }
  }
  return out;
}

/** Prefix the names in PREPARE, EXECUTE and DEALLOCATE, scope DEALLOCATE ALL and DISCARD, and spot COPY ... FROM STDIN. */
export function rewriteSql(sql: string, handlerId: number) {
  const edits: { at: number; end: number; text: string }[] = [];
  const prefix = `rb${handlerId}_`;
  let named = false, copyIn = false, binary = false, statements = 0;
  const name = (t: Tok | undefined) => {
    if (!t || t.s === ";" || t.s === "(" || t.s === ")") return;
    const at = t.quoted ? t.at + 1 : t.at;
    edits.push({ at, end: at, text: prefix });
  };
  const toks = sqlTokens(sql);
  for (let start = 0; start < toks.length; ) {
    let end = toks.findIndex((t, k) => k >= start && t.s === ";");
    if (end < 0) end = toks.length;
    const st = toks.slice(start, end);
    start = end + 1;
    if (!st.length) continue;
    statements++;
    const [first, second, third] = st;
    if (first!.quoted) continue;
    if (first!.s === "prepare" && second && second.s !== "transaction") { name(second); named = true; }
    else if (first!.s === "execute") name(second);
    else if (first!.s === "deallocate") {
      const t = second?.s === "prepare" && !second.quoted ? third : second;
      if (t?.s === "all" && !t.quoted) edits.push({ at: first!.at, end: t.end, text: deallocateAll(handlerId) });
      else name(t);
    }
    else if (first!.s === "discard" && !second?.quoted) {
      // ALL also resets temp tables, settings and locks, shared by every connection; PLANS and SEQUENCES only drop caches
      if (second?.s === "all") edits.push({ at: first!.at, end: second.end, text: deallocateAll(handlerId) });
      else if (second?.s === "temp" || second?.s === "temporary") edits.push({ at: first!.at, end: second.end, text: DISCARD_TEMP_REFUSED });
    }
    else if (first!.s === "explain" || first!.s === "create") {
      // EXPLAIN [ANALYZE] EXECUTE s, CREATE TABLE t AS EXECUTE s; not GRANT-style EXECUTE ON / EXECUTE FUNCTION
      const k = st.findIndex((t, j) => j > 0 && t.s === "execute" && !t.quoted && ["as", "explain", "analyze", "verbose", ")"].includes(st[j - 1]!.s)
        && !["on", "function", "procedure"].includes(st[j + 1]?.s ?? "on"));
      if (k > 0) name(st[k + 1]);
    }
    else if (first!.s === "copy") {
      const k = st.findIndex((t, j) => t.s === "from" && !t.quoted && t.depth === 0 && st[j + 1]?.s === "stdin" && !st[j + 1]!.quoted);
      if (k > 0) { copyIn = true; binary ||= st.some((t) => t.s === "binary" && !t.quoted); }
    }
  }
  edits.sort((a, b) => b.at - a.at);
  for (const e of edits) sql = sql.slice(0, e.at) + e.text + sql.slice(e.end);
  return { sql, named, copyIn, binary, statements };
}

/**
 * The SQL migrations in `dir`, in name order: flat files (Drizzle's 0000_name.sql, wrangler's)
 * or a folder each holding migration.sql (Prisma's 20240101_name/). Ones already in
 * rb_migrations are skipped; each applies in its own transaction. Idempotent; call at every boot.
 */
export async function applyPgMigrations(db: PGlite, dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  await db.exec("CREATE TABLE IF NOT EXISTS rb_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM rb_migrations")).rows.map((r) => r.name));
  const files = readdirSync(dir).sort().flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return existsSync(join(p, "migration.sql")) ? [[f, join(p, "migration.sql")]] : [];
    return f.endsWith(".sql") ? [[f, p]] : [];
  });
  const applied: string[] = [];
  for (const [f, p] of files) {
    if (done.has(f!)) continue;
    const sql = await Bun.file(p!).text();
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO rb_migrations (name) VALUES ($1)", [f]);
    });
    applied.push(f!);
  }
  return applied;
}
