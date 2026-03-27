/**
 * Auth Config Unit Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "../../auth/types.js";
import { DEFAULT_AUTH_CONFIG } from "../../auth/types.js";

// Mock config-storage
vi.mock("../../config-storage.js", () => ({
  readJsonConfig: vi.fn(),
  writeJsonConfig: vi.fn(),
}));

import {
  _resetAuthConfigCache,
  disableBiometric,
  disableProviderForAction,
  enableBiometric,
  enableProviderForAction,
  loadAuthConfig,
  saveAuthConfig,
} from "../../auth/config.js";
// Import after mocking
import { readJsonConfig, writeJsonConfig } from "../../config-storage.js";

describe("Auth Config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAuthConfigCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadAuthConfig", () => {
    it("should return default config when no stored config exists", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue(null);

      const config = await loadAuthConfig();

      expect(config).toEqual(DEFAULT_AUTH_CONFIG);
      expect(readJsonConfig).toHaveBeenCalledWith("auth.json");
    });

    it("should merge stored config with defaults", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        enabled: true,
      });

      const config = await loadAuthConfig();

      expect(config.enabled).toBe(true);
      // Other fields should come from defaults
      expect(config.requirements).toBeDefined();
    });

    it("should preserve stored requirements", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        requirements: {
          delete_account: {
            enabled: true,
            providers: ["biometric"],
          },
        },
      });

      const config = await loadAuthConfig();

      expect(config.requirements.delete_account.enabled).toBe(true);
      // Other requirements should still exist from defaults
      expect(config.requirements.delete_account).toBeDefined();
    });

    it("should inherit delete_account settings for missing actions when auth is enabled", async () => {
      // Simulates upgrade: user had auth enabled with only delete_account configured
      vi.mocked(readJsonConfig).mockResolvedValue({
        enabled: true,
        requirements: {
          delete_account: {
            enabled: true,
            providers: ["totp"],
          },
        },
      });

      const config = await loadAuthConfig();

      // export_mnemonic should inherit delete_account's settings
      expect(config.requirements.export_mnemonic.enabled).toBe(true);
      expect(config.requirements.export_mnemonic.providers).toEqual(["totp"]);
    });

    it("should not inherit when auth is disabled", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        enabled: false,
        requirements: {
          delete_account: {
            enabled: true,
            providers: ["totp"],
          },
        },
      });

      const config = await loadAuthConfig();

      // export_mnemonic should use defaults (disabled)
      expect(config.requirements.export_mnemonic.enabled).toBe(false);
      expect(config.requirements.export_mnemonic.providers).toEqual([]);
    });

    it("should not inherit when delete_account is also missing", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        enabled: true,
        requirements: {},
      });

      const config = await loadAuthConfig();

      // No delete_account to inherit from — use defaults
      expect(config.requirements.export_mnemonic.enabled).toBe(false);
      expect(config.requirements.export_mnemonic.providers).toEqual([]);
    });

    it("should preserve existing export_mnemonic settings over inheritance", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        enabled: true,
        requirements: {
          delete_account: {
            enabled: true,
            providers: ["totp"],
          },
          export_mnemonic: {
            enabled: true,
            providers: ["biometric"],
          },
        },
      });

      const config = await loadAuthConfig();

      // export_mnemonic has its own stored settings — should not inherit
      expect(config.requirements.export_mnemonic.enabled).toBe(true);
      expect(config.requirements.export_mnemonic.providers).toEqual([
        "biometric",
      ]);
    });
  });

  describe("saveAuthConfig", () => {
    it("should save config to storage", async () => {
      const config: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        enabled: true,
      };

      await saveAuthConfig(config);

      expect(writeJsonConfig).toHaveBeenCalledWith("auth.json", config);
    });
  });

  describe("enableProviderForAction", () => {
    it("should add provider to action and enable requirement", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({ ...DEFAULT_AUTH_CONFIG });

      await enableProviderForAction("delete_account", "biometric");

      expect(writeJsonConfig).toHaveBeenCalled();
      const savedConfig = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as AuthConfig;
      expect(savedConfig.requirements.delete_account.providers).toContain(
        "biometric",
      );
      expect(savedConfig.requirements.delete_account.enabled).toBe(true);
    });

    it("should not add duplicate provider", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        ...DEFAULT_AUTH_CONFIG,
        requirements: {
          ...DEFAULT_AUTH_CONFIG.requirements,
          delete_account: {
            ...DEFAULT_AUTH_CONFIG.requirements.delete_account,
            providers: ["biometric"],
          },
        },
      });

      await enableProviderForAction("delete_account", "biometric");

      const savedConfig = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as AuthConfig;
      expect(savedConfig.requirements.delete_account.providers).toEqual([
        "biometric",
      ]);
    });
  });

  describe("disableProviderForAction", () => {
    it("should remove provider from action", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        ...DEFAULT_AUTH_CONFIG,
        requirements: {
          ...DEFAULT_AUTH_CONFIG.requirements,
          delete_account: {
            enabled: true,
            providers: ["biometric", "otp"],
          },
        },
      });

      await disableProviderForAction("delete_account", "biometric");

      const savedConfig = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as AuthConfig;
      expect(savedConfig.requirements.delete_account.providers).toEqual([
        "otp",
      ]);
      expect(savedConfig.requirements.delete_account.enabled).toBe(true);
    });

    it("should disable requirement when no providers left", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        ...DEFAULT_AUTH_CONFIG,
        requirements: {
          ...DEFAULT_AUTH_CONFIG.requirements,
          delete_account: {
            enabled: true,
            providers: ["biometric"],
          },
        },
      });

      await disableProviderForAction("delete_account", "biometric");

      const savedConfig = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as AuthConfig;
      expect(savedConfig.requirements.delete_account.providers).toEqual([]);
      expect(savedConfig.requirements.delete_account.enabled).toBe(false);
    });
  });

  describe("biometric configuration", () => {
    it("should enable biometric provider", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({ ...DEFAULT_AUTH_CONFIG });

      await enableBiometric();

      const savedConfig = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as AuthConfig;
      expect(savedConfig.providers.biometric?.enabled).toBe(true);
    });

    it("should disable biometric and remove from all requirements", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        ...DEFAULT_AUTH_CONFIG,
        providers: { biometric: { enabled: true } },
        requirements: {
          delete_account: {
            enabled: true,
            providers: ["biometric", "otp"],
          },
        },
      });

      await disableBiometric();

      const savedConfig = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as AuthConfig;
      expect(savedConfig.providers.biometric?.enabled).toBe(false);

      // Biometric removed from requirements
      expect(savedConfig.requirements.delete_account.providers).not.toContain(
        "biometric",
      );

      // delete_account should still be enabled (otp remains)
      expect(savedConfig.requirements.delete_account.enabled).toBe(true);
      expect(savedConfig.requirements.delete_account.providers).toEqual([
        "otp",
      ]);
    });
  });
});
