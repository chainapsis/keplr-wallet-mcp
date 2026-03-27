/**
 * Biometric Provider Unit Tests
 */

import * as childProcess from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BiometricImpl,
  BiometricProvider,
  createBiometricProvider,
} from "../../auth/providers/biometric.js";
import type { AuthContext } from "../../auth/types.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

describe("BiometricProvider", () => {
  let provider: BiometricProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BiometricProvider();
    // Force impl to null to avoid real system calls in basic tests
    // @ts-expect-error - accessing private property for testing
    provider.impl = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("basic properties", () => {
    it("should have correct id", () => {
      expect(provider.id).toBe("biometric");
    });

    it("should have correct name", () => {
      expect(provider.name).toBe("Biometric (Touch ID / Face ID)");
    });
  });

  describe("isAvailable", () => {
    it("should return false when impl is null", async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe("setup", () => {
    it("should fail when impl is null", async () => {
      const result = await provider.setup({});

      expect(result.success).toBe(false);
      expect(result.error).toContain("not available");
    });
  });

  describe("authenticate", () => {
    it("should fail when impl is null", async () => {
      const context: AuthContext = { action: "delete_account" };
      const result = await provider.authenticate(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not supported");
    });
  });

  describe("disable", () => {
    it("should complete without error", async () => {
      await expect(provider.disable()).resolves.toBeUndefined();
    });
  });

  describe("factory function", () => {
    it("should create a new provider instance", () => {
      const newProvider = createBiometricProvider();

      expect(newProvider).toBeInstanceOf(BiometricProvider);
      expect(newProvider.id).toBe("biometric");
    });
  });
});

/**
 * Test with mock BiometricImpl
 */
describe("BiometricProvider with mock impl", () => {
  let provider: BiometricProvider;
  let mockImpl: BiometricImpl;

  beforeEach(() => {
    mockImpl = {
      isAvailable: vi.fn().mockResolvedValue(true),
      authenticate: vi.fn().mockResolvedValue(undefined),
    };

    // Create provider and inject mock impl via reflection
    provider = new BiometricProvider();
    // @ts-expect-error - accessing private property for testing
    provider.impl = mockImpl;
  });

  describe("isAvailable", () => {
    it("should return true when impl is available", async () => {
      const available = await provider.isAvailable();

      expect(available).toBe(true);
      expect(mockImpl.isAvailable).toHaveBeenCalled();
    });

    it("should return false when impl is not available", async () => {
      vi.mocked(mockImpl.isAvailable).mockResolvedValue(false);

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("setup", () => {
    it("should succeed when biometric is available", async () => {
      const result = await provider.setup({ account: "test" });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.message).toContain("available");
    });

    it("should fail when biometric is not available", async () => {
      vi.mocked(mockImpl.isAvailable).mockResolvedValue(false);

      const result = await provider.setup({});

      expect(result.success).toBe(false);
      expect(result.error).toContain("not available");
    });
  });

  describe("authenticate", () => {
    it("should succeed when authentication passes", async () => {
      const context: AuthContext = {
        action: "delete_account",
        summary: "Send 1 ATOM",
      };

      const result = await provider.authenticate(context);

      expect(result.success).toBe(true);
      expect(mockImpl.authenticate).toHaveBeenCalledWith(
        expect.stringContaining("Delete account"),
      );
    });

    it("should include summary in auth reason", async () => {
      const context: AuthContext = {
        action: "delete_account",
        summary: "Send 100 OSMO to cosmos1...",
      };

      await provider.authenticate(context);

      expect(mockImpl.authenticate).toHaveBeenCalledWith(
        expect.stringContaining("Send 100 OSMO to cosmos1..."),
      );
    });

    it("should build auth reason with amount and chain", async () => {
      const context: AuthContext = {
        action: "delete_account",
        amount: "1 ATOM",
        chain: "cosmoshub-4",
      };

      await provider.authenticate(context);

      expect(mockImpl.authenticate).toHaveBeenCalledWith(
        expect.stringContaining("1 ATOM on cosmoshub-4"),
      );
    });

    it("should handle delete_account action", async () => {
      const context: AuthContext = {
        action: "delete_account",
      };

      await provider.authenticate(context);

      expect(mockImpl.authenticate).toHaveBeenCalledWith(
        expect.stringContaining("Delete account"),
      );
    });

    it("should handle delete_account action", async () => {
      const context: AuthContext = {
        action: "delete_account",
      };

      await provider.authenticate(context);

      expect(mockImpl.authenticate).toHaveBeenCalledWith(
        expect.stringContaining("Delete account"),
      );
    });

    it("should handle delete_account action (import replaced)", async () => {
      const context: AuthContext = {
        action: "delete_account",
      };

      await provider.authenticate(context);

      expect(mockImpl.authenticate).toHaveBeenCalledWith(
        expect.stringContaining("Delete account"),
      );
    });

    it("should still attempt auth when biometric is not available (device-owner fallback)", async () => {
      vi.mocked(mockImpl.isAvailable).mockResolvedValue(false);

      const context: AuthContext = { action: "delete_account" };
      const result = await provider.authenticate(context);

      // With --device-owner, auth proceeds via system password even when biometric is unavailable
      expect(result.success).toBe(true);
      expect(mockImpl.authenticate).toHaveBeenCalled();
    });

    it("should handle authentication error", async () => {
      vi.mocked(mockImpl.authenticate).mockRejectedValue(
        new Error("Touch ID failed"),
      );

      const context: AuthContext = { action: "delete_account" };
      const result = await provider.authenticate(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Touch ID failed");
    });

    it("should detect user cancellation", async () => {
      vi.mocked(mockImpl.authenticate).mockRejectedValue(
        new Error("User cancelled authentication"),
      );

      const context: AuthContext = { action: "delete_account" };
      const result = await provider.authenticate(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("cancelled by user");
    });
  });
});

/**
 * Linux fprintd implementation tests
 */
describe("Linux fprintd implementation", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock platform as linux
    Object.defineProperty(process, "platform", { value: "linux" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  describe("isAvailable", () => {
    it("should return true when fprintd is installed and fingerprints enrolled", async () => {
      // Mock execFile for 'which' commands and fprintd-list
      const execFileMock = vi.mocked(childProcess.execFile);
      execFileMock.mockImplementation(((
        file: string,
        args?: string[] | undefined,
        optionsOrCallback?: unknown,
        callback?: (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) => {
        // Handle both 3-arg and 4-arg overloads
        const cb =
          typeof optionsOrCallback === "function"
            ? (optionsOrCallback as typeof callback)
            : callback;

        if (file === "which" && args?.[0] === "fprintd-verify") {
          cb?.(null, { stdout: "/usr/bin/fprintd-verify\n", stderr: "" });
        } else if (file === "which" && args?.[0] === "fprintd-list") {
          cb?.(null, { stdout: "/usr/bin/fprintd-list\n", stderr: "" });
        } else {
          // fprintd-list enrollment check
          cb?.(null, {
            stdout: "  - #0: right-index-finger\n  - #1: left-index-finger\n",
            stderr: "",
          });
        }
        return {} as ReturnType<typeof childProcess.execFile>;
      }) as typeof childProcess.execFile);

      const provider = createBiometricProvider();
      const available = await provider.isAvailable();

      expect(available).toBe(true);
    });

    it("should return false when fprintd is not installed", async () => {
      const execFileMock = vi.mocked(childProcess.execFile);
      execFileMock.mockImplementation(((
        file: string,
        args?: string[] | undefined,
        optionsOrCallback?: unknown,
        callback?: (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) => {
        const cb =
          typeof optionsOrCallback === "function"
            ? (optionsOrCallback as typeof callback)
            : callback;

        if (file === "which") {
          const error = new Error("command not found");
          cb?.(error, { stdout: "", stderr: "" });
        }
        return {} as ReturnType<typeof childProcess.execFile>;
      }) as typeof childProcess.execFile);

      const provider = createBiometricProvider();
      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it("should return false when no fingerprints enrolled", async () => {
      const execFileMock = vi.mocked(childProcess.execFile);
      execFileMock.mockImplementation(((
        file: string,
        args?: string[] | undefined,
        optionsOrCallback?: unknown,
        callback?: (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) => {
        const cb =
          typeof optionsOrCallback === "function"
            ? (optionsOrCallback as typeof callback)
            : callback;

        if (file === "which" && args?.[0] === "fprintd-verify") {
          cb?.(null, { stdout: "/usr/bin/fprintd-verify\n", stderr: "" });
        } else if (file === "which" && args?.[0] === "fprintd-list") {
          cb?.(null, { stdout: "/usr/bin/fprintd-list\n", stderr: "" });
        } else {
          // fprintd-list enrollment check
          cb?.(null, {
            stdout: "user has no enrolled fingerprints",
            stderr: "",
          });
        }
        return {} as ReturnType<typeof childProcess.execFile>;
      }) as typeof childProcess.execFile);

      const provider = createBiometricProvider();
      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });
  });
});

/**
 * macOS Touch ID implementation tests
 */
describe("macOS Touch ID implementation", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock platform as darwin (macOS)
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  describe("authenticate error handling", () => {
    it("should handle user cancellation error", async () => {
      const provider = new BiometricProvider();
      const mockImpl: BiometricImpl = {
        isAvailable: vi.fn().mockResolvedValue(true),
        authenticate: vi.fn().mockRejectedValue(new Error("cancelled")),
      };
      // @ts-expect-error - accessing private property for testing
      provider.impl = mockImpl;

      const result = await provider.authenticate({
        action: "delete_account",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("cancelled by user");
    });

    it("should handle lockout error", async () => {
      const provider = new BiometricProvider();
      const mockImpl: BiometricImpl = {
        isAvailable: vi.fn().mockResolvedValue(true),
        authenticate: vi
          .fn()
          .mockRejectedValue(
            new Error(
              "Biometric authentication is locked due to too many failed attempts",
            ),
          ),
      };
      // @ts-expect-error - accessing private property for testing
      provider.impl = mockImpl;

      const result = await provider.authenticate({
        action: "delete_account",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("locked");
    });

    it("should handle timeout error", async () => {
      const provider = new BiometricProvider();
      const mockImpl: BiometricImpl = {
        isAvailable: vi.fn().mockResolvedValue(true),
        authenticate: vi
          .fn()
          .mockRejectedValue(new Error("Authentication timed out")),
      };
      // @ts-expect-error - accessing private property for testing
      provider.impl = mockImpl;

      const result = await provider.authenticate({
        action: "delete_account",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });
  });
});
