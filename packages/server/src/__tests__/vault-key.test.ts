import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock keytar
vi.mock("keytar", () => ({
  default: {
    setPassword: vi.fn().mockResolvedValue(undefined),
    getPassword: vi.fn().mockResolvedValue(null),
    deletePassword: vi.fn().mockResolvedValue(true),
  },
}));

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock node:util promisify to return our mock
vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}));

// Mock fs.existsSync to control nativeAvailable()
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

// Mock native/resolve.js so BIOMETRIC_AUTH is a fixed non-null path at module load.
// nativeAvailable() is still controlled by existsSync mock.
vi.mock("../native/resolve.js", () => ({
  resolveBiometricBinary: () => "/mock/biometric-auth",
}));

// Mock auth/manager.js
vi.mock("../auth/manager.js", () => ({
  getAuthManager: vi.fn(() => ({}) as never),
}));

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import keytar from "keytar";

const mockKeytar = vi.mocked(keytar);
const mockExistsSync = vi.mocked(existsSync);
const mockExecFile = vi.mocked(execFile);

describe("vault-key", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false); // default: native unavailable
    Object.defineProperty(process, "platform", { value: originalPlatform });
    // Opt out of Layer 2 env guard: this test file mocks child_process and
    // fs.existsSync directly to exercise the native code path safely.
    delete process.env.__KEPLR_TEST_NO_NATIVE_KEYCHAIN;
  });

  afterAll(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  describe("storeVaultKey — keytar-only", () => {
    it("stores to keytar with write-verify, native not called", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true); // native available but should NOT be called

      const testKey = Buffer.alloc(32, 0xbb);
      mockKeytar.getPassword.mockResolvedValueOnce(testKey.toString("base64"));

      const { storeVaultKey } = await import("../vault-key.js");
      await storeVaultKey("test-account", testKey);

      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        "keplr-mcp-server",
        "test-account",
        testKey.toString("base64"),
      );
      // Native binary must NOT be called for store
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("throws when keytar write-verify fails", async () => {
      mockExistsSync.mockReturnValue(false);

      const testKey = Buffer.alloc(32, 0xee);
      mockKeytar.getPassword.mockResolvedValueOnce("wrong-value");

      const { storeVaultKey } = await import("../vault-key.js");

      await expect(storeVaultKey("test-account", testKey)).rejects.toThrow(
        "Keytar store write-verify failed",
      );
    });
  });

  describe("loadVaultKey — keytar-first with migration", () => {
    it("returns from keytar without calling native", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true); // native available

      const testKey = Buffer.from("a]b".repeat(10), "utf-8");
      mockKeytar.getPassword.mockResolvedValueOnce(testKey.toString("base64"));

      const { loadVaultKey } = await import("../vault-key.js");
      const result = await loadVaultKey("test-account");

      expect(result).not.toBeNull();
      expect(result!.equals(testKey)).toBe(true);
      // Native binary must NOT be called when keytar has the key
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("migrates from native to keytar when keytar empty", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      const nativeKey = Buffer.alloc(32, 0xaa);
      // keytar returns null (empty)
      mockKeytar.getPassword.mockResolvedValueOnce(null);
      // nativeLoad returns key
      mockExecFile.mockImplementationOnce((() => {
        return { stdout: nativeKey.toString("base64"), stderr: "" };
      }) as never);

      const { loadVaultKey } = await import("../vault-key.js");
      const result = await loadVaultKey("test-account");

      expect(result).not.toBeNull();
      expect(result!.equals(nativeKey)).toBe(true);
      // Should have stored back to keytar for future use
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        "keplr-mcp-server",
        "test-account",
        nativeKey.toString("base64"),
      );
    });

    it("returns null when both keytar and native empty", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      mockKeytar.getPassword.mockResolvedValueOnce(null);
      // nativeLoad returns empty stdout
      mockExecFile.mockImplementationOnce((() => {
        return { stdout: "", stderr: "" };
      }) as never);

      const { loadVaultKey } = await import("../vault-key.js");
      const result = await loadVaultKey("test-account");

      expect(result).toBeNull();
    });

    it("throws BiometricCancelledError when user cancels during migration", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      mockKeytar.getPassword.mockResolvedValueOnce(null);
      // nativeLoad throws BiometricCancelledError (user cancelled LAContext)
      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 1;
        err.stderr = "error:cancelled\n";
        throw err;
      }) as never);

      const { loadVaultKey, BiometricCancelledError } = await import(
        "../vault-key.js"
      );
      await expect(loadVaultKey("test-account")).rejects.toThrow(
        BiometricCancelledError,
      );
    });

    it("throws BiometricCancelledError when user cancels OS Keychain password prompt (errSecUserCanceled)", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      mockKeytar.getPassword.mockResolvedValueOnce(null);
      // nativeLoad with --skip-auth: OS Keychain prompt cancelled → errSecUserCanceled (-128)
      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 1;
        err.stderr = "error:keychain_get_failed:-128\n";
        throw err;
      }) as never);

      const { loadVaultKey, BiometricCancelledError } = await import(
        "../vault-key.js"
      );
      await expect(loadVaultKey("test-account")).rejects.toThrow(
        BiometricCancelledError,
      );
    });

    it("returns null when native throws non-cancel error during migration", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      mockKeytar.getPassword.mockResolvedValueOnce(null);
      // nativeLoad throws a non-cancel error (binary crash)
      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Unexpected binary crash") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 99;
        err.stderr = "segfault\n";
        throw err;
      }) as never);

      const { loadVaultKey } = await import("../vault-key.js");
      const result = await loadVaultKey("test-account");

      // Non-cancel migration failure is swallowed — returns null
      expect(result).toBeNull();
    });

    it("returns nativeKey even when keytar migration write fails", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      const nativeKey = Buffer.alloc(32, 0xdd);
      // keytar returns null (empty)
      mockKeytar.getPassword.mockResolvedValueOnce(null);
      // nativeLoad returns key
      mockExecFile.mockImplementationOnce((() => {
        return { stdout: nativeKey.toString("base64"), stderr: "" };
      }) as never);
      // keytar setPassword throws (migration write fails)
      mockKeytar.setPassword.mockRejectedValueOnce(
        new Error("Keytar write failed"),
      );

      const { loadVaultKey } = await import("../vault-key.js");
      const result = await loadVaultKey("test-account");

      // Key should still be returned despite migration failure
      expect(result).not.toBeNull();
      expect(result!.equals(nativeKey)).toBe(true);
    });

    it("returns null when no keytar entry and native unavailable", async () => {
      mockExistsSync.mockReturnValue(false); // native not available
      mockKeytar.getPassword.mockResolvedValueOnce(null);

      const { loadVaultKey } = await import("../vault-key.js");
      const result = await loadVaultKey("test-account");

      expect(result).toBeNull();
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  describe("nativeLoad — exit code handling", () => {
    it("should treat exit code 1 as not-found (return null)", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      // execFile throws with numeric exit code 1 (not found)
      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number | string;
          stderr?: string;
        };
        err.code = 1;
        err.stderr = "";
        throw err;
      }) as never);

      // No keytar entry either
      mockKeytar.getPassword.mockResolvedValue(null);

      const { loadVaultKey } = await import("../vault-key.js");
      const result = await loadVaultKey("test-account");
      expect(result).toBeNull();
    });

    it("should throw BiometricCancelledError when user cancels Touch ID", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      // vault-retrieve: user cancels → exit 1 + error:cancelled on stderr
      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 1;
        err.stderr = "error:cancelled\n";
        throw err;
      }) as never);

      // No keytar entry → triggers migration path
      mockKeytar.getPassword.mockResolvedValueOnce(null);

      const { loadVaultKey, BiometricCancelledError } = await import(
        "../vault-key.js"
      );
      // BiometricCancelledError now propagates through migration path
      await expect(loadVaultKey("test-account")).rejects.toThrow(
        BiometricCancelledError,
      );
    });
  });

  describe("nativeLoad — auth failed (error:failed) handling", () => {
    it("throws BiometricCancelledError when auth fails during migration", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 1;
        err.stderr = "error:failed\n";
        throw err;
      }) as never);

      mockKeytar.getPassword.mockResolvedValueOnce(null);

      const { loadVaultKey, BiometricCancelledError } = await import(
        "../vault-key.js"
      );
      await expect(loadVaultKey("test-account")).rejects.toThrow(
        BiometricCancelledError,
      );
    });
  });

  describe("loadVaultKey — user fallback (Use Password on biometrics-only prompt)", () => {
    it("throws BiometricCancelledError when user triggers password fallback during migration", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 1;
        err.stderr = "error:fallback\n";
        throw err;
      }) as never);

      mockKeytar.getPassword.mockResolvedValueOnce(null);

      const { loadVaultKey, BiometricCancelledError } = await import(
        "../vault-key.js"
      );
      await expect(loadVaultKey("test-account")).rejects.toThrow(
        BiometricCancelledError,
      );
    });
  });

  describe("deleteVaultKey — biometric cancel (fail-closed)", () => {
    it("throws BiometricCancelledError on cancel, does NOT delete keytar entry", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      // nativeDelete: user cancels Touch ID
      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 2;
        err.stderr = "error:cancelled\n";
        throw err;
      }) as never);

      const { deleteVaultKey, BiometricCancelledError } = await import(
        "../vault-key.js"
      );
      await expect(deleteVaultKey("test-account")).rejects.toThrow(
        BiometricCancelledError,
      );

      // Must NOT clean up keytar (user refused the operation)
      expect(mockKeytar.deletePassword).not.toHaveBeenCalled();
    });

    it("proceeds normally when biometric unavailable (non-cancel)", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      // nativeDelete: biometric unavailable (exit 2, no error:cancelled)
      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 2;
        err.stderr = "error:biometric_unavailable\n";
        throw err;
      }) as never);

      const { deleteVaultKey } = await import("../vault-key.js");
      await deleteVaultKey("test-account");

      // Should still clean up keytar (biometric unavailable, best-effort cleanup)
      expect(mockKeytar.deletePassword).toHaveBeenCalled();
    });

    it("throws BiometricCancelledError when user cancels OS Keychain password prompt during delete", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      // nativeDelete with --skip-auth: OS Keychain prompt cancelled → errSecUserCanceled
      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 4;
        err.stderr = "error:keychain_delete_failed:-128\n";
        throw err;
      }) as never);

      const { deleteVaultKey, BiometricCancelledError } = await import(
        "../vault-key.js"
      );
      await expect(deleteVaultKey("test-account")).rejects.toThrow(
        BiometricCancelledError,
      );

      // Must NOT clean up keytar (user refused the operation)
      expect(mockKeytar.deletePassword).not.toHaveBeenCalled();
    });

    it("throws on unknown native errors (OS Keychain denial), does NOT delete keytar entry", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      // nativeDelete: OS-level Keychain error (not user-cancelled)
      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("The operation was denied") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 4;
        err.stderr = "error:keychain_delete_failed:-25299\n";
        throw err;
      }) as never);

      const { deleteVaultKey } = await import("../vault-key.js");
      await expect(deleteVaultKey("test-account")).rejects.toThrow(
        "The operation was denied",
      );

      // Must NOT clean up keytar (native deletion failed)
      expect(mockKeytar.deletePassword).not.toHaveBeenCalled();
    });
  });

  describe("checkVaultKeyInNative — exit code handling", () => {
    it("should return 'missing' when vault-check exits with code 1 (not found)", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 1;
        err.stderr = "";
        throw err;
      }) as never);

      const { checkVaultKeyInNative } = await import("../vault-key.js");
      const result = await checkVaultKeyInNative("test-account");
      expect(result).toBe("missing");
    });

    it("should return 'accessible' when vault-check exits with code 0", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      mockExecFile.mockImplementationOnce((() => {
        return { stdout: "exists", stderr: "" };
      }) as never);

      const { checkVaultKeyInNative } = await import("../vault-key.js");
      const result = await checkVaultKeyInNative("test-account");
      expect(result).toBe("accessible");
    });

    it("should return 'error' for unexpected exit codes", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      mockExecFile.mockImplementationOnce((() => {
        const err = new Error("Command failed") as Error & {
          code?: number;
          stderr?: string;
        };
        err.code = 4;
        err.stderr = "error:keychain_check_failed:-25300\n";
        throw err;
      }) as never);

      const { checkVaultKeyInNative } = await import("../vault-key.js");
      const result = await checkVaultKeyInNative("test-account");
      expect(result).toBe("error");
    });

    it("should return 'missing' when native binary is not available", async () => {
      mockExistsSync.mockReturnValue(false);

      const { checkVaultKeyInNative } = await import("../vault-key.js");
      const result = await checkVaultKeyInNative("test-account");
      expect(result).toBe("missing");
    });
  });
});
