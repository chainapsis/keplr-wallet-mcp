import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const BINARY_SUBPATH = path.join(
  "bin",
  "BiometricAuth.app",
  "Contents",
  "MacOS",
  "biometric-auth",
);

/**
 * Resolve the path to the macOS biometric-auth binary.
 *
 * Resolution order:
 * 1. @keplr-wallet/biometric-darwin optionalDependency (npm install path)
 * 2. Local native/macos/bin/ (development fallback)
 *
 * Returns null if the binary is not available.
 */
export const resolveBiometricBinary = (): string | null => {
  if (process.platform !== "darwin") {
    return null;
  }

  // 1. Try optionalDependency package
  try {
    const pkgDir = path.dirname(
      require.resolve("@keplr-wallet/biometric-darwin/package.json"),
    );
    const binPath = path.join(pkgDir, BINARY_SUBPATH);
    if (existsSync(binPath)) {
      return binPath;
    }
  } catch {
    // Package not installed — fall through to local build
  }

  // 2. Fallback: local native build (development)
  const serverDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const localPath = path.join(serverDir, "native", "macos", BINARY_SUBPATH);
  if (existsSync(localPath)) {
    return localPath;
  }

  return null;
};
