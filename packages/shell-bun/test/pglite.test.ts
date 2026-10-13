import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { pgliteHyperdrive, rewriteSql, type PgliteHyperdrive } from "../src/bindings/pglite.ts";

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

/** A bare wire-protocol connection, for what Bun.SQL doesn't speak (COPY). */
async function wire(port: number) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  let buf = new Uint8Array(0);
  let wake = () => {};
  const sock = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data(_s, d) {
    const b = new Uint8Array(buf.length + d.length); b.set(buf); b.set(d, buf.length); buf = b; wake();
  } } });
  const frame = (type: string, text = "") => {
    const body = enc.encode(text), m = new Uint8Array(5 + body.length);
    m[0] = type.charCodeAt(0); new DataView(m.buffer).setInt32(1, 4 + body.length); m.set(body, 5);
    return m;
  };
  /** Messages up to and including the first of `type`, as "T:body" with NULs as |. */
  const until = async (type: string) => {
    const got: string[] = [];
    for (;;) {
      while (buf.length >= 5 && buf.length >= 1 + new DataView(buf.buffer, buf.byteOffset).getInt32(1)) {
        const len = 1 + new DataView(buf.buffer, buf.byteOffset).getInt32(1);
        const t = String.fromCharCode(buf[0]!);
        got.push(`${t}:${dec.decode(buf.subarray(5, len)).replaceAll("\0", "|")}`);
        buf = buf.slice(len);
        if (t === type) return got;
      }
      await new Promise<void>((r) => { wake = r; });
    }
  };
  const startup = enc.encode("\0\0\0\0\0\x03\0\0user\0postgres\0database\0postgres\0\0");
  new DataView(startup.buffer).setInt32(0, startup.length);
  sock.write(startup);
  await until("Z");
  return {
    send: (...m: [string, string?][]) => { for (const [t, s] of m) sock.write(frame(t, s)); },
    query: (sql: string) => { sock.write(frame("Q", `${sql}\0`)); return until("Z"); },
    until, close: () => sock.end(),
  };
}

test("pglite: COPY FROM STDIN streams in while other connections carry on (#1150)", async () => {
  const h = open.at(-1)!;
  const a = await wire(h.port), b = await wire(h.port);
  try {
    await a.query("CREATE TABLE nums (n int)");
    a.send(["Q", "COPY nums FROM STDIN\0"]);
    expect((await a.until("G"))[0]).toStartWith("G:");
    a.send(["d", "1\n2\n"]);
    // b's queries land between a's CopyData messages
    expect(await b.query("INSERT INTO nums VALUES (100)")).toEqual(["C:INSERT 0 1|", "Z:I"]);
    a.send(["d", "3\n"], ["c"]);
    expect(await a.until("Z")).toEqual(["C:COPY 3|", "Z:I"]);
    expect(await b.query("SELECT sum(n)::int FROM nums")).toContain("D:\0\x01\0\0\0\x03106".replaceAll("\0", "|"));

    // CopyFail and bad rows come back as errors; the transaction they're in fails as in Postgres
    a.send(["Q", "COPY nums FROM STDIN\0"], ["d", "4\n"], ["f", "changed my mind\0"]);
    expect((await a.until("Z")).slice(-2)).toEqual([expect.stringContaining("COPY from stdin failed: changed my mind"), "Z:I"]);
    await a.query("BEGIN");
    a.send(["Q", "COPY nums FROM STDIN\0"], ["d", "x\n"], ["c"]);
    expect((await a.until("Z")).slice(-2)).toEqual([expect.stringContaining("invalid input syntax for type integer"), "Z:E"]);
    await a.query("ROLLBACK");

    // one PGlite can't hold copy-in mid-batch: refused, and the twin lives on
    expect((await a.query("SELECT 1; COPY nums FROM STDIN"))).toContainEqual(expect.stringContaining("use a simple query for COPY FROM STDIN"));
    a.send(["P", "\0COPY nums FROM STDIN\0\0\0"], ["B", "\0\0\0\0\0\0\0\0"], ["E", "\0\0\0\0\0"], ["S"]);
    expect(await a.until("Z")).toContainEqual(expect.stringContaining("use a simple query for COPY FROM STDIN"));
    expect(await b.query("SELECT count(*)::int FROM nums")).toContain("D:|\x01|||\x014");
  } finally { a.close(); b.close(); }
});

test("pglite: SQL PREPARE, EXECUTE, DEALLOCATE ALL and DISCARD ALL stay per connection (#1150, #1167)", async () => {
  const h = open.at(-1)!;
  const sql = new SQL(h.connectionString, { max: 2 });
  try {
    const [a, b] = [await sql.reserve(), await sql.reserve()];
    await a.unsafe("PREPARE q AS SELECT 'a' AS who");
    await b.unsafe(`PREPARE "Q" (int) AS SELECT 'b' || $1 AS who`);
    await b.unsafe("PREPARE q AS SELECT 'b' AS who");
    expect((await a.unsafe("EXECUTE q"))[0].who).toBe("a");
    expect((await b.unsafe(`EXECUTE "Q" (1)`))[0].who).toBe("b1");
    expect((await b.unsafe("EXPLAIN EXECUTE q")).length).toBeGreaterThan(0);
    await a.unsafe("DEALLOCATE ALL");
    expect(await a.unsafe("EXECUTE q").catch((e: Error) => e.message)).toMatch(/does not exist/);
    expect((await b.unsafe("EXECUTE q"))[0].who).toBe("b");
    // a pooler's reset on release: a's statements go, b's statements and the session's temp tables stay (#1167)
    await b.unsafe("CREATE TEMP TABLE IF NOT EXISTS scratch (n int)");
    await a.unsafe("PREPARE q AS SELECT 'a' AS who");
    await a.unsafe("DISCARD ALL");
    expect(await a.unsafe("EXECUTE q").catch((e: Error) => e.message)).toMatch(/does not exist/);
    expect((await b.unsafe("EXECUTE q"))[0].who).toBe("b");
    expect(await b.unsafe("SELECT * FROM scratch")).toHaveLength(0);
    expect(await a.unsafe("DISCARD TEMP").catch((e: Error) => e.message)).toMatch(/DROP temp tables by name/);
    expect(await b.unsafe("SELECT * FROM scratch")).toHaveLength(0);
    await b.unsafe("DEALLOCATE PREPARE q");
    expect((await b.unsafe(`EXECUTE "Q" (2)`))[0].who).toBe("b2");
    a.release(); b.release();
  } finally { await sql.close(); }
  await Bun.sleep(100);   // a leaving connection's statements go on its turn
  expect((await h.db.query<{ c: number }>("SELECT count(*)::int AS c FROM pg_prepared_statements")).rows[0]!.c).toBe(0);
});

test("pglite: rewriteSql prefixes statement names and nothing else", () => {
  const r = (sql: string) => rewriteSql(sql, 7).sql;
  expect(r(`PREPARE Foo (int) AS SELECT $1; EXECUTE foo(1); DEALLOCATE PREPARE "Bar"`))
    .toBe(`PREPARE rb7_Foo (int) AS SELECT $1; EXECUTE rb7_foo(1); DEALLOCATE PREPARE "rb7_Bar"`);
  expect(r("EXPLAIN (ANALYZE) EXECUTE s; CREATE TABLE t AS EXECUTE s")).toBe("EXPLAIN (ANALYZE) EXECUTE rb7_s; CREATE TABLE t AS EXECUTE rb7_s");
  expect(r("deallocate all")).toStartWith("DO $rb$");
  expect(r("DEALLOCATE all_of_them")).toBe("DEALLOCATE rb7_all_of_them");
  expect(r("SELECT 1; DISCARD ALL")).toStartWith("SELECT 1; DO $rb$");
  expect(r("discard temporary")).toContain("DISCARD TEMP");
  // strings, comments, dollar quotes, columns and other statements' EXECUTE stay as they are
  for (const same of [
    "SELECT 'PREPARE x'; SELECT E'\\'; EXECUTE y'", "-- EXECUTE z\nSELECT 1 /* EXECUTE /* w */ */",
    "DO $$BEGIN EXECUTE 'DEALLOCATE ALL'; END$$", "SELECT prepare, execute FROM t", "PREPARE TRANSACTION 'g1'",
    "DISCARD PLANS", "DISCARD SEQUENCES", "GRANT EXECUTE ON FUNCTION f() TO u", "CREATE TRIGGER t AFTER INSERT ON x EXECUTE FUNCTION f()",
  ]) expect(r(same)).toBe(same);
  expect(rewriteSql("COPY t (a) FROM STDIN WITH (FORMAT binary)", 7)).toMatchObject({ copyIn: true, binary: true, statements: 1 });
  expect(rewriteSql("COPY (SELECT a FROM stdin) TO STDOUT; SELECT 1", 7)).toMatchObject({ copyIn: false, statements: 2 });
});
