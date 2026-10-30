import Foundation

/// Sends a request and answers its body and status. URLSession on a phone; a test hands in its own.
public typealias Send = @Sendable (URLRequest) async throws -> (Data, Int)

public let urlSessionSend: Send = { r in
    let (data, res) = try await URLSession.shared.data(for: r)
    return (data, (res as? HTTPURLResponse)?.statusCode ?? 0)
}

/// Shows eqosys's sign-in for `url` and answers the URL it sends the person back to on `scheme`.
/// `EqosysSignIn` on iOS; a test plays the person.
public typealias Present = @MainActor (_ url: URL, _ scheme: String) async throws -> URL

/// The signed-in person for one app, kept between launches: sign in once, and `token()` hands out a fresh access
/// token for every edge call, refreshing behind the scenes. Every Q app on the phone shares eqosys's browser
/// cookie, so a second app's sign-in is one tap on Continue.
public actor EqosysAuth {
    public let client: EqosysClient
    private let store: TokenStore
    private let send: Send
    private var current: EqosysSession?
    private var refreshing: Task<EqosysSession, Error>?

    public init(client: EqosysClient, store: TokenStore? = nil, send: @escaping Send = urlSessionSend) {
        self.client = client
        self.store = store ?? KeychainStore(account: "eqosys.\(client.app)")
        self.send = send
        current = self.store.load()
    }

    /// Who is signed in, without asking the network: nil when nobody is.
    public var who: Claims? { current?.claims }

    /// Sign in through eqosys's page, then keep the session.
    @discardableResult
    public func signIn(present: Present) async throws -> Claims {
        let ask = EqosysClient.Ask()
        let back = try await present(client.authorizeURL(ask), client.scheme)
        let code = try client.code(from: back, ask)
        let s = try await trade(client.tokenRequest(code: code, ask), ask: ask)
        keep(s)
        return s.claims
    }

    /// A good access token, refreshed when it is close to expiring; nil when nobody is signed in.
    /// Throws `.signInAgain` when the refresh is refused (the session was revoked or the account deleted).
    public func token(now: Date = Date()) async throws -> String? {
        guard let s = current else { return nil }
        if s.fresh(at: now) { return s.accessToken }
        guard let refresh = s.refreshToken else { forget(); throw EqosysError.signInAgain }
        // Two calls at once share one refresh: a refresh token is good once.
        let task = refreshing ?? Task { [client, send] in
            let (data, _) = try await send(client.refreshRequest(refresh))
            return try client.session(from: data, ask: nil)
        }
        refreshing = task
        defer { refreshing = nil }
        do { let next = try await task.value; keep(next); return next.accessToken }
        catch EqosysError.signInAgain { forget(); throw EqosysError.signInAgain }
    }

    /// Sign out here: the refresh token is thrown away at eqosys too, so it can't come back.
    public func signOut() async {
        if let r = current?.refreshToken { _ = try? await send(client.revokeRequest(r)) }
        forget()
    }

    /// Delete the account and everything eqosys holds (App Store 5.1.1(v)). True when eqosys said it went.
    public func deleteAccount() async throws -> Bool {
        guard let t = try await token() else { return false }
        let (_, status) = try await send(client.deleteRequest(token: t))
        if status == 200 { forget() }
        return status == 200
    }

    private func trade(_ r: URLRequest, ask: EqosysClient.Ask?) async throws -> EqosysSession {
        let data: Data
        do { (data, _) = try await send(r) } catch { throw EqosysError.offline }
        return try client.session(from: data, ask: ask)
    }

    private func keep(_ s: EqosysSession) { current = s; store.save(s) }
    private func forget() { current = nil; store.save(nil) }
}
