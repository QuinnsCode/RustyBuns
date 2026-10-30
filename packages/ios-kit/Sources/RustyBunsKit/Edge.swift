import Foundation

/// The protocol version handshake every store build speaks (@rustybuns/util/protocol): send `pv` on every socket
/// and call, and an edge that no longer serves this build answers HTTP 426 or closes the socket with 4426, with
/// `{ update, store }` saying which version it needs and where to get it. The app shows "Update to keep playing".
public struct EdgeProtocol: Sendable, Equatable {
    public static let field = "pv"
    public static let updateClose = 4426
    public static let updateText = "Update to keep playing"

    /// This build's protocol version: bump it in the app when the wire changes.
    public let version: Int
    public init(_ version: Int) { self.version = version }

    public var query: URLQueryItem { URLQueryItem(name: EdgeProtocol.field, value: String(version)) }

    /// `url` with `pv` added to its query.
    public func stamp(_ url: URL) -> URL {
        guard var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        c.queryItems = (c.queryItems ?? []).filter { $0.name != EdgeProtocol.field } + [query]
        return c.url ?? url
    }

    /// What the edge says when this build is too old: the version it needs, and the store link.
    public struct Update: Decodable, Equatable, Sendable {
        public let update: Int
        public let store: String
        public var storeURL: URL? { URL(string: store) }
    }
}

/// Why the app can't go on right now, and what to show for it.
public enum Trouble: Equatable, Sendable {
    case offline
    case updateRequired
    case full
    case signInAgain
    case other(String)

    /// From the HTTP status of a refused request or upgrade (an edge's own answers: 426, 503 full, 401 sign in again).
    public static func from(status: Int) -> Trouble {
        switch status {
        case 426: return .updateRequired
        case 503: return .full
        case 401: return .signInAgain
        default: return .other("The server said \(status).")
        }
    }

    /// From the code a socket closed with; nil for an ordinary close.
    public static func from(closeCode: Int) -> Trouble? {
        closeCode == EdgeProtocol.updateClose ? .updateRequired : nil
    }
}
