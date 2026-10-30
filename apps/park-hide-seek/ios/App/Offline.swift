import Foundation
import ParkKit

/// A game that runs on the phone: the TypeScript room in JavaScriptCore, a few AI players, and the saves in SQLite.
/// It stands where `RoomLink` stands for an online room: views come out of `onView`, messages go into `send`.
@MainActor
final class OfflineGame {
    /// The zones that ship in the app: Yosemite and Yellowstone (the surveyed ones in src/zones/zone.ts).
    static let zones = ["half-dome", "el-capitan", "glacier-point", "yosemite-falls", "mariposa-grove", "old-faithful", "grand-prismatic"]

    let engine: Engine
    let store: Store
    var onView: (View) -> Void = { _ in }
    private var timer: Timer?
    private var saved = 0

    /// Nil when the bundle is missing room.js or schema.sql (a build that skipped `bun scripts/offline.ts`).
    init?(bundle: Bundle = .main) {
        guard let js = bundle.url(forResource: "room", withExtension: "js").flatMap({ try? String(contentsOf: $0) }),
              let sql = bundle.url(forResource: "schema", withExtension: "sql").flatMap({ try? String(contentsOf: $0) }),
              let dir = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true),
              let engine = Engine(script: js),
              let store = Store(path: dir.appendingPathComponent("park.sqlite").path, schema: sql) else { return nil }
        self.engine = engine; self.store = store
    }

    private var now: Double { Date().timeIntervalSince1970 * 1000 }

    /// Starts a game against `bots` AI players in a random bundled zone and presses Start; the first view.
    func begin(name: String, bots: Int = 3) -> View? {
        guard let v = engine.create(seed: Int.random(in: 1..<1_000_000), name: name, look: store.look, bots: bots, zone: Self.zones.randomElement()!, now: now) else { return nil }
        store.put("name", name)
        engine.send(.start, now: now)
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.step() }
        }
        return v
    }

    func send(_ m: ClientMsg) { engine.send(m, now: now) }

    func close() { timer?.invalidate(); timer = nil }

    private func step() {
        guard let v = engine.tick(now: now) else { return }
        // one row per round, the moment its results are in
        if v.phase == .results, let r = v.round, r.id != saved, let mine = r.results?.first(where: { $0.id == v.me }) {
            saved = r.id
            store.add(.init(playedAt: Int64(now), zone: v.zone, n: r.n + 1, role: mine.role, caughtSecs: mine.caughtAt.map { Int(($0 - r.huntStartedAt) / 1000) }, points: mine.points))
        }
        onView(v)
    }
}
