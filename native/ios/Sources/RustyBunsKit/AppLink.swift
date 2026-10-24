import Foundation

/// Which deployed RustyBuns app the phone shows, and where a tap on a link in it should go.
public struct AppLink: Equatable {
    public let url: URL

    /// Accepts what a person types ("my-app.workers.dev") or a deep link
    /// (`rustybuns://open?url=https://my-app.workers.dev`). Plain http is only allowed for localhost
    /// and private-network dev servers; everything else is upgraded to https.
    public init?(_ text: String) {
        guard let url = Self.parse(text) else { return nil }
        self.url = url
    }

    static func parse(_ text: String) -> URL? {
        let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }

        if let deep = URLComponents(string: raw), deep.scheme == "rustybuns" {
            guard let inner = deep.queryItems?.first(where: { $0.name == "url" })?.value else { return nil }
            return parse(inner)
        }

        let withScheme = raw.contains("://") ? raw : "https://" + raw
        guard var parts = URLComponents(string: withScheme), let host = parts.host, !host.isEmpty else { return nil }
        switch parts.scheme {
        case "https": break
        case "http" where isLocal(host): break
        case "http": parts.scheme = "https"
        default: return nil
        }
        return parts.url
    }

    /// A link stays inside the web view when it is the app's own host; anything else opens in Safari.
    public func keeps(_ target: URL) -> Bool {
        guard let host = target.host?.lowercased(), let mine = url.host?.lowercased() else { return false }
        return host == mine
    }

    static func isLocal(_ host: String) -> Bool {
        let h = host.lowercased()
        if h == "localhost" || h.hasSuffix(".local") { return true }
        let p = h.split(separator: ".").compactMap { Int($0) }
        guard p.count == 4 else { return false }
        return p[0] == 127 || p[0] == 10 || (p[0] == 192 && p[1] == 168) || (p[0] == 172 && (16...31).contains(p[1]))
    }
}
