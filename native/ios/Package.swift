// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "RustyBunsKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "RustyBunsKit", targets: ["RustyBunsKit"])],
    targets: [
        .target(name: "RustyBunsKit"),
        .testTarget(name: "RustyBunsKitTests", dependencies: ["RustyBunsKit"]),
    ]
)
