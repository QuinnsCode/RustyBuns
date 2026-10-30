import Foundation
import CryptoKit

/// One app's side of eqosys as an OpenID provider (apps/eqosys/src/oauth.ts): PKCE to the app's own URL scheme,
/// then a code for an access token (ten minutes), an id_token and a refresh token (a month, one use: each
/// refresh hands out the next). Plain values and requests only, so it tests without a network or a phone;
/// `EqosysAuth` runs it and keeps the session, `EqosysSignIn` shows the sign-in sheet.
public struct EqosysClient: Sendable {
    public static let live = URL(string: "https://eqosys.qntbr.com")!

    /// The app's id in eqosys's APPS, which is its OpenID client id.
    public let app: String
    /// Where eqosys sends the person back: `<bundle id>:/eqosys`, a scheme listed for the app in APPS.
    public let redirect: URL
    public let base: URL

    public init(app: String, redirect: URL, base: URL = EqosysClient.live) { self.app = app; self.redirect = redirect; self.base = base }

    /// The app's bundle id as its scheme, the way RFC 8252 asks for it.
    public init(app: String, bundleId: String = Bundle.main.bundleIdentifier ?? "", base: URL = EqosysClient.live) {
        self.init(app: app, redirect: URL(string: "\(bundleId.lowercased()):/eqosys")!, base: base)
    }

    public var scheme: String { redirect.scheme ?? "" }

    /// What one sign-in keeps between sending the person off and their coming back. Never leaves the phone.
    public struct Ask: Sendable, Equatable {
        public let verifier: String, state: String, nonce: String
        public init(verifier: String = b64url(randomBytes(32)), state: String = b64url(randomBytes(12)), nonce: String = b64url(randomBytes(16))) {
            self.verifier = verifier; self.state = state; self.nonce = nonce
        }
        /// PKCE's S256 challenge of the verifier.
        public var challenge: String { b64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    }

    /// eqosys's authorize page for this ask; `offline` asks for the refresh token a native app keeps.
    public func authorizeURL(_ ask: Ask, offline: Bool = true) -> URL {
        var c = URLComponents(url: base.appendingPathComponent("oauth/authorize"), resolvingAgainstBaseURL: false)!
        c.queryItems = [
            ("response_type", "code"), ("client_id", app), ("redirect_uri", redirect.absoluteString),
            ("code_challenge", ask.challenge), ("code_challenge_method", "S256"), ("state", ask.state), ("nonce", ask.nonce),
            ("scope", offline ? "openid email profile offline_access" : "openid email profile"),
        ].map { URLQueryItem(name: $0, value: $1) }
        return c.url!
    }

    /// The code on the way back, or why there is none.
    public func code(from back: URL, _ ask: Ask) throws -> String {
        let items = URLComponents(url: back, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let q = { (k: String) in items.first(where: { $0.name == k })?.value }
        // A different state is a sign-in that didn't start here: never trade its code.
        guard q("state") == ask.state else { throw EqosysError.notOurs }
        if let e = q("error") { throw EqosysError.refused(e) }
        guard let code = q("code") else { throw EqosysError.notOurs }
        return code
    }

    private func form(_ path: String, _ fields: [(String, String)]) -> URLRequest {
        var r = URLRequest(url: base.appendingPathComponent(path))
        r.httpMethod = "POST"
        r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
        var c = URLComponents(); c.queryItems = fields.map { URLQueryItem(name: $0, value: $1) }
        // A form body escapes + too, which URLComponents leaves alone.
        r.httpBody = Data((c.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
        return r
    }

    public func tokenRequest(code: String, _ ask: Ask) -> URLRequest {
        form("oauth/token", [("grant_type", "authorization_code"), ("client_id", app), ("code", code), ("code_verifier", ask.verifier),
                             ("redirect_uri", redirect.absoluteString), ("scope", "openid email profile offline_access")])
    }
    public func refreshRequest(_ refresh: String) -> URLRequest {
        form("oauth/token", [("grant_type", "refresh_token"), ("client_id", app), ("refresh_token", refresh)])
    }
    public func revokeRequest(_ refresh: String) -> URLRequest { form("oauth/revoke", [("token", refresh)]) }

    /// Deleting the account from inside the app (App Store 5.1.1(v)), with a fresh access token as the proof.
    public func deleteRequest(token: String) -> URLRequest {
        var r = URLRequest(url: base.appendingPathComponent("api/account/delete"))
        r.httpMethod = "POST"
        r.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        r.httpBody = Data("{}".utf8)
        return r
    }

    /// The friends hub's socket for this person (apps/eqosys/src/hub.ts).
    public func hubURL(token: String) -> URL {
        var c = URLComponents(url: base.appendingPathComponent("hub"), resolvingAgainstBaseURL: false)!
        c.scheme = base.scheme == "http" ? "ws" : "wss"
        c.queryItems = [URLQueryItem(name: "token", value: token)]
        return c.url!
    }

    /// The token endpoint's answer as a session, checking the id_token carries this ask's nonce.
    public func session(from data: Data, ask: Ask?, now: Date = Date()) throws -> EqosysSession {
        if let e = try? JSONDecoder().decode(OAuthError.self, from: data) { throw e.error == "invalid_grant" ? EqosysError.signInAgain : EqosysError.refused(e.error) }
        let t = try JSONDecoder().decode(TokenReply.self, from: data)
        guard let claims = Claims.peek(t.access_token), claims.aud == app else { throw EqosysError.refused("not a token for \(app)") }
        if let ask {
            guard let id = t.id_token.flatMap(Claims.peek), id.nonce == ask.nonce else { throw EqosysError.refused("the id_token's nonce isn't ours") }
        }
        return EqosysSession(accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: now.addingTimeInterval(TimeInterval(t.expires_in)), claims: claims)
    }

    struct TokenReply: Decodable { let access_token: String; let id_token: String?; let refresh_token: String?; let expires_in: Int }
    struct OAuthError: Decodable { let error: String }
}

/// What a token says (Claims in @rustybuns/util/token). Read, not checked: the edge and eqosys do the checking.
public struct Claims: Codable, Equatable, Sendable {
    public let iss: String, aud: String, sub: String, email: String, name: String, source: String
    public let access: [String]
    public let exp: Double
    public let nonce: String?

    /// The middle part of a JWT, decoded.
    public static func peek(_ jwt: String) -> Claims? {
        let parts = jwt.split(separator: ".")
        guard parts.count == 3, let data = unb64url(String(parts[1])) else { return nil }
        return try? JSONDecoder().decode(Claims.self, from: data)
    }
}

/// A signed-in person on this phone: kept in the Keychain between launches.
public struct EqosysSession: Codable, Equatable, Sendable {
    public var accessToken: String
    public var refreshToken: String?
    public var expiresAt: Date
    public var claims: Claims

    /// A token with under a minute left is as good as spent: an edge may see it after a slow hop.
    public func fresh(at now: Date = Date()) -> Bool { expiresAt.timeIntervalSince(now) > 60 }
}

public enum EqosysError: Error, Equatable {
    /// The way back wasn't from a sign-in this app started.
    case notOurs
    /// The person closed the sheet.
    case cancelled
    /// The session is gone (refresh spent, revoked, or the account deleted): sign in again.
    case signInAgain
    case refused(String)
    case offline
}

public func randomBytes(_ n: Int) -> Data { Data((0..<n).map { _ in UInt8.random(in: 0...255) }) }

public func b64url(_ d: Data) -> String {
    d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

public func unb64url(_ s: String) -> Data? {
    var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    t += String(repeating: "=", count: (4 - t.count % 4) % 4)
    return Data(base64Encoded: t)
}
