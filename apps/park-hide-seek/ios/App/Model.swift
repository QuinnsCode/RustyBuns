import AuthenticationServices
import SwiftUI
import ParkKit

enum Screen: Equatable { case home, connecting, playing, trouble(Trouble) }

@MainActor
final class GameModel: ObservableObject {
    @Published var screen: Screen = .home
    @Published var view: View?
    @Published var ground: Ground?
    @Published var zone: ZoneReply?
    @Published var room = ""
    @Published var name: String { didSet { UserDefaults.standard.set(name, forKey: "phs.name") } }
    @Published var nameProblem: String?
    @Published var signedInAs: String?
    @Published var blocked: Set<String>
    @Published var mover = Mover()
    @Published var reported: Set<String> = []

    let edge = Edge.live
    private let blocks = Blocks()
    private var link: RoomLink?
    private var offline: OfflineGame?
    private var token: String?
    private var timer: Timer?
    private var seenZone = ""
    private let uid: String

    init() {
        let d = UserDefaults.standard
        name = d.string(forKey: "phs.name") ?? ""
        blocked = Blocks().ids
        // one id per install, kept; the edge hashes it so nobody sees it
        uid = d.string(forKey: "phs.uid") ?? { let u = UUID().uuidString.replacingOccurrences(of: "-", with: ""); d.set(u, forKey: "phs.uid"); return u }()
    }

    private var who: Edge.Who? {
        if let token { return .token(token) }
        guard case .ok(let n) = NameFilter.check(name) else { return nil }
        return .guest(uid: uid, name: n)
    }

    /// Checks the typed name; shows why not, here, before anything is sent.
    private func nameOk() -> Bool {
        if token != nil { return true }
        switch NameFilter.check(name) {
        case .ok: nameProblem = nil; return true
        case .empty: nameProblem = "Pick a name to play under."
        case .tooLong: nameProblem = "Names are 24 letters at most."
        case .refused: nameProblem = "That name isn't allowed. Pick another."
        }
        return false
    }

    func quickPlay() {
        guard nameOk(), let who else { return }
        screen = .connecting
        Task {
            do {
                let m = try await Net.get(edge.match(who: who), as: Net.MatchReply.self)
                join(m.room)
            } catch let f as Net.Failed { screen = .trouble(f.trouble) } catch { screen = .trouble(.offline) }
        }
    }

    /// A round against AI players that needs no network: the game runs on the phone.
    func playOffline() {
        guard nameOk(), case .ok(let n) = NameFilter.check(name) else { return }
        leave()
        guard let g = OfflineGame() else { screen = .trouble(.other("Offline play isn't in this build.")); return }
        room = "Offline"; screen = .connecting
        g.onView = { [weak self] v in self?.receive(v) }
        guard let first = g.begin(name: n) else { screen = .trouble(.other("Couldn't start the game.")); return }
        offline = g
        receive(first)
    }

    func playWithFriends() { guard nameOk() else { return }; join(Edge.newRoomCode()) }

    func open(link url: URL) {
        guard let code = Edge.room(from: url.absoluteString), nameOk() else { return }
        join(code)
    }

    func join(_ code: String) {
        guard let who else { return }
        leave()
        room = code; screen = .connecting
        let l = RoomLink(url: edge.socket(room: code, who: who))
        l.onView = { [weak self] v in self?.receive(v) }
        l.onClose = { [weak self] t in self?.screen = .trouble(t ?? .offline); self?.leave(keepScreen: true) }
        link = l
    }

    func leave(keepScreen: Bool = false) {
        timer?.invalidate(); timer = nil
        link?.close(); link = nil
        offline?.close(); offline = nil
        view = nil
        if !keepScreen { screen = .home }
    }

    func send(_ m: ClientMsg) { if let offline { offline.send(m) } else { link?.send(m) } }

    private func receive(_ v: View) {
        view = v
        if screen != .playing { screen = .playing; startTicks() }
        if v.zone != seenZone { seenZone = v.zone; Task { await loadGround(v.zone) } }
        if let you = v.round?.you {
            mover.role = you.role
            // keep our own steps; take the server's word only when it moved us (a catch, a push-out)
            if hypot(you.x - mover.x, you.y - mover.y) > 3 { mover.x = you.x; mover.y = you.y }
        }
    }

    private func loadGround(_ id: String) async {
        let reply = offline?.engine.zone(id)
        guard let z = reply ?? (offline == nil ? try? await Net.get(edge.zone(id), as: ZoneReply.self) : nil), let g = Ground(z) else { return }
        zone = z; ground = g
        if view?.round?.you == nil { mover.x = z.station.x; mover.y = z.station.y; mover.yaw = z.station.yaw }
    }

    private var stick = (x: 0.0, y: 0.0)
    func setStick(_ s: (x: Double, y: Double)) { stick = s }

    private func startTicks() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let v = self.view, v.round?.you?.caughtAt == nil else { return }
                let g = self.ground
                self.mover.step(stick: self.stick, dt: 0.05, inside: { x, y in g?.inside(x, y, margin: 0.5) ?? true })
                self.send(self.mover.message)
            }
        }
    }

    // MARK: people met in quick play (guideline 1.2)

    func report(_ p: PlayerView, reason: String) {
        reported.insert(p.id)
        guard let who else { return }
        Task { await Net.report(edge.report(room: room, player: p.id, reason: reason, who: who)) }
    }

    func block(_ p: PlayerView) { blocks.block(p.id); blocked = blocks.ids }
    func unblock(_ id: String) { blocks.unblock(id); blocked = blocks.ids }
    func shown(_ p: PlayerView) -> String { blocked.contains(p.id) ? "Blocked player" : p.name }

    // MARK: eqosys

    private var pkce: PkceLogin?
    private let anchor = PresentationAnchor()

    /// Sign in through eqosys. It sends the player back to the game's web address with the code, which the
    /// session catches on https (iOS 17.4 and later; older phones play with a name).
    func signIn() {
        guard #available(iOS 17.4, *) else { nameProblem = "Sign in needs iOS 17.4. Play with a name instead."; return }
        let p = PkceLogin(); pkce = p
        let host = edge.base.host ?? ""
        let s = ASWebAuthenticationSession(url: p.loginURL(returnTo: edge.base.appendingPathComponent("")), callback: .https(host: host, path: "/")) { [weak self] back, _ in
            guard let self, let back else { return }
            Task { @MainActor in await self.finishSignIn(p, back) }
        }
        s.presentationContextProvider = anchor
        s.start()
    }

    private func finishSignIn(_ p: PkceLogin, _ back: URL) async {
        guard let code = p.code(from: back), let (data, _) = try? await URLSession.shared.data(for: p.exchangeRequest(code: code)),
              let got = try? JSONDecoder().decode(Exchange.self, from: data) else { nameProblem = "Sign in didn't go through. Try again."; return }
        guard let t = got.token else { nameProblem = "Sign in isn't switched on yet. Play with a name for now."; return }
        token = t; signedInAs = got.user.name
    }

    func signOut() { token = nil; signedInAs = nil }
}

final class PresentationAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }
}
