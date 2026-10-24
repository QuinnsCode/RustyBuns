import XCTest
@testable import RustyBunsKit

final class AppLinkTests: XCTestCase {
    func testBareHostGetsHttps() {
        XCTAssertEqual(AppLink("my-app.workers.dev")?.url.absoluteString, "https://my-app.workers.dev")
    }

    func testHttpIsUpgradedUnlessLocal() {
        XCTAssertEqual(AppLink("http://my-app.workers.dev")?.url.scheme, "https")
        XCTAssertEqual(AppLink("http://localhost:5173")?.url.absoluteString, "http://localhost:5173")
        XCTAssertEqual(AppLink("http://192.168.1.20:8787")?.url.scheme, "http")
        XCTAssertEqual(AppLink("http://172.32.0.1")?.url.scheme, "https")
    }

    func testDeepLink() {
        XCTAssertEqual(AppLink("rustybuns://open?url=https://a.example.com/x")?.url.absoluteString, "https://a.example.com/x")
        XCTAssertNil(AppLink("rustybuns://open"))
    }

    func testRejectsJunk() {
        XCTAssertNil(AppLink(""))
        XCTAssertNil(AppLink("   "))
        XCTAssertNil(AppLink("javascript:alert(1)"))
        XCTAssertNil(AppLink("file:///etc/passwd"))
    }

    func testOnlyOwnHostStaysInside() {
        let link = AppLink("my-app.workers.dev")!
        XCTAssertTrue(link.keeps(URL(string: "https://MY-APP.workers.dev/page")!))
        XCTAssertFalse(link.keeps(URL(string: "https://evil.example.com")!))
        XCTAssertFalse(link.keeps(URL(string: "https://my-app.workers.dev.evil.com")!))
    }
}
