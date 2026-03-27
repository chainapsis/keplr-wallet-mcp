#!/usr/bin/env node
/**
 * Build native modules for the current platform.
 *
 * This script is run automatically after TypeScript compilation (postbuild).
 * It builds platform-specific native modules required for biometric authentication.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.dirname(__dirname);

/**
 * Build macOS Touch ID native module
 */
function buildMacOS() {
  const nativeDir = path.join(serverDir, "native", "macos");
  const buildScript = path.join(nativeDir, "build.sh");

  if (!existsSync(buildScript)) {
    console.log("⏭️  macOS native module not found, skipping...");
    return;
  }

  console.log("🔨 Building macOS biometric-auth CLI...");

  try {
    execSync("./build.sh", {
      cwd: nativeDir,
      stdio: "inherit",
    });
    console.log("✅ macOS biometric-auth built successfully");
  } catch (error) {
    console.error("⚠️  Failed to build macOS biometric-auth:", error.message);
    console.error("   Biometric authentication will not be available.");
    // Don't fail the build - biometric is optional
  }
}

/**
 * Main entry point
 */
function main() {
  const platform = process.platform;

  console.log(`\n📦 Building native modules for ${platform}...\n`);

  switch (platform) {
    case "darwin":
      buildMacOS();
      break;

    case "linux":
      // Linux uses fprintd which is a system package, no build needed
      console.log("ℹ️  Linux uses fprintd - no native build required.");
      console.log("   Install fprintd and enroll fingerprints: fprintd-enroll");
      break;

    case "win32":
      // Windows Hello implementation is not yet available
      console.log("ℹ️  Windows Hello support coming soon.");
      break;

    default:
      console.log(`ℹ️  No native modules for platform: ${platform}`);
  }

  console.log("\n");
}

main();
