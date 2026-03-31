import { chmodSync, constants, existsSync, statSync } from "node:fs";
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
 * Ensure a file has the executable permission bit set.
 * npm strips +x from files during pack/install, so we restore it at runtime.
 */
const ensureExecutable = (filePath: string): void => {
  try {
    const mode = statSync(filePath).mode;
    if (!(mode & constants.S_IXUSR)) {
      chmodSync(
        filePath,
        mode | constants.S_IXUSR | constants.S_IXGRP | constants.S_IXOTH,
      );
    }
  } catch {
    // Best-effort: if chmod fails, the caller will get a clear execFile error
  }
};

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
    ensureExecutable(bundledPath);
    return bundledPath;
  }

  return null;
};
