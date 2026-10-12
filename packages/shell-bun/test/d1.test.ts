import { expect, test } from "bun:test";
import { d1 } from "../src/bindings/d1.ts";

test("batch is one transaction: a failing statement rolls back the ones before it, as on D1", async () => {
  const db = d1();
  await db.exec("CREATE TABLE t (n INTEGER)");
  await expect(db.batch([db.prepare("INSERT INTO t VALUES (1)"), db.prepare("INSERT INTO nope VALUES (2)")])).rejects.toThrow("no such table");
  expect(await db.prepare("SELECT COUNT(*) AS c FROM t").first<number>("c")).toBe(0);

  const out = await db.batch([db.prepare("INSERT INTO t VALUES (?)").bind(1), db.prepare("SELECT n FROM t")]);
  expect(out[0]!.meta.changes).toBe(1);
  expect(out[1]!.results).toEqual([{ n: 1 }]);
});
