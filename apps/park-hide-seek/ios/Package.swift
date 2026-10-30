// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ParkKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "ParkKit", targets: ["ParkKit"])],
    targets: [
        .target(name: "ParkKit"),
        .testTarget(name: "ParkKitTests", dependencies: ["ParkKit"]),
    ]
)
