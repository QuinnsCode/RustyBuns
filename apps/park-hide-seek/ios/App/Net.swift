import Foundation
import Network
import ParkKit

/// One socket to a room. The edge sends a view whenever the game moves; the app sends `pos` about 20 times a second.
@MainActor
final class RoomLink {
    private let task: URLSessionWebSocketTask
    var onView: (View) -> Void = { _ in }
    var onClose: (Trouble?) -> Void = { _ in }
    private var closed = false

    init(url: URL) {
        task = URLSession.shared.webSocketTask(with: url)
        task.resume()
        listen()
    }

    func send(_ m: ClientMsg) { task.send(.string(m.json())) { _ in } }

    func close() { closed = true; task.cancel(with: .normalClosure, reason: nil) }

    private func listen() {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, !self.closed else { return }
                switch result {
                case .success(let msg):
                    if case .string(let text) = msg, let v = decodeServerMsg(text) { self.onView(v) }
                    self.listen()
                case .failure:
                    self.closed = true
                    // A refused upgrade carries the HTTP status on the task's response.
                    let status = (self.task.response as? HTTPURLResponse)?.statusCode
                    self.onClose(status.map(Trouble.from(status:)) ?? (self.task.closeCode.rawValue == 4001 ? .other("You joined from somewhere else.") : .offline))
                }
            }
        }
    }
}

enum Net {
    static func get<T: Decodable>(_ url: URL, as: T.Type) async throws -> T {
        let (data, res) = try await URLSession.shared.data(from: url)
        if let http = res as? HTTPURLResponse, http.statusCode != 200 { throw Failed(trouble: .from(status: http.statusCode)) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    struct Failed: Error { let trouble: Trouble }
    struct MatchReply: Decodable { let room: String, startsIn: Double }

    static func report(_ url: URL) async {
        var r = URLRequest(url: url); r.httpMethod = "POST"
        _ = try? await URLSession.shared.data(for: r)
    }
}

/// Tells the app when the phone has no route out, so the offline screen shows before a socket fails.
final class Reachability: ObservableObject {
    @Published var online = true
    private let monitor = NWPathMonitor()
    init() {
        monitor.pathUpdateHandler = { [weak self] p in DispatchQueue.main.async { self?.online = p.status == .satisfied } }
        monitor.start(queue: .global(qos: .utility))
    }
}
