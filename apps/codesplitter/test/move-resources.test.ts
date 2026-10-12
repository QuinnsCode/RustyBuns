// scripts/move-resources.ts: its decisions against what the tools and APIs really return. The
// shapes are copied from the source of what's installed (wrangler 4.149.0, which `bunx wrangler`
// runs; @distilled.cloud/cloudflare 1.0.0-rc.9, Alchemy's Cloudflare client), cited at each test.
// The SQL runs against a real SQLite (bun:sqlite), as D1 is. Nothing here calls Cloudflare.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { differences, isMissing, liveDatabaseId, locationHint, nextCursor, parseAuthToken, SCHEMA_SQL, stateStep, TABLES_SQL, virtualTables } from "../scripts/move-resources.ts";

const TOKEN = "Xq3v8mN0pLkJ7hGfDsA1zYwTr5eB2cVuI9oP4n6M";

describe("parseAuthToken", () => {
  test("reads `wrangler auth token --json`: JSON.stringify({ type, token }, null, 2), no banner", () => {
    expect(parseAuthToken(JSON.stringify({ type: "oauth", token: TOKEN }, null, 2) + "\n")).toBe(TOKEN);
  });
  test("an older wrangler without --json: the banner, then the token on the last line", () => {
    expect(parseAuthToken(`\n ⛅️ wrangler 4.149.0\n───────────────────\n${TOKEN}\n`)).toBe(TOKEN);
  });
  test("not logged in: wrangler's error is no token", () => {
    expect(parseAuthToken("✘ [ERROR] Not logged in. Please run `wrangler login` to authenticate.\n")).toBeNull();
    expect(parseAuthToken("")).toBeNull();
  });
});

describe("isMissing", () => {
  // Codes from the NotFound error matchers in @distilled.cloud/cloudflare's d1.ts, r2.ts, workers.ts, vectorize.ts.
  test("a 404, or a not-found code on another status", () => {
    expect(isMissing(404, [])).toBe(true);
    expect(isMissing(400, [{ code: 3000, message: "vectorize.index.missing" }])).toBe(true);
    expect(isMissing(410, [{ code: 3005, message: "index deleted" }])).toBe(true);
    expect(isMissing(400, [{ code: 7404, message: "The database was not found" }])).toBe(true);
    expect(isMissing(400, [{ code: 10006, message: "The specified bucket does not exist." }])).toBe(true);
    expect(isMissing(400, [{ code: 10007, message: "This Worker does not exist on your account." }])).toBe(true);
    expect(isMissing(400, [{ code: 1, message: "vectorize.index.not_found" }])).toBe(true);
  });
  test("auth and other failures are not 'missing': the script stops on them", () => {
    expect(isMissing(403, [{ code: 10000, message: "Authentication error" }])).toBe(false);
    expect(isMissing(500, undefined)).toBe(false);
  });
});

describe("liveDatabaseId", () => {
  const UUID = "0d3a1c2e-1111-4222-8333-944455556666";
  test("the settings API's d1 binding carries database_id (required; id is optional)", () => {
    // ScriptsScriptAndVersionSettingsGetResponseBindingsItemD1: { database_id, name, type: "d1", id? }
    const bindings = [
      { type: "durable_object_namespace", name: "FILES", class_name: "FileDurableObject" },
      { type: "d1", name: "DB", database_id: UUID },
      { type: "r2_bucket", name: "LEVEL_CHUNKS", bucket_name: "codesplitter-level-chunks" },
    ];
    expect(liveDatabaseId(bindings)).toBe(UUID);
  });
  test("an id alone still counts", () => {
    expect(liveDatabaseId([{ type: "d1", name: "DB", id: UUID }])).toBe(UUID);
  });
  test("no Worker, no bindings, or no DB binding", () => {
    expect(liveDatabaseId(undefined)).toBeNull();
    expect(liveDatabaseId([{ type: "d1", name: "OTHER", database_id: UUID }])).toBeNull();
  });
});

describe("locationHint", () => {
  test("running_in_region upper-case becomes the create's hint; wrangler's LOCATION_CHOICES only", () => {
    expect(locationHint("ENAM")).toBe("enam");
    expect(locationHint("weur")).toBe("weur");
    expect(locationHint("SJC")).toBeUndefined();
    expect(locationHint(undefined)).toBeUndefined();
  });
});

describe("nextCursor", () => {
  test("follows result_info.cursor while is_truncated", () => {
    expect(nextCursor({ cursor: "abc", is_truncated: true }, "")).toBe("abc");
  });
  test("follows a cursor when is_truncated isn't given (distilled's ResultInfo has no such field)", () => {
    expect(nextCursor({ cursor: "abc" }, "")).toBe("abc");
  });
  test("stops at the end, and on a cursor handed straight back", () => {
    expect(nextCursor({ cursor: "abc", is_truncated: false }, "")).toBeNull();
    expect(nextCursor({ cursor: "" }, "x")).toBeNull();
    expect(nextCursor(undefined, "")).toBeNull();
    expect(nextCursor({ cursor: "abc", is_truncated: true }, "abc")).toBeNull();
  });
});

describe("stateStep", () => {
  test("release.ts moves the state first, so the script finds it moved", () => {
    expect(stateStep(false, true)).toBe("moved");
    expect(stateStep(true, false)).toBe("move");
    expect(stateStep(false, false)).toBe("none");
    expect(stateStep(true, true)).toBe("both");
  });
});

describe("the SQL, on SQLite", () => {
  const db = () => {
    const d = new Database(":memory:");
    d.run("CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB)"); // D1's own table
    d.run("CREATE TABLE __alchemy_migrations (id TEXT PRIMARY KEY)");
    d.run("CREATE TABLE xcfy (a)"); // matches an unescaped '_cf_%'
    d.run("CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER)");
    d.run("CREATE INDEX files_by_time ON files (created_at)");
    d.run("CREATE TRIGGER files_created AFTER INSERT ON files WHEN NEW.created_at IS NULL BEGIN UPDATE files SET created_at = 1 WHERE rowid = NEW.rowid; END");
    d.run("INSERT INTO files (created_at) VALUES (5)");
    return d;
  };
  test("tables: D1's _cf_* and sqlite_sequence left out, everything else (Alchemy's migrations too) kept", () => {
    const names = (db().query(TABLES_SQL).all() as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(["__alchemy_migrations", "files", "xcfy"]);
  });
  test("indexes and triggers, without SQLite's autoindexes", () => {
    const d = db();
    const rows = (d.query(SCHEMA_SQL).all() as { type: string; name: string }[]).map((r) => `${r.type} ${r.name}`);
    expect(rows).toEqual(["index files_by_time", "trigger files_created"]);
  });
  test("an FTS5 table is caught as virtual, from sqlite_master's sql", () => {
    const d = db();
    d.run("CREATE VIRTUAL TABLE file_search USING fts5(owner UNINDEXED, repo UNINDEXED, path, content)");
    expect(virtualTables(d.query(TABLES_SQL).all() as { name: string; sql: string }[])).toEqual(["file_search"]);
  });
});

describe("differences", () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  test("matching counts and schema: none", () => {
    expect(differences(m({ files: 3 }), m({ files: 3 }), ["trigger t"], ["trigger t"])).toEqual([]);
  });
  test("a count off, a table missing, a trigger lost", () => {
    expect(differences(m({ files: 3, users: 1 }), m({ files: 2 }), ["trigger t"], [])).toEqual(["files (3 vs 2)", "users (1 vs missing)", "trigger t (missing from the copy)"]);
  });
});
