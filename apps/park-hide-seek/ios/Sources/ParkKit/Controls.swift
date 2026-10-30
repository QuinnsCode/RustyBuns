import Foundation

/// Touch and game-controller input turned into the `pos` the edge checks. The edge limits speed and
/// pushes players out of rocks, so this only has to be a sensible request.
public struct Mover {
    public var x: Double, y: Double, yaw: Double, pitch: Double
    public var crouch = false, run = false, light = false
    /// Metres a second, MOVE in src/hunt/sim.ts; the edge is the judge, this only asks for what it allows.
    public var role: Role = .camper
    var speeds: (walk: Double, run: Double, crouch: Double) { role == .ranger ? (3.8, 7.6, 1.8) : (3.2, 6.0, 1.4) }

    public init(x: Double = 0, y: Double = 0, yaw: Double = 0, pitch: Double = 0) { self.x = x; self.y = y; self.yaw = yaw; self.pitch = pitch }

    /// Move with the stick (each axis -1...1, forward is +y) for `dt` seconds, relative to where you face.
    public mutating func step(stick: (x: Double, y: Double), dt: Double, inside: (Double, Double) -> Bool) {
        let len = min(1, hypot(stick.x, stick.y))
        guard len > 0.05 else { return }
        let sp = speeds, speed = (crouch ? sp.crouch : run ? sp.run : sp.walk) * len
        let dir = atan2(stick.x, stick.y)                 // 0 is straight ahead
        let heading = yaw + dir
        // yaw 0 faces north (+y); positive yaw turns toward east, as the page's camera does
        let nx = x + sin(heading) * speed * dt, ny = y + cos(heading) * speed * dt
        if inside(nx, ny) { x = nx; y = ny }
    }

    /// Turn by a drag or right stick, in radians; looking is limited to straight up and down.
    public mutating func look(dx: Double, dy: Double) {
        yaw += dx
        pitch = max(-1.4, min(1.4, pitch + dy))
    }

    public var message: ClientMsg { .pos(x: x, y: y, yaw: yaw, pitch: pitch, crouch: crouch, run: run, light: light) }
}
