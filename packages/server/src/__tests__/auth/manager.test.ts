/**
 * AuthManager Unit Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthConfig,
  AuthContext,
  AuthProvider,
  AuthResult,
} from "../../auth/types.js";
import { DEFAULT_AUTH_CONFIG } from "../../auth/types.js";

// Mock config-storage
vi.mock("../../config-storage.js", () => ({
  readJsonConfig: vi.fn(),
  writeJsonConfig: vi.fn(),
}));

import { _resetAuthConfigCache } from "../../auth/config.js";
import { AuthManager } from "../../auth/manager.js";
// Import after mocking
import { readJsonConfig, writeJsonConfig } from "../../config-storage.js";

// Mock provider factory
function createMockProvider(
  id: string,
  available: boolean = true,
  authResult: AuthResult = { success: true },
): AuthProvider {
  return {
    id,
    name: `Mock Provider (${id})`,
    isAvailable: vi.fn().mockResolvedValue(available),
    setup: vi.fn().mockResolvedValue({ success: true }),
    authenticate: vi.fn().mockResolvedValue(authResult),
    disable: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AuthManager", () => {
  let manager: AuthManager;
  let mockConfig: AuthConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetAuthConfigCache();

    // Default mock config
    mockConfig = {
      ...DEFAULT_AUTH_CONFIG,
      enabled: true,
      requirements: {
        delete_account: {
          enabled: true,
          providers: ["biometric"],
        },
        export_mnemonic: {
          enabled: false,
          providers: [],
        },
      },
    };

    vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
    vi.mocked(writeJsonConfig).mockResolvedValue(undefined);

    manager = new AuthManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initialization", () => {
    it("should load config on initialize", async () => {
      await manager.initialize();

      expect(readJsonConfig).toHaveBeenCalledWith("auth.json");
    });

    it("should use default config when none exists", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue(null);

      await manager.initialize();
      const config = await manager.getConfig();

      expect(config.enabled).toBe(false);
    });
  });

  describe("provider registration", () => {
    it("should register a provider", () => {
      const provider = createMockProvider("test");

      manager.registerProvider(provider);

      expect(manager.getProvider("test")).toBe(provider);
    });

    it("should unregister a provider", () => {
      const provider = createMockProvider("test");
      manager.registerProvider(provider);

      manager.unregisterProvider("test");

      expect(manager.getProvider("test")).toBeUndefined();
    });

    it("should return all registered providers", () => {
      const provider1 = createMockProvider("test1");
      const provider2 = createMockProvider("test2");

      manager.registerProvider(provider1);
      manager.registerProvider(provider2);

      const all = manager.getAllProviders();
      expect(all).toHaveLength(2);
      expect(all).toContain(provider1);
      expect(all).toContain(provider2);
    });

    it("should return only available providers", async () => {
      const available = createMockProvider("available", true);
      const unavailable = createMockProvider("unavailable", false);

      manager.registerProvider(available);
      manager.registerProvider(unavailable);

      const availableProviders = await manager.getAvailableProviders();
      expect(availableProviders).toHaveLength(1);
      expect(availableProviders[0]).toBe(available);
    });
  });

  describe("isAuthRequired", () => {
    it("should return false when auth is disabled globally", async () => {
      mockConfig.enabled = false;
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const required = await manager.isAuthRequired("delete_account");

      expect(required).toBe(false);
    });

    it("should return false when action requirement is disabled", async () => {
      mockConfig.requirements.delete_account.enabled = false;
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const required = await manager.isAuthRequired("delete_account");

      expect(required).toBe(false);
    });

    it("should return true when auth is enabled for action", async () => {
      await manager.initialize();

      const required = await manager.isAuthRequired("delete_account");

      expect(required).toBe(true);
    });
  });

  describe("authenticate", () => {
    it("should return success when auth is disabled", async () => {
      mockConfig.enabled = false;
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const context: AuthContext = { action: "delete_account" };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(true);
    });

    it("should return success when action does not require auth", async () => {
      mockConfig.requirements.delete_account.enabled = false;
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const context: AuthContext = { action: "delete_account" };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(true);
    });

    it("should return success when provider authenticates successfully", async () => {
      await manager.initialize();

      const provider = createMockProvider("biometric", true, { success: true });
      manager.registerProvider(provider);

      const context: AuthContext = { action: "delete_account" };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(true);
      expect(provider.authenticate).toHaveBeenCalledWith(context);
    });

    it("should return failure when provider authentication fails", async () => {
      await manager.initialize();

      const provider = createMockProvider("biometric", true, {
        success: false,
        error: "User cancelled",
      });
      manager.registerProvider(provider);

      const context: AuthContext = { action: "delete_account" };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("User cancelled");
    });

    it("should succeed on first provider success", async () => {
      mockConfig.requirements.delete_account.providers = [
        "provider1",
        "provider2",
      ];
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const provider1 = createMockProvider("provider1", true, {
        success: true,
      });
      const provider2 = createMockProvider("provider2", true, {
        success: true,
      });
      manager.registerProvider(provider1);
      manager.registerProvider(provider2);

      const context: AuthContext = { action: "delete_account" };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(true);
      expect(provider1.authenticate).toHaveBeenCalled();
      expect(provider2.authenticate).not.toHaveBeenCalled(); // Stopped after first success
    });

    it("should fail when all providers fail", async () => {
      mockConfig.requirements.delete_account.providers = [
        "provider1",
        "provider2",
      ];
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const provider1 = createMockProvider("provider1", true, {
        success: false,
        error: "Failed 1",
      });
      const provider2 = createMockProvider("provider2", true, {
        success: false,
        error: "Failed 2",
      });
      manager.registerProvider(provider1);
      manager.registerProvider(provider2);

      const context: AuthContext = { action: "delete_account" };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(false);
      // Last error should be returned since both failed for real
      expect(result.error).toContain("Failed 2");
    });

    it("should fallback to next provider when current requires input", async () => {
      // TOTP requires code (requiresInput=true), biometric works
      mockConfig.requirements.delete_account.providers = ["totp", "biometric"];
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const totpProvider = createMockProvider("totp", true, {
        success: false,
        error: "Requires code",
        requiresInput: true,
        provider: "totp",
      });
      const biometricProvider = createMockProvider("biometric", true, {
        success: true,
      });
      manager.registerProvider(totpProvider);
      manager.registerProvider(biometricProvider);

      const context: AuthContext = { action: "delete_account" };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(true);
      expect(totpProvider.authenticate).toHaveBeenCalled();
      expect(biometricProvider.authenticate).toHaveBeenCalled(); // Fallback to biometric
    });

    it("should not fallback when TOTP code is provided and succeeds", async () => {
      mockConfig.requirements.delete_account.providers = ["totp", "biometric"];
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const totpProvider = createMockProvider("totp", true, { success: true });
      const biometricProvider = createMockProvider("biometric", true, {
        success: true,
      });
      manager.registerProvider(totpProvider);
      manager.registerProvider(biometricProvider);

      const context: AuthContext = {
        action: "delete_account",
        totpCode: "123456",
      };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(true);
      expect(totpProvider.authenticate).toHaveBeenCalledWith(context);
      expect(biometricProvider.authenticate).not.toHaveBeenCalled(); // No fallback needed
    });

    it("should respect preferredMethod and skip other providers", async () => {
      mockConfig.requirements.delete_account.providers = ["totp", "biometric"];
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const totpProvider = createMockProvider("totp", true, {
        success: false,
        error: "Requires code",
        requiresInput: true,
      });
      const biometricProvider = createMockProvider("biometric", true, {
        success: true,
      });
      manager.registerProvider(totpProvider);
      manager.registerProvider(biometricProvider);

      // Prefer biometric, skip TOTP entirely
      const context: AuthContext = {
        action: "delete_account",
        preferredMethod: "biometric",
      };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(true);
      expect(totpProvider.authenticate).not.toHaveBeenCalled(); // Skipped
      expect(biometricProvider.authenticate).toHaveBeenCalled();
    });

    it("should return requiresInput when all providers need input", async () => {
      mockConfig.requirements.delete_account.providers = ["totp"];
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const totpProvider = createMockProvider("totp", true, {
        success: false,
        error: "Requires code",
        requiresInput: true,
      });
      manager.registerProvider(totpProvider);

      const context: AuthContext = { action: "delete_account" };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(false);
      expect(result.requiresInput).toBe(true);
      expect(result.error).toBe("Requires code");
    });

    it("should fail when no providers are configured (fail-closed)", async () => {
      mockConfig.requirements.delete_account.providers = [];
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const context: AuthContext = { action: "delete_account" };
      const result = await manager.authenticate(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("no providers are configured");
    });
  });

  describe("setupProvider", () => {
    it("should return error for unknown provider", async () => {
      await manager.initialize();

      const result = await manager.setupProvider("unknown", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return error when provider is not available", async () => {
      await manager.initialize();

      const provider = createMockProvider("biometric", false);
      manager.registerProvider(provider);

      const result = await manager.setupProvider("biometric", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("not available");
    });

    it("should call provider setup and save config", async () => {
      await manager.initialize();

      const provider = createMockProvider("biometric", true);
      manager.registerProvider(provider);

      const result = await manager.setupProvider("biometric", {
        account: "test",
      });

      expect(result.success).toBe(true);
      expect(provider.setup).toHaveBeenCalledWith({ account: "test" });
      expect(writeJsonConfig).toHaveBeenCalled();
    });
  });

  describe("disableProvider", () => {
    it("should call provider disable and update config", async () => {
      mockConfig.providers.biometric = { enabled: true };
      mockConfig.requirements.delete_account.providers = ["biometric", "totp"];
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const provider = createMockProvider("biometric", true);
      manager.registerProvider(provider);

      await manager.disableProvider("biometric");

      expect(provider.disable).toHaveBeenCalled();
      expect(writeJsonConfig).toHaveBeenCalled();

      // Check config was updated
      const savedConfig = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as AuthConfig;
      expect(savedConfig.providers.biometric?.enabled).toBe(false);
      expect(savedConfig.requirements.delete_account.providers).not.toContain(
        "biometric",
      );
    });

    it("should throw when disabling the last provider for an enabled action", async () => {
      mockConfig.requirements.delete_account.providers = ["biometric"];
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const provider = createMockProvider("biometric", true);
      manager.registerProvider(provider);

      await expect(manager.disableProvider("biometric")).rejects.toThrow(
        "Cannot disable 'biometric'",
      );
    });

    it("should allow disabling a provider when another remains", async () => {
      mockConfig.requirements.delete_account.providers = ["biometric", "totp"];
      vi.mocked(readJsonConfig).mockResolvedValue(mockConfig);
      await manager.initialize();

      const provider = createMockProvider("biometric", true);
      manager.registerProvider(provider);

      await manager.disableProvider("biometric");

      const savedConfig = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as AuthConfig;
      expect(savedConfig.requirements.delete_account.providers).toEqual([
        "totp",
      ]);
    });
  });

  describe("getStatus", () => {
    it("should return complete status", async () => {
      await manager.initialize();

      const provider = createMockProvider("biometric", true);
      manager.registerProvider(provider);

      const status = await manager.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.availableProviders).toHaveLength(1);
      expect(status.availableProviders[0]).toEqual({
        id: "biometric",
        name: "Mock Provider (biometric)",
        available: true,
      });
      expect(status.requirements.delete_account.enabled).toBe(true);
    });
  });

  describe("priority-based provider selection", () => {
    it("should fallback to biometric when TOTP requires input", async () => {
      const totpProvider = createMockProvider("totp", true, {
        success: false,
        error: "TOTP verification requires a code.",
        requiresInput: true,
      });
      const biometricProvider = createMockProvider("biometric", true, {
        success: true,
      });

      manager.registerProvider(totpProvider);
      manager.registerProvider(biometricProvider);

      mockConfig.requirements.delete_account = {
        enabled: true,
        providers: ["totp", "biometric"],
      };

      const result = await manager.authenticate({
        action: "delete_account",
        totpCode: undefined,
      });

      expect(result.success).toBe(true);
      expect(biometricProvider.authenticate).toHaveBeenCalled();
    });

    it("should fallback to biometric on lockout", async () => {
      const totpProvider = createMockProvider("totp", true, {
        success: false,
        error: "Too many failed attempts. Please try again in 300 seconds.",
        provider: "totp",
      });
      const biometricProvider = createMockProvider("biometric", true, {
        success: true,
      });

      manager.registerProvider(totpProvider);
      manager.registerProvider(biometricProvider);

      mockConfig.requirements.delete_account = {
        enabled: true,
        providers: ["totp", "biometric"],
      };

      const result = await manager.authenticate({
        action: "delete_account",
      });

      expect(result.success).toBe(true);
      expect(biometricProvider.authenticate).toHaveBeenCalled();
    });
  });
});
