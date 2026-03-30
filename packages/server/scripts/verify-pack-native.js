#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir =
  process.env.KEPLR_SERVER_PACKAGE_DIR ?? path.dirname(__dirname);
const nativeDir = path.join(serverDir, "native", "macos");
const appBundlePath =
  process.env.KEPLR_BIOMETRIC_APP_BUNDLE ??
  path.join(nativeDir, "bin", "BiometricAuth.app");
const buildScript = path.join(nativeDir, "build.sh");

const ensureNativeBundle = () => {
  if (existsSync(appBundlePath)) {
    console.log(`Using packaged biometric bundle: ${appBundlePath}`);
    return;
  }

  if (process.platform === "darwin" && existsSync(buildScript)) {
    execFileSync(buildScript, {
      cwd: nativeDir,
      stdio: "inherit",
    });
  }

  if (!existsSync(appBundlePath)) {
    throw new Error(
      [
        "BiometricAuth.app is required when packing @keplr-wallet/keplr-wallet-mcp.",
        `Expected bundle at: ${appBundlePath}`,
        "Build the macOS helper first or download the release artifact into packages/server/native/macos/bin/.",
      ].join("\n"),
    );
  }
};

ensureNativeBundle();
