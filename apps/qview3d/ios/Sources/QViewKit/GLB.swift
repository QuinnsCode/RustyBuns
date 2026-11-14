// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../../LICENSE.
//
// A glTF 2.0 binary (GLB) from one textured mesh: what Object Capture makes, in the format the widget's three.js reads.
// One primitive, positions, normals and UVs, 32-bit indices, and the base colour picture inside the file. Plain
// values in, bytes out, so it tests on a Mac.
import Foundation
import simd

public struct TexturedMesh {
    public var positions: [SIMD3<Float>]
    public var normals: [SIMD3<Float>]
    /// glTF's convention: (0, 0) is the picture's top left.
    public var uvs: [SIMD2<Float>]
    public var indices: [UInt32]
    /// The base colour picture's encoded bytes (JPEG or PNG) and its type; nil for a plain grey model.
    public var texture: (bytes: Data, mime: String)?

    public init(positions: [SIMD3<Float>], normals: [SIMD3<Float>], uvs: [SIMD2<Float>], indices: [UInt32], texture: (bytes: Data, mime: String)?) {
        self.positions = positions
        self.normals = normals
        self.uvs = uvs
        self.indices = indices
        self.texture = texture
    }
}

public enum GLBError: Error, Equatable {
    case empty
    case mismatched(String)
}

public enum GLB {
    public static let mime = "model/gltf-binary"

    public static func write(_ m: TexturedMesh) throws -> Data {
        guard !m.positions.isEmpty, !m.indices.isEmpty else { throw GLBError.empty }
        if !m.normals.isEmpty && m.normals.count != m.positions.count { throw GLBError.mismatched("normals") }
        if !m.uvs.isEmpty && m.uvs.count != m.positions.count { throw GLBError.mismatched("uvs") }
        if let bad = m.indices.first(where: { Int($0) >= m.positions.count }) { throw GLBError.mismatched("index \(bad)") }

        var bin = Data()
        var views: [[String: Any]] = []
        /// Adds one block to the binary chunk, 4-byte aligned, and returns its buffer view's index.
        func view(_ d: Data, target: Int?) -> Int {
            while bin.count % 4 != 0 { bin.append(0) }
            var v: [String: Any] = ["buffer": 0, "byteOffset": bin.count, "byteLength": d.count]
            if let target { v["target"] = target }
            bin.append(d)
            views.append(v)
            return views.count - 1
        }
        func bytes<T>(_ a: [T]) -> Data { a.withUnsafeBufferPointer { Data(buffer: $0) } }
        let floats3 = { (a: [SIMD3<Float>]) in bytes(a.flatMap { [$0.x, $0.y, $0.z] }) }

        var lo = m.positions[0], hi = m.positions[0]
        for p in m.positions { lo = simd_min(lo, p); hi = simd_max(hi, p) }

        var accessors: [[String: Any]] = []
        var attributes: [String: Int] = [:]
        accessors.append(["bufferView": view(floats3(m.positions), target: 34962), "componentType": 5126, "count": m.positions.count,
                          "type": "VEC3", "min": [lo.x, lo.y, lo.z], "max": [hi.x, hi.y, hi.z]])
        attributes["POSITION"] = 0
        if !m.normals.isEmpty {
            accessors.append(["bufferView": view(floats3(m.normals), target: 34962), "componentType": 5126, "count": m.normals.count, "type": "VEC3"])
            attributes["NORMAL"] = accessors.count - 1
        }
        if !m.uvs.isEmpty {
            accessors.append(["bufferView": view(bytes(m.uvs.flatMap { [$0.x, $0.y] }), target: 34962), "componentType": 5126, "count": m.uvs.count, "type": "VEC2"])
            attributes["TEXCOORD_0"] = accessors.count - 1
        }
        accessors.append(["bufferView": view(bytes(m.indices), target: 34963), "componentType": 5125, "count": m.indices.count, "type": "SCALAR"])
        let indices = accessors.count - 1

        var pbr: [String: Any] = ["metallicFactor": 0, "roughnessFactor": 1]
        var json: [String: Any] = [
            "asset": ["version": "2.0", "generator": "QView3D Scan"],
            "scene": 0,
            "scenes": [["nodes": [0]]],
            "nodes": [["mesh": 0]],
            "meshes": [["primitives": [["attributes": attributes, "indices": indices, "material": 0]]]],
        ]
        if let t = m.texture, !m.uvs.isEmpty {
            json["images"] = [["bufferView": view(t.bytes, target: nil), "mimeType": t.mime]]
            json["samplers"] = [["magFilter": 9729, "minFilter": 9987]]
            json["textures"] = [["source": 0, "sampler": 0]]
            pbr["baseColorTexture"] = ["index": 0]
        }
        json["materials"] = [["pbrMetallicRoughness": pbr]]
        while bin.count % 4 != 0 { bin.append(0) }
        json["accessors"] = accessors
        json["bufferViews"] = views
        json["buffers"] = [["byteLength": bin.count]]

        var text = try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
        while text.count % 4 != 0 { text.append(0x20) }

        var out = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }
        u32(0x4654_6C67) // "glTF"
        u32(2)
        u32(UInt32(12 + 8 + text.count + 8 + bin.count))
        u32(UInt32(text.count)); u32(0x4E4F_534A) // "JSON"
        out.append(text)
        u32(UInt32(bin.count)); u32(0x004E_4942) // "BIN\0"
        out.append(bin)
        return out
    }
}
