// A preview database's saving (#5866 step 2): PGlite on PageFS keeps its data dir as 8 KB page rows in SQLite,
// the way a Durable Object will. bun:sqlite stands in for `ctx.storage`: same synchronous SQL, same transactions.
import { Database } from "bun:sqlite";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { PageFS, type PageStore } from "../do/src/pagefs.ts";

setDefaultTimeout(120_000);   // initdb

function store(db = new Database(":memory:")): PageStore & { db: Database } {
  return {
    db,
    sql: { exec: (q, ...b) => ({ toArray: () => db.query<never, typeof b>(q).all(...b) }) },
    transactionSync: (fn) => db.transaction(fn)(),
  };
}

describe("a preview database on page rows", () => {
  test("keeps its rows across a restart, and one write saves a few pages, not the dump", async () => {
    const s = store();
    const fs = new PageFS(s);
    const pg = await PGlite.create({ fs });
    await pg.exec("create table item (id int primary key, name text); insert into item select g, 'item ' || g from generate_series(1, 10000) g");
    const dump = (await pg.dumpDataDir("gzip")).size;

    const before = fs.stats.pagesWritten;
    await pg.query("insert into item values ($1, $2)", [10001, "one more"]);
    const written = (fs.stats.pagesWritten - before) * 8192;
    expect(written).toBeLessThan(dump / 20);
    await pg.close();

    // An eviction or deploy: a new instance over the same rows, booted with no tarball.
    const again = new PageFS(s);
    expect(again.empty).toBe(false);
    const pg2 = await PGlite.create({ fs: again });
    const { rows } = await pg2.query<{ n: number; last: string }>("select count(*)::int as n, (select name from item where id = 10001) as last from item");
    expect(rows[0]).toEqual({ n: 10001, last: "one more" });

    // A branch starts as a copy of another database's tarball, the way the DO copies the template.
    const tar = await pg2.dumpDataDir("gzip");
    await pg2.close();
    const branchFs = new PageFS(store());
    expect(branchFs.empty).toBe(true);
    const branch = await PGlite.create({ fs: branchFs, loadDataDir: tar });
    await branch.exec("delete from item where id > 10");
    expect((await branch.query<{ n: number }>("select count(*)::int as n from item")).rows[0]?.n).toBe(10);
    await branch.close();

    // The parent never saw the branch's delete.
    const pg3 = await PGlite.create({ fs: new PageFS(s) });
    expect((await pg3.query<{ n: number }>("select count(*)::int as n from item")).rows[0]?.n).toBe(10001);
    await pg3.close();
  });
});
