// swift-tools-version:5.9
import PackageDescription

// RustyBunsKit: what every RustyBuns iOS app needs from the platform, so an app writes only its own game or suite.
// eqosys sign-in that stays signed in (EqosysAuth, EqosysSignIn), the friends hub (HubLink), and the edge's
// protocol version handshake (EdgeProtocol, Trouble). An app adds it as a local package (see README.md).
let package = Package(
    name: "RustyBunsKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "RustyBunsKit", targets: ["RustyBunsKit"])],
    targets: [
        .target(name: "RustyBunsKit"),
        .testTarget(name: "RustyBunsKitTests", dependencies: ["RustyBunsKit"]),
    ]
)
