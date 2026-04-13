// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SystemAudioCaptureHelper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "SystemAudioCaptureHelper", targets: ["SystemAudioCaptureHelper"])
    ],
    targets: [
        .executableTarget(
            name: "SystemAudioCaptureHelper",
            path: "Sources/SystemAudioCaptureHelper"
        )
    ]
)
