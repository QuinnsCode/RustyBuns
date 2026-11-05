import SwiftUI
import ParkKit

@main
struct ParkApp: App {
    @StateObject private var game = GameModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(game)
                .preferredColorScheme(.dark)
                // https://<host>/?room=PIKA, a universal link from Play with friends
                .onOpenURL { game.open(link: $0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { if let url = $0.webpageURL { game.open(link: url) } }
                // `simctl launch <device> com.quinnscode.parkhideseek -playOffline` starts a round with no taps (scripts/ios-shots.ts)
                .task { if CommandLine.arguments.contains("-playOffline") { if game.name.isEmpty { game.name = "Ranger" }; game.playOffline() } }
        }
    }
}
