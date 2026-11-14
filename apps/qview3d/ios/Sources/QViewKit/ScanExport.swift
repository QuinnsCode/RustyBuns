// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../../LICENSE.
//
// Object Capture's USDZ as a GLB. The USDZ holds USDC, which the widget's three.js cannot read, and ModelIO exports
// no glTF, so this reads the mesh and its base colour picture through ModelIO and hands them to `GLB.write`. Every
// mesh in the file is merged into one, each moved by its own transform. Object Capture's model is in metres, Y up,
// the same as glTF's.
import Foundation
import ImageIO
import ModelIO
import UniformTypeIdentifiers
import simd

public enum ScanExportError: Error {
    case noMesh
    case unreadable(String)
}

public enum ScanExport {
    /// USD puts (0, 0) at a picture's bottom left and glTF at its top left. If a scan's colours land in the wrong
    /// places on the phone, this is the first thing to check.
    static let flipV = true

    public static func glb(fromUSDZ url: URL) throws -> Data {
        let asset = MDLAsset(url: url)
        asset.loadTextures()
        let meshes = asset.childObjects(of: MDLMesh.self).compactMap { $0 as? MDLMesh }
        guard !meshes.isEmpty else { throw ScanExportError.noMesh }

        var out = TexturedMesh(positions: [], normals: [], uvs: [], indices: [], texture: nil)
        for mesh in meshes {
            if mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributeNormal, as: .float3) == nil {
                mesh.addNormals(withAttributeNamed: MDLVertexAttributeNormal, creaseThreshold: 0.5)
            }
            let world = MDLTransform.globalTransform(with: mesh, atTime: 0)
            let turn = simd_float3x3(columns: (simd_make_float3(world.columns.0), simd_make_float3(world.columns.1), simd_make_float3(world.columns.2)))
            let normalTurn = turn.inverse.transpose
            let base = UInt32(out.positions.count)
            let n = mesh.vertexCount

            let positions = try read3(mesh, MDLVertexAttributePosition, n)
            out.positions += positions.map { p in simd_make_float3(world * simd_float4(p, 1)) }
            out.normals += try read3(mesh, MDLVertexAttributeNormal, n).map { simd_normalize(normalTurn * $0) }
            if let uv = mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributeTextureCoordinate, as: .float2) {
                out.uvs += (0..<n).map { i in
                    let t = uv.dataStart.advanced(by: i * uv.stride).assumingMemoryBound(to: SIMD2<Float>.self).pointee
                    return flipV ? SIMD2(t.x, 1 - t.y) : t
                }
            } else {
                out.uvs += Array(repeating: .zero, count: n)
            }

            for case let sub as MDLSubmesh in mesh.submeshes ?? [] where sub.geometryType == .triangles {
                let buf = sub.indexBuffer(asIndexType: .uInt32)
                let map = buf.map()
                let p = map.bytes.assumingMemoryBound(to: UInt32.self)
                out.indices += (0..<sub.indexCount).map { base + p[$0] }
                if out.texture == nil, let picture = sub.material?.property(with: .baseColor)?.textureSamplerValue?.texture {
                    out.texture = jpeg(picture)
                }
            }
        }
        return try GLB.write(out)
    }

    private static func read3(_ mesh: MDLMesh, _ name: String, _ n: Int) throws -> [SIMD3<Float>] {
        guard let a = mesh.vertexAttributeData(forAttributeNamed: name, as: .float3) else { throw ScanExportError.unreadable(name) }
        return (0..<n).map { i in
            let f = a.dataStart.advanced(by: i * a.stride).assumingMemoryBound(to: Float.self)
            return SIMD3(f[0], f[1], f[2])
        }
    }

    /// The picture as a JPEG: a scan's 2048 px base colour is a few MB as PNG and well under one as JPEG.
    private static func jpeg(_ t: MDLTexture) -> (bytes: Data, mime: String)? {
        guard let image = t.imageFromTexture()?.takeUnretainedValue() else { return nil }
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return (data as Data, "image/jpeg")
    }
}
