import Foundation

/// Where the game lives and how the app reaches it.
public struct Edge {
    public static let live = Edge(base: URL(string: "https://park-hide-seek.notryanquinn.workers.dev")!)
    public let base: URL
    public init(base: URL) { self.base = base }

    /// 4 to 8 capitals and digits; quick play rooms start with Q (ROOM in src/api.ts).
    public static func isRoomCode(_ s: String) -> Bool {
        (4...8).contains(s.count) && s.allSatisfy { ($0 >= "A" && $0 <= "Z") || ($0 >= "0" && $0 <= "9") }
    }

    /// The room a universal link or pasted text names: `https://<host>/?room=PIKA`, `…/join/PIKA`, or just `PIKA`.
    public static func room(from text: String) -> String? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: t), let items = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            if let r = items.queryItems?.first(where: { $0.name == "room" })?.value?.uppercased(), isRoomCode(r) { return r }
            let parts = url.pathComponents
            if let i = parts.firstIndex(of: "join"), i + 1 < parts.count, isRoomCode(parts[i + 1].uppercased()) { return parts[i + 1].uppercased() }
        }
        let up = t.uppercased()
        return isRoomCode(up) ? up : nil
    }

    /// A player's identity on the wire: a signed eqosys token, or the id this install made and the name typed.
    public enum Who: Equatable {
        case token(String)
        case guest(uid: String, name: String)
        var query: [URLQueryItem] {
            switch self {
            case .token(let t): return [URLQueryItem(name: "token", value: t)]
            case .guest(let uid, let name): return [URLQueryItem(name: "uid", value: uid), URLQueryItem(name: "name", value: name)]
            }
        }
    }

    private func url(_ path: String, _ q: [URLQueryItem], scheme: String? = nil) -> URL {
        var c = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        c.queryItems = q
        if let scheme { c.scheme = scheme }
        return c.url!
    }

    public func socket(room: String, who: Who) -> URL { url("ws", [URLQueryItem(name: "room", value: room)] + who.query, scheme: base.scheme == "http" ? "ws" : "wss") }
    public func match(who: Who) -> URL { url("api/match", who.query) }
    public func zone(_ id: String) -> URL { url("api/zone", [URLQueryItem(name: "id", value: id)]) }
    public func report(room: String, player: String, reason: String, who: Who) -> URL {
        url("api/report", [URLQueryItem(name: "room", value: room), URLQueryItem(name: "player", value: player), URLQueryItem(name: "reason", value: reason)] + who.query)
    }
    /// The link a player shares for Play with friends.
    public func invite(room: String) -> URL { url("", [URLQueryItem(name: "room", value: room)]) }

    /// A new room code for Play with friends: 4 capitals, never starting with Q (quick play's).
    public static func newRoomCode(_ r: () -> Int = { Int.random(in: 0..<Int.max) }) -> String {
        let letters = Array("ABCDEFGHJKLMNOPRSTUVWXYZ")   // no I/O lookalikes, no Q
        var n = r()
        var out = ""
        for _ in 0..<4 { out.append(letters[n % letters.count]); n /= letters.count }
        return out
    }
}

/// Why the app can't play right now, and what to show for it.
public enum Trouble: Equatable {
    case offline
    case updateRequired
    case full
    case signInAgain
    case other(String)

    /// From the HTTP status of a refused request or upgrade (the edge's own answers: 426, 503 full, 401 sign in again).
    public static func from(status: Int) -> Trouble {
        switch status {
        case 426: return .updateRequired
        case 503: return .full
        case 401: return .signInAgain
        default: return .other("The server said \(status).")
        }
    }
}
