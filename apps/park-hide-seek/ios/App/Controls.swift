import SwiftUI
import GameController
import ParkKit

/// Move stick on the left, look on the right half, buttons to call out and turn into a prop. A game controller
/// does the same: left stick moves, right stick looks, A calls out, X turns into the prop, B crouches, trigger runs.
struct Controls: View {
    @EnvironmentObject var game: GameModel
    @State private var knob = CGSize.zero
    @State private var lastDrag: CGPoint?
    private let radius: CGFloat = 55
    private let pad = ControllerInput()

    var body: some View {
        let role = game.view?.round?.you?.role
        HStack(alignment: .bottom) {
            ZStack {
                Circle().fill(.white.opacity(0.15)).frame(width: radius * 2, height: radius * 2)
                Circle().fill(.white.opacity(0.5)).frame(width: 50, height: 50).offset(knob)
            }
            .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                let d = CGSize(width: g.translation.width, height: g.translation.height)
                let len = max(1, hypot(d.width, d.height) / radius)
                knob = CGSize(width: d.width / len, height: d.height / len)
                game.setStick((x: Double(knob.width / radius), y: Double(-knob.height / radius)))
            }.onEnded { _ in knob = .zero; game.setStick((0, 0)) })

            // dragging anywhere in the middle looks around
            Color.clear.contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                    if let l = lastDrag { game.mover.look(dx: Double(g.location.x - l.x) * 0.006, dy: Double(-(g.location.y - l.y)) * 0.006) }
                    lastDrag = g.location
                }.onEnded { _ in lastDrag = nil })

            VStack(spacing: 10) {
                if role == .camper, game.view?.round != nil {
                    Button { game.send(.disguise) } label: { Label("Prop", systemImage: "leaf.fill") }
                }
                Button { game.send(.call) } label: { Label("Call out", systemImage: "megaphone.fill") }
                Button { game.mover.run.toggle() } label: { Image(systemName: "figure.run") }
                Button { game.mover.crouch.toggle() } label: { Image(systemName: "figure.stand") }
            }.buttonStyle(.borderedProminent).tint(.sun).padding(.bottom, 8)
        }
        .frame(height: 150).padding(.horizontal, 24).padding(.bottom, 8)
        .onAppear { pad.attach(game) }
    }
}

/// Game controller support through GCController; it drives the same model the touch controls do.
final class ControllerInput {
    private weak var game: GameModel?

    func attach(_ g: GameModel) {
        game = g
        NotificationCenter.default.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) { [weak self] n in
            if let c = n.object as? GCController { self?.bind(c) }
        }
        GCController.controllers().forEach(bind)
    }

    private func bind(_ c: GCController) {
        guard let pad = c.extendedGamepad else { return }
        pad.leftThumbstick.valueChangedHandler = { [weak self] _, x, y in Task { @MainActor in self?.game?.setStick((Double(x), Double(y))) } }
        pad.rightThumbstick.valueChangedHandler = { [weak self] _, x, y in
            Task { @MainActor in self?.game?.mover.look(dx: Double(x) * 0.05, dy: Double(y) * 0.03) }
        }
        pad.buttonA.pressedChangedHandler = { [weak self] _, _, down in if down { Task { @MainActor in self?.game?.send(.call) } } }
        pad.buttonX.pressedChangedHandler = { [weak self] _, _, down in if down { Task { @MainActor in self?.game?.send(.disguise) } } }
        pad.buttonB.pressedChangedHandler = { [weak self] _, _, down in if down { Task { @MainActor in self?.game?.mover.crouch.toggle() } } }
        pad.rightTrigger.valueChangedHandler = { [weak self] _, v, _ in Task { @MainActor in self?.game?.mover.run = v > 0.3 } }
    }
}
