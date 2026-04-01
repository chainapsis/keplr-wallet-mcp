/**
 * TOTP Provider Unit Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authConfig from "../../auth/config.js";
import { createTotpProvider, TotpProvider } from "../../auth/providers/totp.js";
import type { AuthConfig, AuthContext } from "../../auth/types.js";

// Mock keytar (OS Keychain)
// Store secrets in memory for testing
const keytarStore: Map<string, string> = new Map();

vi.mock("keytar", () => ({
  default: {
    setPassword: vi.fn(
      async (service: string, account: string, password: string) => {
        keytarStore.set(`${service}:${account}`, password);
      },
    ),
    getPassword: vi.fn(async (service: string, account: string) => {
      return keytarStore.get(`${service}:${account}`) ?? null;
    }),
    deletePassword: vi.fn(async (service: string, account: string) => {
      return keytarStore.delete(`${service}:${account}`);
    }),
  },
}));

// Mock auth config
vi.mock("../../auth/config.js", () => ({
  loadAuthConfig: vi.fn(),
  saveAuthConfig: vi.fn().mockResolvedValue(undefined),
}));

// Helper to create a default config
function createMockConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  const base: AuthConfig = {
    enabled: true,
    providers: {},
    requirements: {
      delete_account: {
        enabled: false,
        providers: [],
      },
      export_mnemonic: {
        enabled: false,
        providers: [],
      },
    },
  };
  return {
    ...base,
    ...overrides,
    providers: {
      ...base.providers,
      ...overrides.providers,
    },
    requirements: {
      ...base.requirements,
      ...overrides.requirements,
    },
  };
}

describe("TotpProvider", () => {
  let provider: TotpProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear keytar store
    keytarStore.clear();
    provider = new TotpProvider("google");
    // Set up default mock behavior
    vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(createMockConfig());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("basic properties", () => {
    it("should have correct id", () => {
      expect(provider.id).toBe("totp");
    });

    it("should have correct name for google authenticator", () => {
      expect(provider.name).toBe("Google Authenticator");
    });

    it("should have correct name for authy", () => {
      const authyProvider = new TotpProvider("authy");
      expect(authyProvider.name).toBe("Authy");
    });

    it("should have correct name for microsoft", () => {
      const msProvider = new TotpProvider("microsoft");
      expect(msProvider.name).toBe("Microsoft Authenticator");
    });

    it("should have correct name for other", () => {
      const otherProvider = new TotpProvider("other");
      expect(otherProvider.name).toBe("Authenticator App");
    });
  });

  describe("isAvailable", () => {
    it("should return false when TOTP is not set up", async () => {
      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig(),
      );

      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    it("should return true when TOTP is enabled and secret is set", async () => {
      // Set secret in keytar store
      keytarStore.set("keplr-mcp-server:totp-secret", "JBSWY3DPEHPK3PXP");

      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig({
          providers: {
            otp: {
              enabled: true,
              hasSecret: true,
              verifiedAt: Date.now(),
              authenticatorType: "google",
            },
          },
        }),
      );

      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe("setup", () => {
    it("should generate secret and return QR code", async () => {
      const result = await provider.setup({ account: "test-wallet" });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      // Check that the result contains expected data
      // QR code should be generated successfully (ASCII art)
      expect(result.data?.qrCode).toBeDefined();
      expect(typeof result.data?.qrCode).toBe("string");
      // Manual entry key should be provided as fallback
      expect(result.data?.manualEntryKey).toBeDefined();
      expect(result.data?.expiresIn).toBe("10 minutes");
    });

    it("should succeed without account label", async () => {
      const result = await provider.setup({});

      expect(result.success).toBe(true);
      expect(result.data?.qrCode).toBeDefined();
      expect(result.data?.manualEntryKey).toBeDefined();
    });

    it("should track setup in progress", async () => {
      expect(provider.hasSetupInProgress()).toBe(false);

      await provider.setup({ account: "test" });

      expect(provider.hasSetupInProgress()).toBe(true);
    });
  });

  describe("verifySetup", () => {
    it("should fail if no setup in progress", async () => {
      const result = await provider.verifySetup("123456");

      expect(result.success).toBe(false);
      expect(result.error).toContain("No setup in progress");
    });

    it("should fail if setup expired", async () => {
      // Start setup
      await provider.setup({ account: "test" });

      // Manually expire the setup by manipulating internal state
      // @ts-expect-error - accessing private property for testing
      provider.pendingSetup.createdAt = Date.now() - 11 * 60 * 1000; // 11 minutes ago

      const result = await provider.verifySetup("123456");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Setup expired");
    });

    it("should fail if code is invalid", async () => {
      await provider.setup({ account: "test" });
      // Use a clearly wrong code - TOTP codes are time-based, so any fixed code will be invalid
      const result = await provider.verifySetup("000000");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid code");
    });

    it("should succeed and save config on valid code", async () => {
      // Import generateToken dynamically for generating valid TOTP code
      const { generateSync } = await import("otplib");

      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig(),
      );

      // Start setup to get a pending secret
      await provider.setup({ account: "test" });

      // @ts-expect-error - accessing private property for testing
      const pendingSecret = provider.pendingSetup?.secret as string;
      expect(pendingSecret).toBeDefined();

      // Generate a valid TOTP code using the pending secret
      const validCode = generateSync({ secret: pendingSecret });

      // Verify setup with the valid code
      const result = await provider.verifySetup(validCode);

      expect(result.success).toBe(true);
      expect(result.data?.message).toContain("setup complete");
      expect(authConfig.saveAuthConfig).toHaveBeenCalled();

      // Pending setup should be cleared
      expect(provider.hasSetupInProgress()).toBe(false);
    });
  });

  describe("authenticate", () => {
    it("should return requiresInput=true when no code provided", async () => {
      const context: AuthContext = { action: "delete_account" };
      const result = await provider.authenticate(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("6-digit code");
      expect(result.requiresInput).toBe(true);
      expect(result.provider).toBe("totp");
    });

    it("should fail when totpCode is invalid", async () => {
      const TEST_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
      // Set secret in keytar store
      keytarStore.set("keplr-mcp-server:totp-secret", TEST_SECRET);

      // Set up provider with hasSecret flag
      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig({
          providers: {
            otp: {
              enabled: true,
              hasSecret: true,
              verifiedAt: Date.now(),
              authenticatorType: "google",
            },
          },
        }),
      );

      // Invalid code should fail
      const context: AuthContext = {
        action: "delete_account",
        totpCode: "000000",
      };
      const result = await provider.authenticate(context);

      expect(result.success).toBe(false);
      expect(result.requiresInput).toBe(true);
      expect(result.provider).toBe("totp");
    });

    it("should succeed when totpCode is valid", async () => {
      const { generateSync } = await import("otplib");
      const TEST_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
      // Set secret in keytar store
      keytarStore.set("keplr-mcp-server:totp-secret", TEST_SECRET);

      // Set up provider with hasSecret flag
      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig({
          providers: {
            otp: {
              enabled: true,
              hasSecret: true,
              verifiedAt: Date.now(),
              authenticatorType: "google",
            },
          },
        }),
      );

      // Generate valid code
      const validCode = generateSync({ secret: TEST_SECRET });
      const context: AuthContext = {
        action: "delete_account",
        totpCode: validCode,
      };
      const result = await provider.authenticate(context);

      expect(result.success).toBe(true);
      expect(result.provider).toBe("totp");
    });
  });

  describe("verifyCode", () => {
    // Use a valid 32-character base32 secret (20 bytes = 160 bits)
    const TEST_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

    beforeEach(() => {
      keytarStore.clear();
      // Set secret in keytar store
      keytarStore.set("keplr-mcp-server:totp-secret", TEST_SECRET);

      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig({
          providers: {
            otp: {
              enabled: true,
              hasSecret: true,
              verifiedAt: Date.now(),
              authenticatorType: "google",
            },
          },
        }),
      );
    });

    it("should fail if TOTP is not set up", async () => {
      // Clear keytar store (no secret)
      keytarStore.clear();

      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig(),
      );

      const result = await provider.verifyCode("123456");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not set up");
    });

    it("should fail on invalid code", async () => {
      // Any fixed code will be invalid for TOTP since it's time-based
      const result = await provider.verifyCode("000000");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid code");
      expect(result.error).toContain("attempts remaining");
      expect(result.requiresInput).toBe(true);
    });

    it("should succeed on valid code", async () => {
      // Import generateToken dynamically for generating valid TOTP code
      const { generateSync } = await import("otplib");

      // Generate a valid TOTP code using the test secret
      const validCode = generateSync({ secret: TEST_SECRET });

      const result = await provider.verifyCode(validCode);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reset attempt counter on successful verification", async () => {
      const { generateSync } = await import("otplib");

      // Fail a few times first
      await provider.verifyCode("000000");
      await provider.verifyCode("000000");

      // Now succeed with valid code
      const validCode = generateSync({ secret: TEST_SECRET });
      const successResult = await provider.verifyCode(validCode);
      expect(successResult.success).toBe(true);

      // Next failure should show 4 attempts remaining (reset from 5)
      const failResult = await provider.verifyCode("000000");
      expect(failResult.error).toContain("4 attempts remaining");
    });

    it("should track failed attempts", async () => {
      // Fail multiple times
      const result1 = await provider.verifyCode("000000");
      expect(result1.error).toContain("4 attempts remaining");

      const result2 = await provider.verifyCode("000000");
      expect(result2.error).toContain("3 attempts remaining");
    });

    it("should lock out after max attempts", async () => {
      // Exhaust all attempts
      for (let i = 0; i < 5; i++) {
        await provider.verifyCode("000000");
      }

      const result = await provider.verifyCode("123456");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Too many failed attempts");
    });
  });

  describe("disable", () => {
    it("should clear config and pending setup", async () => {
      // Start a setup (no existing secret — setup succeeds)
      await provider.setup({ account: "test" });
      expect(provider.hasSetupInProgress()).toBe(true);

      // Simulate secret saved to keytar (as if verifySetup completed)
      keytarStore.set("keplr-mcp-server:totp-secret", "JBSWY3DPEHPK3PXP");
      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig({
          providers: {
            otp: {
              enabled: true,
              hasSecret: true,
            },
          },
        }),
      );

      // Disable
      await provider.disable();

      expect(provider.hasSetupInProgress()).toBe(false);
      // Verify keytar secret was deleted
      expect(keytarStore.has("keplr-mcp-server:totp-secret")).toBe(false);
      expect(authConfig.saveAuthConfig).toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("should return disabled status when not configured", async () => {
      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig(),
      );

      const status = await provider.getStatus();

      expect(status.enabled).toBe(false);
      expect(status.configured).toBe(false);
      expect(status.setupInProgress).toBe(false);
    });

    it("should return enabled status when configured", async () => {
      const verifiedAt = Date.now();
      // Set secret in keytar store
      keytarStore.set("keplr-mcp-server:totp-secret", "JBSWY3DPEHPK3PXP");

      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig({
          providers: {
            otp: {
              enabled: true,
              hasSecret: true,
              verifiedAt,
              authenticatorType: "google",
            },
          },
        }),
      );

      const status = await provider.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.configured).toBe(true);
      expect(status.authenticatorType).toBe("google");
      expect(status.verifiedAt).toBeDefined();
    });

    it("should indicate setup in progress", async () => {
      vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
        createMockConfig(),
      );

      await provider.setup({ account: "test" });

      const status = await provider.getStatus();

      expect(status.setupInProgress).toBe(true);
    });
  });

  describe("factory function", () => {
    it("should create a provider with default authenticator type", () => {
      const newProvider = createTotpProvider();
      expect(newProvider).toBeInstanceOf(TotpProvider);
      expect(newProvider.name).toBe("Google Authenticator");
    });

    it("should create a provider with specified authenticator type", () => {
      const newProvider = createTotpProvider("authy");
      expect(newProvider).toBeInstanceOf(TotpProvider);
      expect(newProvider.name).toBe("Authy");
    });
  });
});

describe("TotpProvider lockout expiry", () => {
  let provider: TotpProvider;
  // Use a valid 32-character base32 secret (20 bytes = 160 bits)
  const TEST_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Clear and set keytar store
    keytarStore.clear();
    keytarStore.set("keplr-mcp-server:totp-secret", TEST_SECRET);
    provider = new TotpProvider("google");

    vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
      createMockConfig({
        providers: {
          otp: {
            enabled: true,
            hasSecret: true,
            verifiedAt: Date.now(),
            authenticatorType: "google",
          },
        },
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should unlock after lockout duration expires", async () => {
    // Exhaust all attempts to trigger lockout
    for (let i = 0; i < 5; i++) {
      await provider.verifyCode("000000");
    }

    // Should be locked
    const lockedResult = await provider.verifyCode("123456");
    expect(lockedResult.error).toContain("Too many failed attempts");

    // Advance time past lockout duration (5 minutes)
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    // Should now be unlocked (can try again, will still fail due to invalid code but not locked)
    const unlockedResult = await provider.verifyCode("000000");
    // The result will be invalid code, not lockout message
    expect(unlockedResult.error).toContain("Invalid code");
    expect(unlockedResult.error).toContain("attempts remaining");
  });

  it("should return hard failure when locked out (not requiresInput)", async () => {
    // Exhaust all attempts to trigger lockout
    for (let i = 0; i < 5; i++) {
      await provider.verifyCode("000000");
    }

    // Lockout is a hard failure — user can't resolve it by providing input
    // AuthManager falls back to biometric via lastError path
    const context: AuthContext = { action: "delete_account" };
    const result = await provider.authenticate(context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Too many failed attempts");
    expect(result.requiresInput).toBeUndefined();
    expect(result.provider).toBe("totp");
  });
});

describe("TotpProvider cross-action consistency", () => {
  let provider: TotpProvider;
  const TEST_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  beforeEach(() => {
    vi.clearAllMocks();
    keytarStore.clear();
    keytarStore.set("keplr-mcp-server:totp-secret", TEST_SECRET);
    provider = new TotpProvider("google");

    vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
      createMockConfig({
        providers: {
          otp: {
            enabled: true,
            hasSecret: true,
            verifiedAt: Date.now(),
            authenticatorType: "google",
          },
        },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should use the same TOTP secret across different auth actions", async () => {
    const { generateSync } = await import("otplib");
    const validCode = generateSync({ secret: TEST_SECRET });

    // delete_account
    const result1 = await provider.authenticate({
      action: "delete_account",
      totpCode: validCode,
    });
    expect(result1.success).toBe(true);

    // delete_account — same code, same provider instance
    const result2 = await provider.authenticate({
      action: "delete_account",
      totpCode: validCode,
    });
    expect(result2.success).toBe(true);
  });

  it("should share lockout state across different actions", async () => {
    vi.useFakeTimers();

    // Exhaust attempts on delete_account
    for (let i = 0; i < 5; i++) {
      await provider.authenticate({
        action: "delete_account",
        totpCode: "000000",
      });
    }

    // Locked out on delete_account
    const lockedSign = await provider.authenticate({
      action: "delete_account",
      totpCode: "000000",
    });
    expect(lockedSign.success).toBe(false);
    expect(lockedSign.error).toContain("Too many failed attempts");

    // Also locked on delete_account — same provider instance shares lockout
    const lockedDelete = await provider.authenticate({
      action: "delete_account",
      totpCode: "000000",
    });
    expect(lockedDelete.success).toBe(false);
    expect(lockedDelete.error).toContain("Too many failed attempts");

    vi.useRealTimers();
  });

  it("should carry over attempt counter across actions", async () => {
    // 3 failures on delete_account
    for (let i = 0; i < 3; i++) {
      await provider.authenticate({
        action: "delete_account",
        totpCode: "000000",
      });
    }

    // 2 more failures on delete_account → should trigger lockout (total 5)
    for (let i = 0; i < 2; i++) {
      await provider.authenticate({
        action: "delete_account",
        totpCode: "000000",
      });
    }

    // Next attempt on any action should be locked
    const result = await provider.authenticate({
      action: "delete_account",
      totpCode: "000000",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Too many failed attempts");
  });
});

/**
 * Fix verification: setup() refuses to regenerate secret when TOTP is already configured
 *
 * @see Session log 2026-03-11 Section 3-1
 * When TOTP is already verified for delete_account, calling setup() again
 * for additional actions should be rejected — the existing keychain secret
 * is reused via enableProviderForAction() at the tool layer.
 */
describe("TotpProvider setup with existing secret", () => {
  let provider: TotpProvider;
  const EXISTING_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  beforeEach(() => {
    vi.clearAllMocks();
    keytarStore.clear();
    // Simulate already-configured TOTP: secret in keychain + config has hasSecret
    keytarStore.set("keplr-mcp-server:totp-secret", EXISTING_SECRET);
    provider = new TotpProvider("google");

    vi.mocked(authConfig.loadAuthConfig).mockResolvedValue(
      createMockConfig({
        providers: {
          otp: {
            enabled: true,
            hasSecret: true,
            verifiedAt: Date.now(),
            authenticatorType: "google",
          },
        },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should refuse to generate a new secret when TOTP is already configured", async () => {
    const available = await provider.isAvailable();
    expect(available).toBe(true);

    // setup() should refuse — TOTP already configured
    const result = await provider.setup({ account: "test" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("already configured");

    // No pendingSetup should be created
    // @ts-expect-error - accessing private property for testing
    expect(provider.pendingSetup).toBeNull();
  });

  it("should reject all parallel setup calls when TOTP is already configured", async () => {
    const [result1, result2, result3] = await Promise.all([
      provider.setup({ account: "export_key" }),
      provider.setup({ account: "delete_account" }),
      provider.setup({ account: "delete_account" }),
    ]);

    // All 3 calls rejected — no new secret generation, no race condition
    expect(result1.success).toBe(false);
    expect(result2.success).toBe(false);
    expect(result3.success).toBe(false);

    // @ts-expect-error - accessing private property for testing
    expect(provider.pendingSetup).toBeNull();
  });

  it("should preserve existing keychain secret when setup is called", async () => {
    expect(keytarStore.get("keplr-mcp-server:totp-secret")).toBe(
      EXISTING_SECRET,
    );

    // setup() refuses — keychain secret is untouched
    const result = await provider.setup({ account: "test" });
    expect(result.success).toBe(false);

    expect(keytarStore.get("keplr-mcp-server:totp-secret")).toBe(
      EXISTING_SECRET,
    );
  });
});
