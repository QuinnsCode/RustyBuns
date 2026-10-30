import RealityKit
import SwiftUI
import UIKit
import ParkKit

/// Draws the zone and the people the edge says this player can see. No rules live here: where everyone stands
/// and what they may know comes from the view; the ground comes from /api/zone.
struct WorldView: UIViewRepresentable {
    @EnvironmentObject var game: GameModel

    func makeCoordinator() -> Scene3D { Scene3D() }

    func makeUIView(context: Context) -> ARView {
        let v = ARView(frame: .zero, cameraMode: .nonAR, automaticallyConfigureSession: false)
        context.coordinator.attach(v)
        return v
    }

    func updateUIView(_ v: ARView, context: Context) {
        context.coordinator.update(game: game)
    }
}

/// The park-poster look: a gradient sky, flat colours, haze that thickens towards the rim.
@MainActor
final class Scene3D {
    private let anchor = AnchorEntity(world: .zero)
    private let camera = PerspectiveCamera()
    private let sky = ModelEntity()
    private let ground = Entity(), props = Entity(), people = Entity()
    private var builtFor = ""
    private var actors: [String: ModelEntity] = [:]
    private var tod: TimeOfDay = .day

    func attach(_ view: ARView) {
        view.environment.background = .color(Palette.sky(.day).horizon)
        camera.camera.fieldOfViewInDegrees = 70
        camera.camera.far = 3000
        anchor.addChild(camera); anchor.addChild(sky); anchor.addChild(ground); anchor.addChild(props); anchor.addChild(people)
        view.scene.addAnchor(anchor)
        setSky(.day)
    }

    func update(game: GameModel) {
        guard let v = game.view else { return }
        let t = v.round?.sky.tod ?? .day
        if t != tod { setSky(t) }
        if let z = game.zone, let g = game.ground, builtFor != z.id { build(z, g, tod) }
        guard let g = game.ground else { return }

        // eye height 1.6 standing, 0.9 crouched (EYE in src/hunt/sim.ts)
        let m = game.mover
        let eye = Float(g.height(m.x, m.y)) + (m.crouch ? 0.9 : 1.6)
        camera.position = [Float(m.x), eye, Float(-m.y)]
        camera.orientation = simd_quatf(angle: Float(-m.yaw), axis: [0, 1, 0]) * simd_quatf(angle: Float(m.pitch), axis: [1, 0, 0])
        sky.position = camera.position

        var seen = Set<String>()
        for a in v.round?.others ?? [] {
            seen.insert(a.id)
            let e = actors[a.id] ?? person(a)
            actors[a.id] = e
            let h = Float(g.height(a.x, a.y))
            e.position = [Float(a.x), h + (a.crouch || a.prone ? 0.5 : 0.9), Float(-a.y)]
            e.orientation = simd_quatf(angle: Float(.pi - a.yaw), axis: [0, 1, 0])
        }
        for (id, e) in actors where !seen.contains(id) { e.removeFromParent(); actors[id] = nil }
    }

    // MARK: building

    private func build(_ z: ZoneReply, _ g: Ground, _ t: TimeOfDay) {
        builtFor = z.id
        ground.children.removeAll(); props.children.removeAll()
        for band in g.bands() {
            var d = MeshDescriptor(name: "ground")
            d.positions = MeshBuffers.Positions(band.positions)
            d.primitives = .triangles(band.indices)
            guard let mesh = try? MeshResource.generate(from: [d]) else { continue }
            ground.addChild(ModelEntity(mesh: mesh, materials: [flat(Palette.terrain(rock: band.rock, haze: Float(band.haze) / 3, tod: t, trees: z.trees))]))
        }
        for p in z.props { if let e = prop(p, g, z.trees, t) { props.addChild(e) } }
    }

    private func setSky(_ t: TimeOfDay) {
        tod = t
        let s = Palette.sky(t)
        let mesh = MeshResource.generateSphere(radius: 1500)
        var m = UnlitMaterial(color: s.horizon)
        if let tex = try? TextureResource.generate(from: Palette.gradient(top: s.top, bottom: s.horizon), options: .init(semantic: .color)) {
            m.color = .init(tint: .white, texture: .init(tex))
        }
        sky.model = ModelComponent(mesh: mesh, materials: [m])
        sky.scale = [-1, 1, 1]        // inside out: we look at the sky from within
    }

    private func flat(_ c: UIColor) -> UnlitMaterial { UnlitMaterial(color: c) }

    private func prop(_ p: ZoneReply.Prop, _ g: Ground, _ trees: String, _ t: TimeOfDay) -> ModelEntity? {
        let h = Float(g.height(p.x, p.y))
        let haze = Float(min(1, max(0, (hypot(p.x, p.y) / g.radius - 0.55) / 0.45)))
        func part(_ mesh: MeshResource, _ c: UIColor, _ at: SIMD3<Float>, _ scale: SIMD3<Float> = .one) -> ModelEntity {
            let e = ModelEntity(mesh: mesh, materials: [flat(Palette.haze(c, haze, t))]); e.position = at; e.scale = scale; return e
        }
        let root = ModelEntity()
        let s = Float(p.size)
        switch p.kind {
        case "pine", "sequoia":
            let tall = Float(p.tall)
            root.addChild(part(.generateBox(size: [0.5 * s, tall * 0.35, 0.5 * s]), Palette.bark, [0, tall * 0.175, 0]))
            root.addChild(part(.generateSphere(radius: 1), Palette.leaf(p.kind), [0, tall * 0.6, 0], [tall * 0.16, tall * 0.4, tall * 0.16]))
        case "saguaro", "cactus":
            let tall = Float(max(p.tall, 0.6))
            root.addChild(part(.generateBox(size: [0.5 * s, tall, 0.5 * s]), Palette.cactus, [0, tall / 2, 0]))
        case "bush": root.addChild(part(.generateSphere(radius: 1), Palette.leaf("bush"), [0, 0.5 * s, 0], [s, 0.6 * s, s]))
        case "boulder": root.addChild(part(.generateSphere(radius: 1), Palette.rock, [0, 0.4 * s, 0], [s, 0.7 * s, s]))
        case "log": root.addChild(part(.generateBox(size: [2.4 * s, 0.5, 0.5]), Palette.bark, [0, 0.25, 0]))
        case "cabin": root.addChild(part(.generateBox(size: [7, 3.2, 5]), Palette.cabin, [0, 1.6, 0]))
        case "tent": root.addChild(part(.generateBox(size: [2.2, 1.4, 2.2]), Palette.tent, [0, 0.7, 0]))
        case "outhouse", "table", "sign": root.addChild(part(.generateBox(size: [1, Float(max(p.tall, 0.8)), 1]), Palette.bark, [0, Float(max(p.tall, 0.8)) / 2, 0]))
        case "geyser": root.addChild(part(.generateSphere(radius: 1), Palette.rock, [0, 0.3, 0], [1.2 * s, 0.6 * s, 1.2 * s]))
        case "pool": root.addChild(part(.generateSphere(radius: 1), Palette.water, [0, 0, 0], [Float(p.r), 0.05, Float(p.r)]))
        default: return nil
        }
        root.position = [Float(p.x), h, Float(-p.y)]
        root.orientation = simd_quatf(angle: Float(p.rot), axis: [0, 1, 0])
        return root
    }

    private func person(_ a: ActorView) -> ModelEntity {
        let root = ModelEntity()
        if let d = a.disguise {          // a camper turned into a prop looks like the prop
            root.addChild(ModelEntity(mesh: .generateSphere(radius: 1), materials: [flat(d.kind == "bush" ? Palette.leaf("bush") : d.kind == "log" ? Palette.bark : Palette.rock)]))
            root.scale = [Float(d.size), Float(d.size) * 0.7, Float(d.size)]
        } else {
            let vest = a.role == .ranger
            let body = ModelEntity(mesh: .generateBox(size: [0.5, 0.8, 0.3]), materials: [flat(vest ? Palette.sunUI : Palette.camper)])
            let head = ModelEntity(mesh: .generateSphere(radius: 0.15), materials: [flat(Palette.skin)]); head.position = [0, 0.55, 0]
            let legs = ModelEntity(mesh: .generateBox(size: [0.4, 0.8, 0.25]), materials: [flat(Palette.legs)]); legs.position = [0, -0.8, 0]
            root.addChild(body); root.addChild(head); root.addChild(legs)
        }
        people.addChild(root)
        return root
    }
}

/// Flat colours, per time of day, thinned into the sky with haze.
enum Palette {
    static let bark = UIColor(red: 0.36, green: 0.26, blue: 0.18, alpha: 1)
    static let rock = UIColor(red: 0.52, green: 0.50, blue: 0.47, alpha: 1)
    static let cactus = UIColor(red: 0.30, green: 0.50, blue: 0.30, alpha: 1)
    static let cabin = UIColor(red: 0.55, green: 0.36, blue: 0.22, alpha: 1)
    static let tent = UIColor(red: 0.89, green: 0.55, blue: 0.20, alpha: 1)
    static let water = UIColor(red: 0.25, green: 0.62, blue: 0.70, alpha: 1)
    static let sunUI = UIColor(red: 0.95, green: 0.45, blue: 0.10, alpha: 1)
    static let camper = UIColor(red: 0.17, green: 0.42, blue: 0.69, alpha: 1)
    static let skin = UIColor(red: 0.88, green: 0.69, blue: 0.54, alpha: 1)
    static let legs = UIColor(red: 0.23, green: 0.25, blue: 0.29, alpha: 1)

    static func leaf(_ kind: String) -> UIColor {
        kind == "sequoia" ? UIColor(red: 0.20, green: 0.40, blue: 0.22, alpha: 1) : kind == "bush" ? UIColor(red: 0.33, green: 0.55, blue: 0.27, alpha: 1) : UIColor(red: 0.14, green: 0.36, blue: 0.24, alpha: 1)
    }

    static func sky(_ t: TimeOfDay) -> (top: UIColor, horizon: UIColor) {
        switch t {
        case .day: return (UIColor(red: 0.30, green: 0.58, blue: 0.86, alpha: 1), UIColor(red: 0.85, green: 0.92, blue: 0.95, alpha: 1))
        case .dusk: return (UIColor(red: 0.28, green: 0.25, blue: 0.50, alpha: 1), UIColor(red: 0.96, green: 0.62, blue: 0.40, alpha: 1))
        case .night: return (UIColor(red: 0.03, green: 0.05, blue: 0.14, alpha: 1), UIColor(red: 0.10, green: 0.14, blue: 0.28, alpha: 1))
        }
    }

    /// `c` dimmed for the hour and pulled towards the horizon colour by `haze` (0 near, 1 at the rim).
    static func haze(_ c: UIColor, _ haze: Float, _ t: TimeOfDay) -> UIColor {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        let dim: CGFloat = t == .day ? 1 : t == .dusk ? 0.7 : 0.35
        var hr: CGFloat = 0, hg: CGFloat = 0, hb: CGFloat = 0
        sky(t).horizon.getRed(&hr, green: &hg, blue: &hb, alpha: &a)
        let k = CGFloat(haze) * 0.8
        return UIColor(red: r * dim * (1 - k) + hr * k, green: g * dim * (1 - k) + hg * k, blue: b * dim * (1 - k) + hb * k, alpha: 1)
    }

    static func terrain(rock: Bool, haze h: Float, tod: TimeOfDay, trees: String) -> UIColor {
        let base = rock ? rockTone : trees == "desert" ? UIColor(red: 0.80, green: 0.66, blue: 0.45, alpha: 1) : UIColor(red: 0.45, green: 0.60, blue: 0.33, alpha: 1)
        return haze(base, h, tod)
    }
    static let rockTone = UIColor(red: 0.58, green: 0.54, blue: 0.50, alpha: 1)

    static func gradient(top: UIColor, bottom: UIColor) -> CGImage {
        let size = CGSize(width: 4, height: 256)
        let img = UIGraphicsImageRenderer(size: size).image { ctx in
            let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [top.cgColor, bottom.cgColor] as CFArray, locations: [0, 1])!
            ctx.cgContext.drawLinearGradient(g, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
        }
        return img.cgImage!
    }
}
