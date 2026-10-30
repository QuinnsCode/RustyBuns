import Foundation

/// A person's friends hub at eqosys (apps/eqosys/src/hub.ts), as every app gets it: friends and which app each
/// is in right now, requests, notifications. The hub sends it on connect and after every change.
public struct HubState: Decodable, Equatable, Sendable {
    public struct Person: Decodable, Equatable, Sendable { public let id: String, name: String }
    public struct Presence: Decodable, Equatable, Sendable { public let app: String, doing: String }
    public struct Friend: Decodable, Equatable, Sendable {
        public let id: String, name: String
        public let presence: [Presence]
        /// Somewhere at all, in any Q app.
        public var on: Bool { !presence.isEmpty }
    }
    public struct Asked: Decodable, Equatable, Sendable { public let id: String, name: String }
    public struct Note: Decodable, Equatable, Sendable {
        public let key: String, kind: String
        public let from: Person
        public let app: String?, text: String?, link: String?
    }
    public let me: Person?
    public let friends: [Friend]
    public let incoming: [Asked]
    public let outgoing: [Asked]
    public let notes: [Note]

    /// A frame off the hub's socket: the state, or nil for an error or anything else.
    public static func decode(_ text: String) -> HubState? {
        struct Frame: Decodable { let t: String }
        guard let d = text.data(using: .utf8), (try? JSONDecoder().decode(Frame.self, from: d))?.t == "state" else { return nil }
        return try? JSONDecoder().decode(HubState.self, from: d)
    }
}

/// What an app says into its person's hub.
public enum HubOp: Equatable, Sendable {
    /// What they are doing in this app, for their friends to see ("hiding in the hedge"). Empty says just "on".
    case status(String)
    case befriend(email: String)
    case accept(id: String)
    case drop(id: String)
    case clear

    public func json() -> String {
        let o: [String: String]
        switch self {
        case .status(let d): o = ["op": "status", "doing": String(d.prefix(80))]
        case .befriend(let e): o = ["op": "befriend", "email": e]
        case .accept(let id): o = ["op": "accept", "id": id]
        case .drop(let id): o = ["op": "drop", "id": id]
        case .clear: o = ["op": "clear"]
        }
        return String(data: try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), encoding: .utf8)!
    }
}

/// The live line to a person's hub. Opens with a fresh token from `EqosysAuth`; the socket stays good after that
/// token expires. Closing it (or the app going away) tells friends this app is no longer on.
@MainActor
public final class HubLink {
    private let task: URLSessionWebSocketTask
    public var onState: (HubState) -> Void = { _ in }
    public var onClose: () -> Void = {}
    private var closed = false

    public init(client: EqosysClient, token: String) {
        task = URLSession.shared.webSocketTask(with: client.hubURL(token: token))
        task.resume()
        listen()
    }

    public func send(_ op: HubOp) { task.send(.string(op.json())) { _ in } }

    public func close() { closed = true; task.cancel(with: .normalClosure, reason: nil) }

    private func listen() {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, !self.closed else { return }
                switch result {
                case .success(let msg):
                    if case .string(let text) = msg, let s = HubState.decode(text) { self.onState(s) }
                    self.listen()
                case .failure:
                    self.closed = true
                    self.onClose()
                }
            }
        }
    }
}
