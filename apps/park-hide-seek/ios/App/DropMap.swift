import SwiftUI
import ParkKit

/// The drop phase for a camper: the zone from above, tap where to land. Red ground is where the room won't take a drop.
struct DropMap: View {
    @EnvironmentObject var game: GameModel
    let ground: Ground
    let station: ZoneReply.Station
    let drop: [Double]?
    @State private var image: UIImage?
    @State private var refused = false

    var body: some View {
        VStack(spacing: 12) {
            Text(refused ? "Not there: stay inside the zone, off the red, away from the cabin."
                 : drop == nil ? "Tap the map to choose where you drop in. If you don't, you land somewhere at random."
                 : "Dropping at the flag. Tap again to move it.")
                .font(.subheadline).multilineTextAlignment(.center).foregroundColor(refused ? .sun : .paper)
            GeometryReader { geo in
                let side = min(geo.size.width, geo.size.height)
                ZStack(alignment: .topLeading) {
                    if let image { Image(uiImage: image).resizable().interpolation(.medium) } else { Color.pine }
                    marker(system: "house.fill", at: (station.x, station.y), side: side, color: .paper)
                    if let d = drop, d.count == 2 { marker(system: "flag.fill", at: (d[0], d[1]), side: side, color: .sun) }
                }
                .frame(width: side, height: side)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onEnded { g in
                    let p = Self.world(g.location, side: side, radius: ground.radius)
                    refused = !ground.canDrop(p.x, p.y, station: station)
                    if !refused { game.send(.drop(x: p.x, y: p.y)) }
                })
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding()
        .background(Color.ink.opacity(0.92).ignoresSafeArea())
        .task { image = Self.render(ground, station: station) }
    }

    private func marker(system: String, at p: (Double, Double), side: CGFloat, color: Color) -> some View {
        let q = Self.point(p.0, p.1, side: side, radius: ground.radius)
        return Image(systemName: system).foregroundColor(color).shadow(radius: 2).position(q)
    }

    /// Map point (x east, y north in game metres) to a spot in the square view, and back.
    static func point(_ x: Double, _ y: Double, side: CGFloat, radius: Double) -> CGPoint {
        CGPoint(x: (x + radius) / (2 * radius) * side, y: (1 - (y + radius) / (2 * radius)) * side)
    }
    static func world(_ p: CGPoint, side: CGFloat, radius: Double) -> (x: Double, y: Double) {
        (Double(p.x / side) * 2 * radius - radius, (1 - Double(p.y / side)) * 2 * radius - radius)
    }

    /// One pixel per height sample, north up: green and tan shaded by height, grey outside the circle, red where no drop.
    static func render(_ g: Ground, station: ZoneReply.Station) -> UIImage? {
        let n = g.n
        let lo = g.h.min() ?? 0, hi = max(g.h.max() ?? 1, lo + 1)
        var px = [UInt8](repeating: 255, count: n * n * 4)
        for r in 0..<n {
            for c in 0..<n {
                let x = -g.radius + Double(c) * g.step, y = -g.radius + Double(r) * g.step
                let t = Double((g.h[r * n + c] - lo) / (hi - lo))
                var rgb = g.inside(x, y) ? (46 + 120 * t, 107 + 60 * t, 69 + 40 * t) : (40.0, 44, 41)
                if g.inside(x, y), !g.canDrop(x, y, station: station) { rgb = (rgb.0 * 0.4 + 140, rgb.1 * 0.4, rgb.2 * 0.4 + 10) }
                let i = ((n - 1 - r) * n + c) * 4
                px[i] = UInt8(min(255, rgb.0)); px[i + 1] = UInt8(min(255, rgb.1)); px[i + 2] = UInt8(min(255, rgb.2))
            }
        }
        guard let ctx = CGContext(data: &px, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue), let img = ctx.makeImage() else { return nil }
        return UIImage(cgImage: img)
    }
}
