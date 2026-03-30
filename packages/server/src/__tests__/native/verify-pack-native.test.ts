import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = path.resolve(
  process.cwd(),
  "packages",
  "server",
  "scripts",
  "verify-pack-native.js",
);

const tempDirs: string[] = [];

const createTempDir = () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "verify-pack-native-"));
  tempDirs.push(tempDir);
  return tempDir;
};

const createFakeBundle = (serverDir: string) => {
  const binaryPath = path.join(
    serverDir,
    "native",
    "macos",
    "bin",
    "BiometricAuth.app",
    "Contents",
    "MacOS",
    "biometric-auth",
  );
  mkdirSync(path.dirname(binaryPath), { recursive: true });
  writeFileSync(binaryPath, "biometric");
};

describe("verify-pack-native", () => {
  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("passes when the bundled app is present", () => {
    const serverDir = createTempDir();
    createFakeBundle(serverDir);

    expect(() =>
      execFileSync("node", [scriptPath], {
        env: {
          ...process.env,
          KEPLR_SERVER_PACKAGE_DIR: serverDir,
        },
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("fails fast when the bundled app is missing", () => {
    const serverDir = createTempDir();

    expect(() =>
      execFileSync("node", [scriptPath], {
        env: {
          ...process.env,
          KEPLR_SERVER_PACKAGE_DIR: serverDir,
        },
        stdio: "pipe",
      }),
    ).toThrow(/BiometricAuth\.app is required/);
  });
});
