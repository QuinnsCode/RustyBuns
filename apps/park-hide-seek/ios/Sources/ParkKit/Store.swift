import Foundation
import SQLite3

/// The phone's saves in SQLite: settings (the page's `phs.*` keys) and one row per round played. The tables are
/// in schema.sql, handed in as text so the app can read it from its bundle and a test from the repo.
public final class Store {
    public struct Round: Equatable {
        public let playedAt: Int64
        public let zone: String
        public let n: Int
        public let role: Role
        public let caughtSecs: Int?
        public let points: Int
        public init(playedAt: Int64, zone: String, n: Int, role: Role, caughtSecs: Int?, points: Int) {
            self.playedAt = playedAt; self.zone = zone; self.n = n; self.role = role; self.caughtSecs = caughtSecs; self.points = points
        }
    }

    private var db: OpaquePointer?

    /// Opens (or makes) the database at `path`; ":memory:" for a throwaway one.
    public init?(path: String, schema: String) {
        guard sqlite3_open(path, &db) == SQLITE_OK, sqlite3_exec(db, schema, nil, nil, nil) == SQLITE_OK else { sqlite3_close(db); return nil }
    }

    deinit { sqlite3_close(db) }

    // SQLITE_TRANSIENT makes sqlite3_bind_text take its own copy of the string.
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private func run(_ sql: String, _ bind: (OpaquePointer) -> Void = { _ in }, row: (OpaquePointer) -> Void = { _ in }) {
        var st: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK, let st else { return }
        defer { sqlite3_finalize(st) }
        bind(st)
        while sqlite3_step(st) == SQLITE_ROW { row(st) }
    }

    public func get(_ key: String) -> String? {
        var out: String?
        run("SELECT value FROM settings WHERE key = ?", { sqlite3_bind_text($0, 1, key, -1, Store.transient) }, row: { out = String(cString: sqlite3_column_text($0, 0)) })
        return out
    }

    public func put(_ key: String, _ value: String) {
        run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            { sqlite3_bind_text($0, 1, key, -1, Store.transient); sqlite3_bind_text($0, 2, value, -1, Store.transient) })
    }

    public var look: Look? {
        get { get("look").flatMap { try? JSONDecoder().decode(Look.self, from: Data($0.utf8)) } }
        set { if let l = newValue, let d = try? JSONEncoder().encode(l) { put("look", String(decoding: d, as: UTF8.self)) } }
    }

    public func add(_ r: Round) {
        run("INSERT INTO rounds (played_at, zone, n, role, caught_secs, points) VALUES (?, ?, ?, ?, ?, ?)", { st in
            sqlite3_bind_int64(st, 1, r.playedAt)
            sqlite3_bind_text(st, 2, r.zone, -1, Store.transient)
            sqlite3_bind_int(st, 3, Int32(r.n))
            sqlite3_bind_text(st, 4, r.role.rawValue, -1, Store.transient)
            if let c = r.caughtSecs { sqlite3_bind_int(st, 5, Int32(c)) } else { sqlite3_bind_null(st, 5) }
            sqlite3_bind_int(st, 6, Int32(r.points))
        })
    }

    /// The latest rounds first.
    public func rounds(limit: Int = 20) -> [Round] {
        var out: [Round] = []
        run("SELECT played_at, zone, n, role, caught_secs, points FROM rounds ORDER BY played_at DESC, id DESC LIMIT ?", { sqlite3_bind_int($0, 1, Int32(limit)) }, row: { st in
            out.append(Round(playedAt: sqlite3_column_int64(st, 0), zone: String(cString: sqlite3_column_text(st, 1)), n: Int(sqlite3_column_int(st, 2)),
                             role: Role(rawValue: String(cString: sqlite3_column_text(st, 3))) ?? .camper,
                             caughtSecs: sqlite3_column_type(st, 4) == SQLITE_NULL ? nil : Int(sqlite3_column_int(st, 4)), points: Int(sqlite3_column_int(st, 5))))
        })
        return out
    }
}
