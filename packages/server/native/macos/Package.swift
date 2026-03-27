// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "BiometricAuth",
    platforms: [
        .macOS(.v12)
    ],
    targets: [
        .executableTarget(
            name: "biometric-auth",
            path: "Sources"
        )
    ]
)
