import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { pgliteHyperdrive, type PgliteHyperdrive } from "../src/bindings/pglite.ts";

setDefaultTimeout(60_000);   // PGlite's first initdb takes a few seconds
const root = mkdtempSync(join(tmpdir(), "rb-pglite-"));
const open: PgliteHyperdrive[] = [];
afterAll(async () => { for (const h of open) await h.close(); rmSync(root, { recursive: true, force: true }); });

test("pglite: migrations apply once, and a Postgres client connects over the wire with a pool", async () => {
  const migrations = join(root, "migrations");
  mkdirSync(join(migrations, "20240102_posts"), { recursive: true });
  // Drizzle's flat files and Prisma's folders, in name order
  writeFileSync(join(migrations, "0000_users.sql"), "CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL);\n--> statement-breakpoint\nINSERT INTO users (name) VALUES ('ada');");
  writeFileSync(join(migrations, "20240102_posts", "migration.sql"), "CREATE TABLE posts (id serial PRIMARY KEY, user_id int REFERENCES users(id));");
  const said: string[] = [];
  const log = console.log;
  console.log = (m: string) => said.push(m);
  let h: PgliteHyperdrive;
  try { h = await pgliteHyperdrive(join(root, "db"), "PG", { migrations }); } finally { console.log = log; }
  open.push(h);
  expect(said).toContain("[PG] migrate 0000_users.sql");
  expect(said).toContain("[PG] migrate 20240102_posts");
  expect(h.connectionString).toBe(`postgres://postgres:postgres@127.0.0.1:${h.port}/postgres`);

  // One PGlite is one session, so named prepared statements from two connections collide:
  // a pool needs unnamed ones (pg's default; postgres.js and Bun.SQL take prepare: false).
  const sql = new SQL(h.connectionString, { max: 4, prepare: false });
  try {
    // several pooled connections at once: the socket server queues their queries
    const rows = await Promise.all([1, 2, 3, 4].map((n) => sql`SELECT ${n}::int AS n, (SELECT name FROM users LIMIT 1) AS name`));
    expect(rows.map((r) => r[0])).toEqual([1, 2, 3, 4].map((n) => ({ n, name: "ada" })));
    await sql.begin(async (tx) => { await tx`INSERT INTO posts (user_id) VALUES (1)`; });
    expect((await sql`SELECT count(*)::int AS c FROM posts`)[0].c).toBe(1);
  } finally { await sql.close(); }
});

test("pglite: the data dir outlives a restart, and applied migrations don't run again", async () => {
  const first = open.pop()!;
  await first.close();
  const said: string[] = [];
  const log = console.log;
  console.log = (m: string) => said.push(m);
  let h: PgliteHyperdrive;
  try { h = await pgliteHyperdrive(join(root, "db"), "PG", { migrations: join(root, "migrations") }); } finally { console.log = log; }
  open.push(h);
  expect(said.filter((m) => m.includes("migrate"))).toEqual([]);
  expect((await h.db.query<{ c: number }>("SELECT count(*)::int AS c FROM posts")).rows[0]!.c).toBe(1);
});
