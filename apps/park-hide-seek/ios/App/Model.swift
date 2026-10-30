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
    /// The eqosys account, kept in the Keychain and refreshed behind the scenes (RustyBunsKit).
    private let auth = EqosysAuth(client: Edge.eqosys)
    private var timer: Timer?
    private var seenZone = ""
    private let uid: String

    init() {
        let d = UserDefaults.standard
        name = d.string(forKey: "phs.name") ?? ""
        blocked = Blocks().ids
        // one id per install, kept; the edge hashes it so nobody sees it
        uid = d.string(forKey: "phs.uid") ?? { let u = UUID().uuidString.replacingOccurrences(of: "-", with: ""); d.set(u, forKey: "phs.uid"); return u }()
        Task { signedInAs = await auth.who?.name }
    }

    /// Who the player is on the wire: a fresh eqosys token when signed in, else the id this install made and the name typed.
    private func who() async -> Edge.Who? {
        if signedInAs != nil {
            do { if let t = try await auth.token() { return .token(t) } }
            catch EqosysError.signInAgain { signedInAs = nil; nameProblem = "You were signed out. Sign in again, or play with a name."; return nil }
            catch { screen = .trouble(.offline); return nil }
        }
        guard case .ok(let n) = NameFilter.check(name) else { return nil }
        return .guest(uid: uid, name: n)
    }

    /// Checks the typed name; shows why not, here, before anything is sent.
    private func nameOk() -> Bool {
        if signedInAs != nil { return true }
        switch NameFilter.check(name) {
        case .ok: nameProblem = nil; return true
        case .empty: nameProblem = "Pick a name to play under."
        case .tooLong: nameProblem = "Names are 24 letters at most."
        case .refused: nameProblem = "That name isn't allowed. Pick another."
        }
        return false
    }

    func quickPlay() {
        guard nameOk() else { return }
        screen = .connecting
        Task {
            guard let who = await who() else { if screen == .connecting { screen = .home }; return }
            do {
                let m = try await Net.get(edge.match(who: who), as: Net.MatchReply.self)
                join(m.room)
            } catch let f as Net.Failed { screen = .trouble(f.trouble) } catch { screen = .trouble(.offline) }
        }
    }

    func playWithFriends() { guard nameOk() else { return }; join(Edge.newRoomCode()) }

    func open(link url: URL) {
        guard let code = Edge.room(from: url.absoluteString), nameOk() else { return }
        join(code)
    }

    func join(_ code: String) {
        Task {
            guard let who = await who() else { return }
            leave()
            room = code; screen = .connecting
            let l = RoomLink(url: edge.socket(room: code, who: who))
            l.onView = { [weak self] v in self?.receive(v) }
            l.onClose = { [weak self] t in self?.screen = .trouble(t ?? .offline); self?.leave(keepScreen: true) }
            link = l
        }
    }

    func leave(keepScreen: Bool = false) {
        timer?.invalidate(); timer = nil
        link?.close(); link = nil
        view = nil
        if !keepScreen { screen = .home }
    }

    func send(_ m: ClientMsg) { link?.send(m) }

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
        guard let z = try? await Net.get(edge.zone(id), as: ZoneReply.self), let g = Ground(z) else { return }
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
        Task { if let who = await who() { await Net.report(edge.report(room: room, player: p.id, reason: reason, who: who)) } }
    }

    func block(_ p: PlayerView) { blocks.block(p.id); blocked = blocks.ids }
    func unblock(_ id: String) { blocks.unblock(id); blocked = blocks.ids }
    func shown(_ p: PlayerView) -> String { blocked.contains(p.id) ? "Blocked player" : p.name }

    // MARK: eqosys

    /// Sign in through eqosys's sheet, back on the game's own scheme (any iOS 16 phone). The account stays signed in
    /// between launches; another Q app on the phone already signed in makes it one tap on Continue.
    func signIn() {
        Task {
            do { signedInAs = try await auth.signIn(present: EqosysSignIn.present).name; nameProblem = nil }
            catch EqosysError.cancelled {}
            catch EqosysError.refused("temporarily_unavailable") { nameProblem = "Sign in isn't switched on yet. Play with a name for now." }
            catch { nameProblem = "Sign in didn't go through. Try again." }
        }
    }

    func signOut() { Task { await auth.signOut(); signedInAs = nil } }

    /// Delete the eqosys account and everything it holds (App Store 5.1.1(v)).
    func deleteAccount() {
        Task {
            if (try? await auth.deleteAccount()) == true { signedInAs = nil; nameProblem = "Your account is deleted." }
            else { nameProblem = "Couldn't delete the account right now. Try again." }
        }
    }
}
