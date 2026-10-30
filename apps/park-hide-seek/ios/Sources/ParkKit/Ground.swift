import Foundation

/// GET /api/zone: one zone's ground as the edge sends it (ZoneReply in src/api.ts).
public struct ZoneReply: Codable {
    public struct Prop: Codable, Equatable {
        public let kind: String
        public let x: Double, y: Double, r: Double, tall: Double, rot: Double, size: Double
        public let label: String
    }
    public struct Station: Codable, Equatable { public let x: Double, y: Double, yaw: Double }
    public let id: String
    public let name: String
    public let trees: String
    public let radius: Double
    public let n: Int
    public let heights: String
    public let lowest: Double
    public let scale: Double
    public let props: [Prop]
    public let station: Station
}

/// The height field, decoded once. x east, y north, in game metres from the zone centre, like the page's Zone.
public struct Ground {
    public let n: Int
    public let radius: Double
    public let step: Double
    public let h: [Float]

    public init?(_ z: ZoneReply) {
        guard z.n >= 2, let data = Data(base64Encoded: z.heights), data.count == z.n * z.n * 2 else { return nil }
        n = z.n
        radius = z.radius
        step = 2 * z.radius / Double(z.n - 1)
        var out = [Float](); out.reserveCapacity(z.n * z.n)
        for i in 0..<(z.n * z.n) {
            let v = Int16(bitPattern: UInt16(data[2 * i]) | UInt16(data[2 * i + 1]) << 8)
            out.append(Float((Double(v) - z.lowest) / z.scale))
        }
        h = out
    }

    /// Ground height, bilinear between samples; clamps outside the grid.
    public func height(_ x: Double, _ y: Double) -> Double {
        let fx = max(0, min(Double(n) - 1.001, (x + radius) / step))
        let fy = max(0, min(Double(n) - 1.001, (y + radius) / step))
        let c = Int(fx), r = Int(fy), tx = fx - Double(c), ty = fy - Double(r)
        let i = r * n + c
        return Double(h[i]) * (1 - tx) * (1 - ty) + Double(h[i + 1]) * tx * (1 - ty)
            + Double(h[i + n]) * (1 - tx) * ty + Double(h[i + n + 1]) * tx * ty
    }

    /// Rise per metre, from the four neighbours, like the page's Zone.slope.
    public func slope(_ x: Double, _ y: Double) -> Double {
        let e = step
        return hypot(height(x + e, y) - height(x - e, y), height(x, y + e) - height(x, y - e)) / (2 * e)
    }

    /// The part of the room's drop rule (dropOk in src/hunt/game.ts) the app can see: inside the zone, clear of the
    /// ranger cabin, on ground gentle enough to stand on. Whether the spot is on the main walkable ground is the room's
    /// call, so a tap this accepts can still be refused; the flag then doesn't appear.
    public func canDrop(_ x: Double, _ y: Double, station: ZoneReply.Station) -> Bool {
        inside(x, y, margin: 4) && hypot(x - station.x, y - station.y) >= Self.dropClear && slope(x, y) < Self.cliff * 0.8
    }
    public static let dropClear = 45.0, cliff = 0.85

    public func inside(_ x: Double, _ y: Double, margin: Double = 0) -> Bool { x * x + y * y <= (radius - margin) * (radius - margin) }

    /// The terrain as a triangle mesh: positions in RealityKit axes (x east, y up, z south) and a haze
    /// factor per vertex that is 0 at the centre and 1 at the rim, for the park-poster fade.
    public func mesh(stride s: Int = 2) -> (positions: [SIMD3<Float>], haze: [Float], indices: [UInt32]) {
        let cols = (n - 1) / s + 1
        var pos = [SIMD3<Float>](), haze = [Float](), idx = [UInt32]()
        for r in 0..<cols {
            for c in 0..<cols {
                let gx = min(c * s, n - 1), gy = min(r * s, n - 1)
                let x = -radius + Double(gx) * step, y = -radius + Double(gy) * step
                pos.append(SIMD3(Float(x), h[gy * n + gx], Float(-y)))
                haze.append(Float(min(1, max(0, (hypot(x, y) / radius - 0.55) / 0.45))))
            }
        }
        for r in 0..<(cols - 1) {
            for c in 0..<(cols - 1) {
                let a = UInt32(r * cols + c), b = a + 1, d = a + UInt32(cols), e = d + 1
                // wound so the face looks up with z flipped
                idx += [a, b, d, b, e, d]
            }
        }
        return (pos, haze, idx)
    }

    /// One flat colour's worth of terrain: triangles that sit in the same haze ring, rock or ground.
    public struct Band { public let haze: Int, rock: Bool; public var positions: [SIMD3<Float>] = [], indices: [UInt32] = [] }

    /// The terrain split into flat-coloured pieces, for a renderer without vertex colours: `rings` steps of haze
    /// from the centre out, and steep ground (a rise of `rockSlope` or more a metre) apart from the rest.
    public func bands(stride s: Int = 2, rings: Int = 4, rockSlope: Double = 0.85) -> [Band] {
        let m = mesh(stride: s)
        var out: [Int: Band] = [:]
        for t in stride(from: 0, to: m.indices.count, by: 3) {
            let v = [Int(m.indices[t]), Int(m.indices[t + 1]), Int(m.indices[t + 2])]
            let hz = v.map { m.haze[$0] }.reduce(0, +) / 3
            let p = v.map { m.positions[$0] }
            let e1 = p[1] - p[0], e2 = p[2] - p[0]
            let nrm = SIMD3<Float>(e1.y * e2.z - e1.z * e2.y, e1.z * e2.x - e1.x * e2.z, e1.x * e2.y - e1.y * e2.x)
            let up = abs(nrm.y) / max(1e-6, (nrm * nrm).sum().squareRoot())
            let rise = Double((1 - up * up).squareRoot() / max(1e-6, up))      // tan of the tilt
            let key = min(rings - 1, Int(hz * Float(rings))) * 2 + (rise >= rockSlope ? 1 : 0)
            var b = out[key] ?? Band(haze: key / 2, rock: key % 2 == 1)
            for q in p { b.indices.append(UInt32(b.positions.count)); b.positions.append(q) }
            out[key] = b
        }
        return out.keys.sorted().map { out[$0]! }
    }
}
