import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BINARY_SUBPATH = path.join(
  "native",
  "macos",
  "bin",
  "BiometricAuth.app",
  "Contents",
  "MacOS",
  "biometric-auth",
);

/**
 * Resolve the path to the macOS biometric-auth binary.
 *
 * Returns null if the binary is not available.
 */
export const resolveBiometricBinary = (): string | null => {
  if (process.platform !== "darwin") {
    return null;
  }

  const serverDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  const bundledPath = path.join(serverDir, BINARY_SUBPATH);
  if (existsSync(bundledPath)) {
    return bundledPath;
  }

  return null;
};
