import XCTest
@testable import ParkKit

/// Offline play: the packed TypeScript room in JavaScriptCore, and the saves in SQLite.
/// The app folder is found from this file; room.js is built by `bun scripts/offline.ts` (the tests skip without it).
final class OfflineTests: XCTestCase {
    private let app = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    private func schema() throws -> String { try String(contentsOf: app.appendingPathComponent("schema.sql")) }

    func testSettingsAndRoundsComeBackFromTheDatabase() throws {
        let store = try XCTUnwrap(Store(path: ":memory:", schema: try schema()))
        XCTAssertNil(store.get("name"))
        store.put("name", "Ada"); store.put("name", "Ada B")
        XCTAssertEqual(store.get("name"), "Ada B")                               // a second write replaces, it doesn't add
        store.look = Look(shirt: 2, pants: 1, skin: 3, hat: .cap, pack: true)
        XCTAssertEqual(store.look, Look(shirt: 2, pants: 1, skin: 3, hat: .cap, pack: true))

        store.add(.init(playedAt: 100, zone: "half-dome", n: 1, role: .camper, caughtSecs: nil, points: 120))
        store.add(.init(playedAt: 200, zone: "old-faithful", n: 2, role: .ranger, caughtSecs: 41, points: 30))
        XCTAssertEqual(store.rounds().map(\.zone), ["old-faithful", "half-dome"])        // latest first
        XCTAssertEqual(store.rounds().first?.caughtSecs, 41)
        XCTAssertNil(store.rounds().last?.caughtSecs)
    }

    func testAWholeGameRunsAgainstBotsInTheEmbeddedRoom() throws {
        let script = try XCTUnwrap(try? String(contentsOf: app.appendingPathComponent("ios/App/Resources/room.js")), "run bun scripts/offline.ts first")
        let engine = try XCTUnwrap(Engine(script: script))
        var now = 1_000_000.0
        var v = try XCTUnwrap(engine.create(seed: 7, name: "Ada", look: nil, bots: 3, zone: "half-dome", now: now))
        XCTAssertEqual(v.players.count, 4)
        XCTAssertNotNil(engine.zone(v.zone).flatMap(Ground.init))                   // the ground comes with the room, no fetch
        XCTAssertNil(engine.zone("acadia"))                                         // the other parks are online-only

        engine.send(.start, now: now)
        var phases: [Phase] = []
        for _ in 0..<60_000 where v.phase != .over {
            now += 50
            v = try XCTUnwrap(engine.tick(now: now))
            if phases.last != v.phase { phases.append(v.phase) }
        }
        XCTAssertEqual(Array(phases.prefix(5)), [.drop, .hide, .hunt, .results, .drop])
        XCTAssertEqual(phases.last, .over)
        XCTAssertNil(engine.failure)
    }

    func testACamperPicksTheirDropInTheEmbeddedRoom() throws {
        let script = try XCTUnwrap(try? String(contentsOf: app.appendingPathComponent("ios/App/Resources/room.js")), "run bun scripts/offline.ts first")
        let engine = try XCTUnwrap(Engine(script: script))
        var now = 1_000_000.0
        var v = try XCTUnwrap(engine.create(seed: 7, name: "Ada", look: nil, bots: 3, zone: "half-dome", now: now))
        let zone = try XCTUnwrap(engine.zone(v.zone)), ground = try XCTUnwrap(Ground(zone))
        engine.send(.start, now: now)
        now += 50; v = try XCTUnwrap(engine.tick(now: now))
        XCTAssertEqual(v.phase, .drop)
        try XCTSkipIf(v.round?.you?.role != .camper, "Ada is a ranger with this seed")
        // a spot the app's rule accepts that the room may still refuse: try a ring of them until the room takes one
        var picked: [Double]?
        for k in 0..<200 where picked == nil {
            let a = Double(k) * 0.7, d = ground.radius * (0.3 + 0.5 * Double(k % 7) / 7)
            let x = cos(a) * d, y = sin(a) * d
            guard ground.canDrop(x, y, station: zone.station) else { continue }
            engine.send(.drop(x: x, y: y), now: now)
            now += 50; v = try XCTUnwrap(engine.tick(now: now))
            picked = v.round?.you?.drop
            if picked != nil { XCTAssertEqual(picked, [x, y]) }
        }
        XCTAssertNotNil(picked)
    }
}
