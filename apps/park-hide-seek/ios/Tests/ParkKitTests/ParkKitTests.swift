import XCTest
@testable import ParkKit

final class ParkKitTests: XCTestCase {
    // A view as the edge sends it to a ranger: one camper in sight, the circle closing.
    let view = """
    {"t":"view","view":{"me":"aa","hostId":"aa","phase":"hunt","now":1000,"endsAt":9000,"zone":"el-capitan","zonePick":"random","tod":"day","live":false,"laps":1,"mode":"classic",
     "players":[{"id":"aa","name":"Ada","bot":null,"score":0,"online":true,"look":{"shirt":1,"pants":0,"skin":2,"hat":"cap","pack":true}},
                {"id":"bb","name":"Pika","bot":"normal","score":10,"online":true,"look":{"shirt":3,"pants":1,"skin":0,"hat":"none","pack":false}},
                {"id":"cc","name":"Bo","bot":null,"score":0,"online":true,"look":{"shirt":0,"pants":0,"skin":0,"hat":"beanie","pack":false}}],
     "round":{"id":1,"n":1,"total":3,"rangers":["aa"],"you":{"id":"aa","role":"ranger","x":1,"y":2,"yaw":0.5,"pitch":0,"stamina":1,"crouch":false,"light":false,"caughtAt":null,"caughtBy":null,"drop":null,"disguise":null,"climbAt":null},
       "others":[{"id":"bb","role":"camper","x":5,"y":6,"yaw":1,"pitch":0,"crouch":true,"prone":false,"climb":false,"run":false,"light":false,"caughtAt":null,"disguise":{"kind":"bush","size":1.2,"rot":0.3}}],
       "cues":[{"id":4,"kind":"rustle","x":9,"y":9,"at":990,"by":"bb","to":"rangers"}],"asks":[],"radio":null,"huntStartedAt":500,
       "circle":{"x0":0,"y0":0,"r0":100,"x1":10,"y1":0,"r1":50,"from":1000,"to":4000},"bigfoot":null,
       "sky":{"tod":"day","fog":0.2,"rain":0,"wind":0.1,"overcast":false,"snow":false},"weather":null,"results":null},
     "log":["a ranger is looking"]}}
    """

    func testReadsAViewTheEdgeSends() throws {
        let v = try XCTUnwrap(decodeServerMsg(view))
        XCTAssertEqual(v.phase, .hunt)
        XCTAssertEqual(v.round?.you?.role, .ranger)
        XCTAssertEqual(v.round?.others.first?.disguise?.kind, "bush")
        XCTAssertEqual(v.strangers.map(\.id), ["cc"])           // the AI and you are not who Report is for
        XCTAssertEqual(v.name(of: "bb"), "Pika")
        let c = try XCTUnwrap(v.round?.circle).at(2500)
        XCTAssertEqual(c.r, 75, accuracy: 0.001)
    }

    func testAnUnknownMessageIsNotAView() {
        XCTAssertNil(decodeServerMsg(#"{"t":"hello"}"#))
        XCTAssertNil(decodeServerMsg("not json"))
    }

    func testMessagesMatchWhatParseMsgReads() {
        XCTAssertEqual(ClientMsg.start.json(), #"{"t":"start"}"#)
        XCTAssertTrue(ClientMsg.bot(.hard).json().contains("\"level\":\"hard\""))
        let pos = ClientMsg.pos(x: 1, y: 2, yaw: 0.5, pitch: 0, crouch: false, run: true, light: false).json()
        for key in ["\"t\":\"pos\"", "\"x\":1", "\"yaw\":0.5", "\"run\":true", "\"light\":false"] { XCTAssertTrue(pos.contains(key), key) }
        XCTAssertTrue(ClientMsg.name(String(repeating: "a", count: 40)).json().contains(String(repeating: "a", count: 24) + "\""))
    }

    func testNamesPeopleMeetAreFiltered() {
        XCTAssertEqual(NameFilter.check("  Ada "), .ok("Ada"))
        XCTAssertEqual(NameFilter.check("   "), .empty)
        XCTAssertEqual(NameFilter.check(String(repeating: "x", count: 25)), .tooLong)
        for bad in ["Sh1t", "f u c k", "$HIT", "xXnaziXx"] { XCTAssertEqual(NameFilter.check(bad), .refused, bad) }
        XCTAssertEqual(NameFilter.check("Scunthorpe Pete"), .refused)   // known cost of a plain filter; a name can be retyped
        XCTAssertEqual(NameFilter.check("Juniper"), .ok("Juniper"))
    }

    func testRoomLinksAndCodes() {
        XCTAssertEqual(Edge.room(from: "https://park-hide-seek.notryanquinn.workers.dev/?room=pika"), "PIKA")
        XCTAssertEqual(Edge.room(from: "https://x.dev/join/ELK7"), "ELK7")
        XCTAssertEqual(Edge.room(from: " pika "), "PIKA")
        XCTAssertNil(Edge.room(from: "hi"))
        XCTAssertNil(Edge.room(from: "https://example.com/?room=no way"))
        for _ in 0..<50 {
            let code = Edge.newRoomCode()
            XCTAssertTrue(Edge.isRoomCode(code)); XCTAssertFalse(code.hasPrefix("Q"))
        }
    }

    func testUrlsCarryWhoIsPlaying() {
        let who = Edge.Who.guest(uid: "abcdefgh12", name: "Ada B")
        let ws = Edge.live.socket(room: "PIKA", who: who).absoluteString
        XCTAssertTrue(ws.hasPrefix("wss://park-hide-seek.notryanquinn.workers.dev/ws?"))
        XCTAssertTrue(ws.contains("room=PIKA") && ws.contains("uid=abcdefgh12") && ws.contains("name=Ada%20B"))
        XCTAssertTrue(Edge.live.match(who: .token("t.k.n")).absoluteString.contains("token=t.k.n"))
        XCTAssertTrue(Edge.live.match(who: .token("t.k.n")).absoluteString.hasSuffix("&pv=1"))       // every call says which wire it speaks
        XCTAssertFalse(Edge.live.invite(room: "PIKA").absoluteString.contains("pv="))                // but not the link a friend gets
        XCTAssertEqual(Edge(base: URL(string: "http://192.168.1.4:8787")!).socket(room: "PIKA", who: who).scheme, "ws")
    }

    func testRefusalsBecomeScreens() {
        XCTAssertEqual(Trouble.from(status: 426), .updateRequired)
        XCTAssertEqual(Edge.store.host, "apps.apple.com")                                           // the update screen's link
        XCTAssertEqual(Trouble.from(status: 503), .full)
        XCTAssertEqual(Trouble.from(status: 401), .signInAgain)
    }

    func testBlockedPlayersAreHiddenAndStayBlocked() {
        let d = UserDefaults(suiteName: "phs.test.\(UUID())")!
        let blocks = Blocks(d)
        let p = decodeServerMsg(view)!.players[2]
        XCTAssertEqual(blocks.shown(p), "Bo")
        blocks.block(p.id)
        XCTAssertEqual(Blocks(d).shown(p), "Blocked player")
        blocks.unblock(p.id)
        XCTAssertEqual(blocks.shown(p), "Bo")
    }

    func testStickWalksWhereYouFaceAndStaysInTheZone() {
        var m = Mover(yaw: .pi / 2)                     // facing east
        m.step(stick: (0, 1), dt: 1, inside: { _, _ in true })
        XCTAssertEqual(m.x, 3.2, accuracy: 0.001); XCTAssertEqual(m.y, 0, accuracy: 0.001)
        m.step(stick: (1, 0), dt: 1, inside: { _, _ in true })   // right of east is south
        XCTAssertEqual(m.y, -3.2, accuracy: 0.001)
        var wall = Mover(); wall.step(stick: (0, 1), dt: 1, inside: { _, y in y < 1 })
        XCTAssertEqual(wall.y, 0)
        var look = Mover(); look.look(dx: 0, dy: 9)
        XCTAssertEqual(look.pitch, 1.4)
    }

    func testGroundIsDecodedLikeThePagesZone() throws {
        // 3x3 samples: rows south to north, 100 m, 106 m ... (sample - lowest) / scale
        let samples: [Int16] = [100, 100, 100, 100, 106, 100, 100, 100, 112]
        var bytes = Data(); for s in samples { bytes.append(UInt8(truncatingIfNeeded: s)); bytes.append(UInt8(truncatingIfNeeded: s >> 8)) }
        let z = ZoneReply(id: "t", name: "T", trees: "pine", radius: 10, n: 3, heights: bytes.base64EncodedString(), lowest: 100, scale: 6, props: [], station: .init(x: 0, y: 0, yaw: 0))
        let g = try XCTUnwrap(Ground(z))
        XCTAssertEqual(g.height(0, 0), 1, accuracy: 0.01)                 // the middle sample
        XCTAssertEqual(g.height(1000, 1000), 2, accuracy: 0.05)           // clamped at the NE corner
        XCTAssertTrue(g.inside(0, 9)); XCTAssertFalse(g.inside(8, 8))
        let mesh = g.mesh(stride: 1)
        XCTAssertEqual(mesh.positions.count, 9); XCTAssertEqual(mesh.indices.count, 4 * 6)
        XCTAssertEqual(mesh.positions[8].z, -10)                          // north is -z in RealityKit
        XCTAssertNil(Ground(ZoneReply(id: "t", name: "T", trees: "pine", radius: 10, n: 3, heights: "AAAA", lowest: 0, scale: 6, props: [], station: .init(x: 0, y: 0, yaw: 0))))
    }

    func testTerrainSplitsIntoFlatColoursByHazeAndRock() throws {
        // a flat 5x5 zone with a cliff on its east edge
        var samples = [Int16](repeating: 0, count: 25)
        for r in 0..<5 { samples[r * 5 + 4] = 600 }
        var bytes = Data(); for v in samples { bytes.append(UInt8(truncatingIfNeeded: v)); bytes.append(UInt8(truncatingIfNeeded: v >> 8)) }
        let z = ZoneReply(id: "t", name: "T", trees: "pine", radius: 10, n: 5, heights: bytes.base64EncodedString(), lowest: 0, scale: 6, props: [], station: .init(x: 0, y: 0, yaw: 0))
        let bands = try XCTUnwrap(Ground(z)).bands(stride: 1)
        XCTAssertEqual(bands.reduce(0) { $0 + $1.indices.count }, 4 * 4 * 6)        // every triangle lands in one band
        XCTAssertTrue(bands.contains { $0.rock } && bands.contains { !$0.rock })
        XCTAssertTrue(bands.contains { $0.haze == 0 } && bands.contains { $0.haze > 0 })
    }

    func testDropRuleKeepsOutTheCabinTheRimAndCliffs() throws {
        // 5x5 zone, 100 m across, cliff on the east edge, cabin at the centre
        var samples = [Int16](repeating: 0, count: 25)
        for r in 0..<5 { samples[r * 5 + 4] = 3000 }
        var bytes = Data(); for v in samples { bytes.append(UInt8(truncatingIfNeeded: v)); bytes.append(UInt8(truncatingIfNeeded: v >> 8)) }
        let z = ZoneReply(id: "t", name: "T", trees: "pine", radius: 100, n: 5, heights: bytes.base64EncodedString(), lowest: 0, scale: 6, props: [], station: .init(x: 0, y: 0, yaw: 0))
        let g = try XCTUnwrap(Ground(z))
        XCTAssertTrue(g.canDrop(-60, 20, station: z.station))
        XCTAssertFalse(g.canDrop(10, 10, station: z.station))      // inside the cabin's clearing
        XCTAssertFalse(g.canDrop(-99, 0, station: z.station))      // on the rim
        XCTAssertFalse(g.canDrop(90, 0, station: z.station))       // steep
    }

    func testYouSeeYourAcceptedDrop() throws {
        XCTAssertNil(try XCTUnwrap(decodeServerMsg(view)).round?.you?.drop)
        let picked = view.replacingOccurrences(of: "\"drop\":null", with: "\"drop\":[3.5,-4]")
        XCTAssertEqual(try XCTUnwrap(decodeServerMsg(picked)).round?.you?.drop, [3.5, -4])
    }
}
