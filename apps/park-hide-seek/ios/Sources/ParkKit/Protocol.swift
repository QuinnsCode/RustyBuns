import Foundation

// The messages on /ws, as src/hunt/game.ts sends and reads them. The edge decides everything; these types only
// read what a player may see. Fields the app doesn't draw (radio asks, weather readings) are left out, and
// Codable ignores what it doesn't name, so the edge can add fields without breaking an old build.

public enum Role: String, Codable { case camper, ranger }
public enum Phase: String, Codable { case lobby, drop, hide, hunt, results, over }
public enum TimeOfDay: String, Codable { case day, dusk, night }
public enum Mode: String, Codable { case classic, props }
public enum BotLevel: String, Codable { case easy, normal, hard }
public enum Hat: String, Codable { case none, beanie, cap, bucket }

public struct Look: Codable, Equatable {
    public var shirt: Int, pants: Int, skin: Int
    public var hat: Hat
    public var pack: Bool
    public init(shirt: Int = 0, pants: Int = 0, skin: Int = 0, hat: Hat = .none, pack: Bool = false) {
        self.shirt = shirt; self.pants = pants; self.skin = skin; self.hat = hat; self.pack = pack
    }
}

public struct PlayerView: Codable, Equatable {
    public let id: String
    public let name: String
    public let bot: BotLevel?
    public let score: Int
    public let online: Bool
    public let look: Look
}

public struct Disguise: Codable, Equatable { public let kind: String, size: Double, rot: Double }

public struct ActorView: Codable, Equatable {
    public let id: String
    public let role: Role
    public let x: Double, y: Double, yaw: Double
    public let crouch: Bool, prone: Bool, climb: Bool
    public let caughtAt: Double?
    public let disguise: Disguise?
}

/// Your own state in the round.
public struct YouView: Codable, Equatable {
    public let id: String
    public let role: Role
    public let x: Double, y: Double, yaw: Double, pitch: Double
    public let stamina: Double
    public let crouch: Bool
    public let caughtAt: Double?
    public let disguise: Disguise?
}

public struct Sky: Codable, Equatable {
    public let tod: TimeOfDay
    public let fog: Double, rain: Double, wind: Double
    public let overcast: Bool, snow: Bool
}

public struct CircleView: Codable, Equatable {
    public let x0: Double, y0: Double, r0: Double, x1: Double, y1: Double, r1: Double
    public let from: Double, to: Double

    /// Where the search area is at server time `now`.
    public func at(_ now: Double) -> (x: Double, y: Double, r: Double) {
        let t = max(0, min(1, (now - from) / (to - from == 0 ? 1 : to - from)))
        return (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t)
    }
}

public struct Cue: Codable, Equatable {
    public let id: Int
    public let kind: String
    public let x: Double, y: Double, at: Double
}

public struct RoundResult: Codable, Equatable {
    public let id: String
    public let role: Role
    public let caughtAt: Double?
    public let points: Int
}

public struct RoundView: Codable, Equatable {
    public let id: Int
    public let n: Int, total: Int
    public let rangers: [String]
    public let you: YouView?
    public let others: [ActorView]
    public let cues: [Cue]
    public let huntStartedAt: Double
    public let circle: CircleView?
    public let sky: Sky
    public let results: [RoundResult]?
}

public struct View: Codable, Equatable {
    public let me: String
    public let hostId: String?
    public let phase: Phase
    public let now: Double
    public let endsAt: Double
    public let zone: String
    public let mode: Mode
    public let players: [PlayerView]
    public let round: RoundView?
    public let log: [String]

    public func name(of id: String) -> String { players.first { $0.id == id }?.name ?? "Someone" }
    /// Everyone met in this match who is not you and not an AI: the players Report and Block are for.
    public var strangers: [PlayerView] { players.filter { $0.id != me && $0.bot == nil } }
}

public struct ServerMsg: Codable { public let t: String, view: View }

/// What the app sends. `pos` goes out about 20 times a second.
public enum ClientMsg: Encodable, Equatable {
    case name(String)
    case look(Look)
    case start, lobby, call, disguise
    case bot(BotLevel)
    case drop(x: Double, y: Double)
    case pos(x: Double, y: Double, yaw: Double, pitch: Double, crouch: Bool, run: Bool, light: Bool)

    private enum Keys: String, CodingKey { case t, name, look, level, x, y, yaw, pitch, crouch, run, light }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .name(let n): try c.encode("name", forKey: .t); try c.encode(String(n.prefix(24)), forKey: .name)
        case .look(let l): try c.encode("look", forKey: .t); try c.encode(l, forKey: .look)
        case .start: try c.encode("start", forKey: .t)
        case .lobby: try c.encode("lobby", forKey: .t)
        case .call: try c.encode("call", forKey: .t)
        case .disguise: try c.encode("disguise", forKey: .t)
        case .bot(let l): try c.encode("bot", forKey: .t); try c.encode(l, forKey: .level)
        case .drop(let x, let y): try c.encode("drop", forKey: .t); try c.encode(x, forKey: .x); try c.encode(y, forKey: .y)
        case .pos(let x, let y, let yaw, let pitch, let crouch, let run, let light):
            try c.encode("pos", forKey: .t)
            try c.encode(x, forKey: .x); try c.encode(y, forKey: .y)
            try c.encode(yaw, forKey: .yaw); try c.encode(pitch, forKey: .pitch)
            try c.encode(crouch, forKey: .crouch); try c.encode(run, forKey: .run); try c.encode(light, forKey: .light)
        }
    }

    public func json() -> String {
        let data = (try? JSONEncoder().encode(self)) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}

public func decodeServerMsg(_ text: String) -> View? {
    guard let m = try? JSONDecoder().decode(ServerMsg.self, from: Data(text.utf8)), m.t == "view" else { return nil }
    return m.view
}
