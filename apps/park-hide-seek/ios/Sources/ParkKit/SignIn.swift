import Foundation
import CryptoKit

/// Signing in through eqosys, as src/ui/eqosys.ts does it from the page: PKCE, then the code is traded at
/// /api/exchange for the signed token the edge checks in place of `uid` and `name`.
public struct PkceLogin {
    public static let eqosys = URL(string: "https://eqosys.qntbr.com")!
    public static let app = "park-hide-seek"

    public let verifier: String
    public let state: String

    public init(verifier: String = PkceLogin.random(32), state: String = PkceLogin.random(12)) { self.verifier = verifier; self.state = state }

    public static func random(_ n: Int) -> String { b64url(Data((0..<n).map { _ in UInt8.random(in: 0...255) })) }

    public static func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    public var challenge: String { PkceLogin.b64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }

    /// eqosys's /login, which sends the player back to `returnTo` with ?code= and ?state=.
    public func loginURL(returnTo: URL, eqosys: URL = PkceLogin.eqosys) -> URL {
        var c = URLComponents(url: eqosys.appendingPathComponent("login"), resolvingAgainstBaseURL: false)!
        c.queryItems = [("app", PkceLogin.app), ("return", returnTo.absoluteString), ("challenge", challenge), ("state", state)].map { URLQueryItem(name: $0, value: $1) }
        return c.url!
    }

    /// The code from the way back, or nil when it isn't ours (a different state: a sign-in that didn't start here).
    public func code(from back: URL) -> String? {
        let items = URLComponents(url: back, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state else { return nil }
        return items.first(where: { $0.name == "code" })?.value
    }

    public func exchangeRequest(code: String, eqosys: URL = PkceLogin.eqosys) -> URLRequest {
        var r = URLRequest(url: eqosys.appendingPathComponent("api/exchange"))
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["app": PkceLogin.app, "code": code, "verifier": verifier])
        return r
    }
}

/// POST eqosys /api/exchange's reply (ExchangeReply in src/api.ts). `token` is null while eqosys has no signing key.
public struct Exchange: Codable {
    public struct User: Codable { public let id: String, email: String, name: String }
    public let user: User
    public let token: String?
}
