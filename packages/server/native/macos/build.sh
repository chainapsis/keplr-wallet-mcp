#!/bin/bash
#
# Build script for macOS biometric authentication CLI tool
#
# This script builds the Swift CLI tool as a universal binary (arm64 + x86_64)
# and creates an app bundle which is required for Touch ID to work properly.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build"
OUTPUT_DIR="$SCRIPT_DIR/bin"
APP_NAME="BiometricAuth"
BUNDLE_ID="com.keplr.biometric-auth"

echo "Building biometric-auth CLI tool (universal binary)..."

cd "$SCRIPT_DIR"

# Build for arm64
swift build -c release
cp "$BUILD_DIR/release/biometric-auth" "/tmp/biometric-auth-arm64"

# Build for x86_64
swift build -c release --triple x86_64-apple-macosx
cp "$BUILD_DIR/release/biometric-auth" "/tmp/biometric-auth-x86_64"

# Create universal binary
mkdir -p "$OUTPUT_DIR"
lipo -create /tmp/biometric-auth-arm64 /tmp/biometric-auth-x86_64 \
  -output "$OUTPUT_DIR/biometric-auth"

rm -f /tmp/biometric-auth-arm64 /tmp/biometric-auth-x86_64

echo "Build complete: $OUTPUT_DIR/biometric-auth"
lipo -info "$OUTPUT_DIR/biometric-auth"

# Create an app bundle for Touch ID support
# Touch ID requires the binary to be inside a signed app bundle
echo "Creating app bundle..."

APP_BUNDLE="$OUTPUT_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"

# Clean previous bundle
rm -rf "$APP_BUNDLE"

# Create bundle structure
mkdir -p "$MACOS_DIR"

# Copy binary into bundle
cp "$OUTPUT_DIR/biometric-auth" "$MACOS_DIR/biometric-auth"

# Create Info.plist
cat > "$CONTENTS_DIR/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>biometric-auth</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSFaceIDUsageDescription</key>
    <string>Keplr MCP Server needs to verify your identity to sign transactions.</string>
</dict>
</plist>
EOF

# Ad-hoc sign the bundle (sufficient for Touch ID protected software keys)
echo "Signing app bundle with ad-hoc signature..."
codesign --force --deep --sign - "$APP_BUNDLE"

echo "App bundle created: $APP_BUNDLE"
echo ""
echo "The biometric-auth CLI is ready to use."
echo "Usage:"
echo "  $MACOS_DIR/biometric-auth check"
echo "  $MACOS_DIR/biometric-auth auth \"Reason for authentication\""
