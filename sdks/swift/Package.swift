// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Pushlane",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "Pushlane", targets: ["Pushlane"])],
    targets: [
        .target(name: "Pushlane"),
        .testTarget(name: "PushlaneTests", dependencies: ["Pushlane"])
    ]
)
