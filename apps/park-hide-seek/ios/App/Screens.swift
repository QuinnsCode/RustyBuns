import SwiftUI
import ParkKit

// The park-poster palette: flat colours, nothing glossy.
extension Color {
    static let paper = Color(red: 0.96, green: 0.92, blue: 0.82)
    static let ink = Color(red: 0.13, green: 0.17, blue: 0.14)
    static let pine = Color(red: 0.18, green: 0.42, blue: 0.27)
    static let sun = Color(red: 0.89, green: 0.55, blue: 0.20)
}

struct RootView: View {
    @EnvironmentObject var game: GameModel
    @StateObject private var net = Reachability()

    var body: some View {
        ZStack {
            Color.ink.ignoresSafeArea()
            if !net.online, game.screen != .playing, game.screen != .connecting { OfflineView() }
            else {
                switch game.screen {
                case .home: HomeView()
                case .connecting: ProgressView("Finding a room").tint(.paper).foregroundColor(.paper)
                case .playing: PlayView()
                case .trouble(let t): TroubleView(trouble: t)
                }
            }
        }
    }
}

struct HomeView: View {
    @EnvironmentObject var game: GameModel
    @State private var code = ""
    @State private var confirmDelete = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Text("Park Hide & Seek").font(.system(size: 40, weight: .heavy, design: .rounded)).foregroundColor(.paper).padding(.top, 48)
                Text("Hide from the rangers in a real national park.").foregroundColor(.paper.opacity(0.8))

                if let who = game.signedInAs {
                    HStack { Text("Signed in as \(who)").foregroundColor(.paper); Spacer(); Button("Sign out") { game.signOut() }.tint(.sun) }
                    Button("Delete account", role: .destructive) { confirmDelete = true }.font(.footnote)
                        .confirmationDialog("Delete your eqosys account? Every Q app you use loses it, with your friends list.", isPresented: $confirmDelete, titleVisibility: .visible) {
                            Button("Delete account", role: .destructive) { game.deleteAccount() }
                        }
                } else {
                    TextField("Your name", text: $game.name)
                        .textFieldStyle(.roundedBorder).textInputAutocapitalization(.words).autocorrectionDisabled()
                    Button { game.signIn() } label: { Label("Sign in with eqosys", systemImage: "person.crop.circle").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered).tint(.paper)
                }
                if let p = game.nameProblem { Text(p).font(.footnote).foregroundColor(.sun) }

                Button { game.playOffline() } label: { Label("Play offline against AI", systemImage: "airplane").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered).tint(.paper)
                Button { game.quickPlay() } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent).tint(.sun).controlSize(.large)

                Divider().background(Color.paper.opacity(0.3))
                Text("Play with friends").font(.headline).foregroundColor(.paper)
                HStack {
                    TextField("Room code", text: $code).textFieldStyle(.roundedBorder).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    Button("Join") { if let r = Edge.room(from: code) { game.join(r) } }.buttonStyle(.bordered).tint(.paper)
                        .disabled(Edge.room(from: code) == nil)
                }
                Button { game.playWithFriends() } label: { Label("Start a room and invite", systemImage: "person.2.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered).tint(.paper)
            }
            .padding(24)
            .frame(maxWidth: 520)           // a phone fills the width; on an iPad the column stays readable
            .frame(maxWidth: .infinity)
        }
    }
}

struct OfflineView: View {
    @EnvironmentObject var game: GameModel
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.slash").font(.system(size: 48))
            Text("You're offline").font(.title2.bold())
            Text("Online games start again as soon as the phone is back on the internet. You can still play against AI.").multilineTextAlignment(.center)
            TextField("Your name", text: $game.name).textFieldStyle(.roundedBorder).textInputAutocapitalization(.words).autocorrectionDisabled().frame(maxWidth: 320)
            if let p = game.nameProblem { Text(p).font(.footnote).foregroundColor(.sun) }
            Button { game.playOffline() } label: { Label("Play offline against AI", systemImage: "airplane") }
                .buttonStyle(.borderedProminent).tint(.sun)
        }.foregroundColor(.paper).padding(32)
    }
}

struct TroubleView: View {
    @EnvironmentObject var game: GameModel
    let trouble: Trouble

    var body: some View {
        VStack(spacing: 16) {
            switch trouble {
            case .updateRequired:
                Image(systemName: "arrow.down.app").font(.system(size: 48))
                Text("Update to keep playing").font(.title2.bold())
                Text("This version is too old to join games. Get the newest one from the App Store.").multilineTextAlignment(.center)
                Link("Open the App Store", destination: Edge.store).buttonStyle(.borderedProminent).tint(.sun)
            case .full:
                Text("That room is full").font(.title2.bold()); Text("Rooms hold 8 players. Try Play for another one.")
            case .signInAgain:
                Text("Sign in again").font(.title2.bold()); Text("Your sign-in ran out.")
            case .offline:
                Text("Couldn't reach the game").font(.title2.bold()); Text("Check the connection and try again.")
            case .other(let m):
                Text("Couldn't join").font(.title2.bold()); Text(m)
            }
            if trouble != .updateRequired { Button("Back") { game.screen = .home }.buttonStyle(.bordered).tint(.paper) }
        }.foregroundColor(.paper).padding(32)
    }
}

/// The match: the world, the controls, and a bar with the phase and the people.
struct PlayView: View {
    @EnvironmentObject var game: GameModel
    @State private var showPeople = false

    var body: some View {
        ZStack {
            WorldView().ignoresSafeArea()
            if let v = game.view {
                VStack {
                    HStack {
                        Text(banner(v)).font(.headline).padding(8).background(.black.opacity(0.45)).cornerRadius(8)
                        Spacer()
                        if !v.strangers.isEmpty { Button { showPeople = true } label: { Image(systemName: "person.2") }.buttonStyle(.bordered).tint(.paper) }
                        Button { game.leave() } label: { Image(systemName: "xmark") }.buttonStyle(.bordered).tint(.paper)
                    }.foregroundColor(.paper).padding(.horizontal)
                    Spacer()
                    if v.phase == .lobby { LobbyBar(v: v) } else { Controls() }
                }
                if v.phase == .drop, v.round?.you?.role == .camper, let g = game.ground, let z = game.zone {
                    DropMap(ground: g, station: z.station, drop: v.round?.you?.drop).padding(.top, 56)
                }
            }
        }
        .sheet(isPresented: $showPeople) { PeopleSheet() }
    }

    private func banner(_ v: View) -> String {
        let left = max(0, Int((v.endsAt - v.now) / 1000))
        switch v.phase {
        case .lobby: return "Room \(game.room)"
        case .drop: return "Pick your drop · \(left)s"
        case .hide: return "Hide · \(left)s"
        case .hunt: return (v.round?.you?.role == .ranger ? "Find them · " : "Stay hidden · ") + "\(left)s"
        case .results: return "Round over"
        case .over: return "Game over"
        }
    }
}

struct LobbyBar: View {
    @EnvironmentObject var game: GameModel
    let v: View
    var body: some View {
        VStack(spacing: 8) {
            Text("\(v.players.filter { $0.online }.count) in the room").foregroundColor(.paper)
            HStack {
                ShareLink(item: game.edge.invite(room: game.room)) { Label("Invite", systemImage: "square.and.arrow.up") }.buttonStyle(.bordered).tint(.paper)
                Button("Add AI") { game.send(.bot(.normal)) }.buttonStyle(.bordered).tint(.paper)
                if v.hostId == v.me { Button("Start") { game.send(.start) }.buttonStyle(.borderedProminent).tint(.sun) }
            }
        }.padding().background(.black.opacity(0.45)).cornerRadius(12).padding()
    }
}

/// Everyone met in this match except you and the AI: where Report and Block live.
struct PeopleSheet: View {
    @EnvironmentObject var game: GameModel
    @Environment(\.dismiss) private var dismiss
    @State private var reporting: PlayerView?

    var body: some View {
        NavigationView {
            List(game.view?.strangers ?? [], id: \.id) { p in
                HStack {
                    Text(game.shown(p))
                    Spacer()
                    if game.reported.contains(p.id) { Text("Reported").foregroundColor(.secondary) }
                    else { Button("Report") { reporting = p }.buttonStyle(.bordered) }
                    if game.blocked.contains(p.id) { Button("Unblock") { game.unblock(p.id) }.buttonStyle(.bordered) }
                    else { Button("Block", role: .destructive) { game.block(p) }.buttonStyle(.bordered) }
                }
            }
            .navigationTitle("People here")
            .toolbar { Button("Done") { dismiss() } }
            .confirmationDialog("Report \(reporting.map(game.shown) ?? "")", isPresented: Binding(get: { reporting != nil }, set: { if !$0 { reporting = nil } }), titleVisibility: .visible) {
                ForEach(["name", "cheating", "harassment", "other"], id: \.self) { r in
                    Button(r.capitalized) { if let p = reporting { game.report(p, reason: r) } }
                }
            }
        }
    }
}
