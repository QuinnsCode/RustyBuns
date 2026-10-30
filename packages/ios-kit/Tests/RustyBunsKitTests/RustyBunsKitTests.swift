import XCTest
@testable import RustyBunsKit

/// A pretend eqosys: answers the token, revoke and delete requests the way apps/eqosys/src/oauth.ts does.
final class FakeEqosys: @unchecked Sendable {
    var refreshes = 0
    var live: Set<String> = []
    var revoked: [String] = []
    var nonce = ""
    let lock = NSLock()

    static func jwt(_ claims: [String: Any]) -> String {
        let part = { (o: [String: Any]) in b64url(try! JSONSerialization.data(withJSONObject: o)) }
        return "\(part(["alg": "ES256", "kid": "k"])).\(part(claims)).sig"
    }
    func claims(_ nonce: String? = nil) -> [String: Any] {
        var c: [String: Any] = ["iss": "https://eqosys.qntbr.com", "aud": "park-hide-seek", "sub": "u1", "email": "ada@example.com", "name": "Ada",
                                "source": "park-hide-seek", "access": ["play"], "iat": 0, "exp": 9e9]
        if let nonce { c["nonce"] = nonce }
        return c
    }
    func tokens() -> Data {
        let r = "eqr_\(UUID().uuidString)"; live.insert(r)
        return try! JSONSerialization.data(withJSONObject: ["access_token": Self.jwt(claims()), "id_token": Self.jwt(claims(nonce)), "token_type": "Bearer",
                                                            "expires_in": 600, "refresh_token": r])
    }
    lazy var send: Send = { [unowned self] r in
        self.lock.lock(); defer { self.lock.unlock() }
        let form = Dictionary(uniqueKeysWithValues: (URLComponents(string: "?" + String(decoding: r.httpBody ?? Data(), as: UTF8.self))?.queryItems ?? [])
            .map { ($0.name, $0.value ?? "") })
        switch r.url!.path {
        case "/oauth/token" where form["grant_type"] == "refresh_token":
            self.refreshes += 1
            guard let t = form["refresh_token"], self.live.remove(t) != nil else { return (Data(#"{"error":"invalid_grant"}"#.utf8), 400) }
            return (self.tokens(), 200)
        case "/oauth/token": return (self.tokens(), 200)
        case "/oauth/revoke": self.revoked.append(form["token"] ?? ""); self.live.remove(form["token"] ?? ""); return (Data("{}".utf8), 200)
        case "/api/account/delete": self.live.removeAll(); return (Data(#"{"ok":true}"#.utf8), 200)
        default: return (Data(), 404)
        }
    }
}

final class RustyBunsKitTests: XCTestCase {
    let client = EqosysClient(app: "park-hide-seek", redirect: URL(string: "com.quinnscode.parkhideseek:/eqosys")!)

    func testTheAuthorizeAskIsOpenIDWithPkce() throws {
        let ask = EqosysClient.Ask(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", state: "st", nonce: "nn")   // RFC 7636's own example
        XCTAssertEqual(ask.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let q = Dictionary(uniqueKeysWithValues: URLComponents(url: client.authorizeURL(ask), resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
        XCTAssertEqual(q["client_id"], "park-hide-seek")
        XCTAssertEqual(q["redirect_uri"], "com.quinnscode.parkhideseek:/eqosys")
        XCTAssertEqual(q["code_challenge_method"], "S256")
        XCTAssertEqual(q["nonce"], "nn")
        XCTAssertTrue(q["scope"]!.contains("offline_access"))
        XCTAssertEqual(client.scheme, "com.quinnscode.parkhideseek")
    }

    func testTheWayBackIsOnlyTradedWhenItIsOurs() throws {
        let ask = EqosysClient.Ask(verifier: String(repeating: "v", count: 43), state: "st", nonce: "nn")
        XCTAssertEqual(try client.code(from: URL(string: "com.quinnscode.parkhideseek:/eqosys?code=eq_1&state=st")!, ask), "eq_1")
        for (url, want) in [("com.quinnscode.parkhideseek:/eqosys?code=eq_1&state=other", EqosysError.notOurs),
                            ("com.quinnscode.parkhideseek:/eqosys?error=invalid_request&state=st", .refused("invalid_request"))] {
            XCTAssertThrowsError(try client.code(from: URL(string: url)!, ask)) { XCTAssertEqual($0 as? EqosysError, want) }
        }
        // An id_token carrying someone else's nonce is refused.
        let fake = FakeEqosys(); fake.nonce = "not-ours"
        XCTAssertThrowsError(try client.session(from: fake.tokens(), ask: ask))
        fake.nonce = "nn"
        XCTAssertEqual(try client.session(from: fake.tokens(), ask: ask).claims.name, "Ada")
    }

    func testSignedInStaysSignedInRefreshesAndSignsOut() async throws {
        let fake = FakeEqosys()
        let store = MemoryStore()
        let auth = EqosysAuth(client: client, store: store, send: fake.send)
        let who = try await auth.signIn { url, _ in
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
            fake.nonce = q.first { $0.name == "nonce" }!.value!
            return URL(string: "com.quinnscode.parkhideseek:/eqosys?code=eq_1&state=\(q.first { $0.name == "state" }!.value!)")!
        }
        XCTAssertEqual(who.email, "ada@example.com")
        let t0 = try await auth.token()
        XCTAssertNotNil(t0)
        XCTAssertEqual(fake.refreshes, 0)

        // The next launch reads the Keychain; eleven minutes later the token is refreshed, once, behind the scenes.
        let later = EqosysAuth(client: client, store: store, send: fake.send)
        let soon = Date().addingTimeInterval(11 * 60)
        async let a = later.token(now: soon)
        async let b = later.token(now: soon)
        let (ta, tb) = try await (a, b)
        XCTAssertNotNil(ta); XCTAssertEqual(ta, tb)
        XCTAssertEqual(fake.refreshes, 1)

        // Signing out throws the refresh token away at eqosys and here.
        await later.signOut()
        XCTAssertEqual(fake.revoked.count, 1)
        XCTAssertNil(store.load())
        let gone = try await later.token()
        XCTAssertNil(gone)
    }

    func testARevokedSessionAsksToSignInAgain() async throws {
        let fake = FakeEqosys()
        let stale = EqosysSession(accessToken: FakeEqosys.jwt(fake.claims()), refreshToken: "eqr_spent", expiresAt: Date(timeIntervalSince1970: 0),
                                  claims: Claims.peek(FakeEqosys.jwt(fake.claims()))!)
        let store = MemoryStore(stale)
        let auth = EqosysAuth(client: client, store: store, send: fake.send)
        do { _ = try await auth.token(); XCTFail("should ask to sign in again") } catch { XCTAssertEqual(error as? EqosysError, .signInAgain) }
        XCTAssertNil(store.load())
    }

    func testTheEdgeHandshake() {
        let pv = EdgeProtocol(3)
        XCTAssertEqual(pv.stamp(URL(string: "wss://x.dev/ws?room=PIKA&pv=1")!).absoluteString, "wss://x.dev/ws?room=PIKA&pv=3")
        XCTAssertEqual(Trouble.from(status: 426), .updateRequired)
        XCTAssertEqual(Trouble.from(closeCode: 4426), .updateRequired)
        XCTAssertNil(Trouble.from(closeCode: 1000))
        let up = try? JSONDecoder().decode(EdgeProtocol.Update.self, from: Data(#"{"update":3,"store":"https://apps.apple.com/app/id1"}"#.utf8))
        XCTAssertEqual(up?.storeURL?.host, "apps.apple.com")
    }

    func testTheHubsFramesAndOps() {
        let frame = #"{"t":"state","me":{"id":"u1","name":"Ada"},"friends":[{"id":"u2","name":"Bo","since":1,"presence":[{"app":"park-hide-seek","doing":"hiding"}]},{"id":"u3","name":"Cy","since":1,"presence":[]}],"incoming":[{"id":"u4","name":"Di","at":1}],"outgoing":[],"notes":[]}"#
        let s = HubState.decode(frame)
        XCTAssertEqual(s?.friends.filter(\.on).map(\.name), ["Bo"])
        XCTAssertEqual(s?.incoming.first?.name, "Di")
        XCTAssertNil(HubState.decode(#"{"t":"error","error":"nope"}"#))
        XCTAssertEqual(HubOp.status("hiding in the hedge").json(), #"{"doing":"hiding in the hedge","op":"status"}"#)
        XCTAssertEqual(client.hubURL(token: "a.b.c").absoluteString, "wss://eqosys.qntbr.com/hub?token=a.b.c")
    }
}
