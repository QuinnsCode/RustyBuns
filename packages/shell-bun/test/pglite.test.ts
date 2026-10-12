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

  // Bun.SQL's defaults, named prepared statements included, as against Hyperdrive (#1145)
  const sql = new SQL(h.connectionString, { max: 4 });
  try {
    // several pooled connections at once each prepare the same statement, twice over
    for (let round = 0; round < 2; round++) {
      const rows = await Promise.all([1, 2, 3, 4].map((n) => sql`SELECT ${n}::int AS n, (SELECT name FROM users LIMIT 1) AS name`));
      expect(rows.map((r) => r[0])).toEqual([1, 2, 3, 4].map((n) => ({ n, name: "ada" })));
    }
    await sql.begin(async (tx) => { await tx`INSERT INTO posts (user_id) VALUES (1)`; });
    expect((await sql`SELECT count(*)::int AS c FROM posts`)[0].c).toBe(1);
  } finally { await sql.close(); }
  await Bun.sleep(100);   // the server frees a leaving connection's statements on its turn
  expect((await h.db.query<{ c: number }>("SELECT count(*)::int AS c FROM pg_prepared_statements")).rows[0]!.c).toBe(0);

  // unnamed statements with different SQL, interleaved across connections, keep their own text
  const loose = new SQL(h.connectionString, { max: 4, prepare: false });
  try {
    const got = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      i % 2 ? loose`SELECT ${i}::int AS v` : loose`SELECT ${String(i)}::text || '!' AS v`));
    expect(got.map((r) => r[0].v)).toEqual(Array.from({ length: 12 }, (_, i) => i % 2 ? i : `${i}!`));
  } finally { await loose.close(); }
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
