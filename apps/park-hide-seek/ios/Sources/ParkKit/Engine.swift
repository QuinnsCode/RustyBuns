import Foundation
import JavaScriptCore

/// The game's own TypeScript room, run in JavaScriptCore: the same Hunt and bots the page and the edge run, so
/// offline play has the rules of online play. `script` is room.js (bun scripts/offline.ts packs it from src/offline.ts).
/// Not thread-safe: call it from one queue, as the app does from the main one.
public final class Engine {
    private let ctx: JSContext
    private let room: JSValue
    /// The last exception the script threw, if any.
    public private(set) var failure: String?

    public init?(script: String) {
        guard let ctx = JSContext() else { return nil }
        var err: String?
        ctx.exceptionHandler = { _, e in err = e?.toString() }
        // JavaScriptCore is the engine without the browser around it: the ground decodes with atob.
        let atob: @convention(block) (String) -> String? = { s in
            // a binary string: one character per byte, as in a browser
            Data(base64Encoded: s.padding(toLength: (s.count + 3) / 4 * 4, withPad: "=", startingAt: 0)).map { String(String.UnicodeScalarView($0.map(Unicode.Scalar.init))) }
        }
        ctx.setObject(atob, forKeyedSubscript: "atob" as NSString)
        ctx.evaluateScript(script)
        guard err == nil, let room = ctx.objectForKeyedSubscript("PhsRoom"), room.isObject else { return nil }
        self.ctx = ctx; self.room = room
        ctx.exceptionHandler = { [weak self] _, e in self?.failure = e?.toString() }
    }

    /// Starts a game with you as host and `bots` AI players; the lobby view.
    public func create(seed: Int, name: String, look: Look?, bots: Int, level: BotLevel = .normal, zone: String? = nil, tod: TimeOfDay = .day, now: Double) -> View? {
        var opts: [String: Any] = ["name": name, "bots": bots, "level": level.rawValue, "tod": tod.rawValue]
        if let zone { opts["zone"] = zone }
        if let look, let d = try? JSONEncoder().encode(look), let o = try? JSONSerialization.jsonObject(with: d) { opts["look"] = o }
        return room.invokeMethod("create", withArguments: [seed, opts, now]).toString().flatMap(decodeServerMsg)
    }

    public func send(_ m: ClientMsg, now: Double) { room.invokeMethod("handle", withArguments: [m.json(), now]) }

    /// Runs the game up to `now` (ms) and returns your view.
    public func tick(now: Double) -> View? { room.invokeMethod("tick", withArguments: [now]).toString().flatMap(decodeServerMsg) }

    /// A bundled zone's ground, as the edge's /api/zone sends it. Only the surveyed zones are here.
    public func zone(_ id: String) -> ZoneReply? {
        guard let v = room.invokeMethod("zone", withArguments: [id]), v.isString, let s = v.toString() else { return nil }
        return try? JSONDecoder().decode(ZoneReply.self, from: Data(s.utf8))
    }
}
