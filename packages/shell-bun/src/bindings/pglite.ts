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
 * queries (a transaction keeps its connection's turn), so a pg.Pool needs no cap. It is still
 * one session: pooled clients need unnamed prepared statements (pg's default;
 * postgres.js and Bun.SQL take `prepare: false`), or two connections collide.
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
  await server.start();
  const port = Number(server.getServerConn().split(":").pop());
  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  console.log(`[${name}] no Postgres URL set: PGlite in ${dir} on 127.0.0.1:${port}`);
  return {
    connectionString, host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres", db,
    async close() { await server.stop(); await db.close(); },
  };
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
