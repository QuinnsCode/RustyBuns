import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localBindings } from "../src/index.ts";

test("a renamed D1 opens the file it had under its old name, once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-renamed-"));
  const old = new Database(join(dir, "game-db.sqlite"), { create: true });
  old.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (7)");
  old.close();
  const local = localBindings(dir);
  const db = local.d1("games-db", "game-db");
  expect((await db.prepare("SELECT n FROM t").first()) as unknown).toEqual({ n: 7 });
  expect(existsSync(join(dir, "game-db.sqlite"))).toBe(false);
  // A file under the old name again (an older build ran) doesn't replace the new one.
  new Database(join(dir, "game-db.sqlite"), { create: true }).close();
  expect((await local.d1("games-db", "game-db").prepare("SELECT n FROM t").first()) as unknown).toEqual({ n: 7 });
  expect(existsSync(join(dir, "game-db.sqlite"))).toBe(true);
});

test("a renamed queue takes over the messages still waiting under its old name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-renamed-"));
  const local = localBindings(dir);
  await local.queue("game-jobs").send("waiting", { delaySeconds: 3600 });
  expect(local.queue("games-jobs").size()).toBe(0);
  expect(local.queue("games-jobs", "game-jobs").size()).toBe(1);
  expect(local.queue("game-jobs").size()).toBe(0);
});
