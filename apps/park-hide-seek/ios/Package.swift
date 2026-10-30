// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ParkKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "ParkKit", targets: ["ParkKit"])],
    // What every RustyBuns iOS app shares: eqosys sign-in, the friends hub, the edge's protocol version handshake.
    dependencies: [.package(path: "../../../packages/ios-kit")],
    targets: [
        .target(name: "ParkKit", dependencies: [.product(name: "RustyBunsKit", package: "ios-kit")]),
        .testTarget(name: "ParkKitTests", dependencies: ["ParkKit"]),
    ]
)
