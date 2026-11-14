// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../../LICENSE.
import XCTest
@testable import QViewKit

final class QViewKitTests: XCTestCase {
    /// One textured triangle, as Object Capture's mesh would arrive.
    let triangle = TexturedMesh(
        positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
        uvs: [[0, 0], [1, 0], [0, 1]],
        indices: [0, 1, 2],
        texture: (Data([0xFF, 0xD8, 0xFF, 0xD9]), "image/jpeg"))

    func u32(_ d: Data, _ at: Int) -> UInt32 { d.subdata(in: at..<at + 4).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) } }

    /// The header the Worker checks (src/samples.ts isGlb), then a JSON chunk a glTF reader can follow to the picture.
    func testGLBIsWhatTheWorkerAndThreeRead() throws {
        let d = try GLB.write(triangle)
        XCTAssertEqual(u32(d, 0), 0x4654_6C67)
        XCTAssertEqual(u32(d, 4), 2)
        XCTAssertEqual(Int(u32(d, 8)), d.count)
        let jsonLength = Int(u32(d, 12))
        XCTAssertEqual(u32(d, 16), 0x4E4F_534A)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: d.subdata(in: 20..<20 + jsonLength)) as? [String: Any])
        XCTAssertEqual(Int(u32(d, 20 + jsonLength)), (json["buffers"] as? [[String: Any]])?.first?["byteLength"] as? Int)
        let accessors = try XCTUnwrap(json["accessors"] as? [[String: Any]])
        XCTAssertEqual(accessors.first?["max"] as? [Double], [1, 1, 0])
        XCTAssertEqual((json["images"] as? [[String: Any]])?.first?["mimeType"] as? String, "image/jpeg")
        XCTAssertEqual(d.count % 4, 0)
    }

    func testGLBRefusesBrokenMeshes() {
        var bad = triangle
        bad.indices = [0, 1, 3]
        XCTAssertThrowsError(try GLB.write(bad))
        bad = triangle
        bad.uvs = [[0, 0]]
        XCTAssertThrowsError(try GLB.write(bad))
    }

    func testSignRequestNamesTheScanAndItsHash() throws {
        let shop = Shop(host: URL(string: "https://qview3d.example")!, org: "trail-co", adminKey: "k-12345678")
        let r = try shop.signRequest(Data("abc".utf8))
        XCTAssertEqual(r.url?.absoluteString, "https://qview3d.example/api/orgs/trail-co/uploads")
        XCTAssertEqual(r.value(forHTTPHeaderField: "authorization"), "Bearer k-12345678")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: r.httpBody ?? Data()) as? [String: Any])
        XCTAssertEqual(body["kind"] as? String, "scan")
        XCTAssertEqual(body["type"] as? String, "model/gltf-binary")
        XCTAssertEqual(body["sha256"] as? String, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}
