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
 * from a pool unchanged, the same client code as against Hyperdrive.
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

/**
 * Stands in for pglite-socket's query queue (same three methods its handlers call) so many
 * connections share PGlite's one session without seeing each other:
 * - a connection keeps its turn from its first extended-protocol message to its Sync, and
 *   through a transaction, so another's Parse can't replace its unnamed statement mid-query;
 * - named prepared statements get a per-connection prefix (Parse, Bind, Describe, Close),
 *   so two pooled connections can both prepare "s1" (42P05 otherwise, #1145);
 * - a connection that leaves gets its batch synced, its transaction rolled back and its
 *   statements closed, on its turn.
 * SQL-level PREPARE / DEALLOCATE ALL and COPY still act on the shared session.
 */
export class SessionQueue {
  private queue: { handlerId: number; run: () => Promise<number>; resolve(n: number): void; reject(e: unknown): void }[] = [];
  private busy = false;
  private owner: number | null = null;          // whose turn it is, while a batch or transaction is open
  private open = new Set<number>();             // connections between an extended message and its Sync
  private named = new Map<number, Set<string>>();
  constructor(private db: PGlite) {}

  enqueue(handlerId: number, message: Uint8Array, onData: (data: Uint8Array) => void): Promise<number> {
    const msg = this.rename(handlerId, message);
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
    const names = this.named.get(handlerId);
    if (this.owner !== handlerId && !this.open.has(handlerId) && !names?.size) return;
    this.named.delete(handlerId);
    this.push(handlerId, async () => {
      await this.db.runExclusive(async () => {
        if (this.open.delete(handlerId)) await this.db.execProtocolRaw(SYNC);
        if (this.db.isInTransaction()) await this.db.execProtocolRaw(frame("Q", enc.encode("ROLLBACK\0")));
        for (const name of names ?? []) await this.db.execProtocolRaw(frame("C", enc.encode(`S${name}\0`)));
        if (names?.size) await this.db.execProtocolRaw(SYNC);
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

  /** Prefix a Parse/Bind/Describe/Close statement name with the connection's, tracking what it holds. */
  private rename(handlerId: number, m: Uint8Array): Uint8Array {
    const type = String.fromCharCode(m[0]!);
    if (m.length < 6 || !"PBCD".includes(type) || !m[0]) return m;
    let at = 5;
    if (type === "B") at = m.indexOf(0, 5) + 1;              // past the portal name
    else if (type === "C" || type === "D") { if (m[5] !== 0x53) return m; at = 6; }   // 'S'tatement, not 'P'ortal
    const end = m.indexOf(0, at);
    if (at <= 0 || end <= at) return m;                      // unnamed: the turn keeps it ours
    const prefix = enc.encode(`rb${handlerId}_`);
    const name = `rb${handlerId}_${dec.decode(m.subarray(at, end))}`;
    const held = this.named.get(handlerId) ?? new Set<string>();
    this.named.set(handlerId, held);
    if (type === "P") held.add(name);
    else if (type === "C") held.delete(name);
    const body = new Uint8Array(m.length - 5 + prefix.length);
    body.set(m.subarray(5, at));
    body.set(prefix, at - 5);
    body.set(m.subarray(at), at - 5 + prefix.length);
    return frame(type, body);
  }
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
