// swift-tools-version:5.9
// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
import PackageDescription

let package = Package(
    name: "QViewKit",
    // Object Capture on an iPhone needs iOS 17 and LiDAR; the kit itself (GLB, export, the shop's API) also builds on a Mac.
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "QViewKit", targets: ["QViewKit"])],
    targets: [
        .target(name: "QViewKit"),
        .testTarget(name: "QViewKitTests", dependencies: ["QViewKit"]),
    ]
)
