import { describe, expect, it } from "vitest";
import {
  createKeyProvider,
  createMnemonicKeyProvider,
  getSupportedKeyProviderTypes,
  isKeyProviderTypeSupported,
  validateKeyProviderConfig,
} from "../../keys/factory.js";
import { MnemonicKeyProvider } from "../../keys/providers/mnemonic.js";
import { KeyProviderError } from "../../keys/types.js";

// Valid test mnemonic (DO NOT use for real funds)
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("KeyProvider Factory", () => {
  describe("isKeyProviderTypeSupported", () => {
    it("should return true for mnemonic", () => {
      expect(isKeyProviderTypeSupported("mnemonic")).toBe(true);
    });

    it("should return true for registered but unimplemented types", () => {
      // These are registered in the registry but will throw on creation
      // This is by design - they are "known" types that are not yet implemented
      expect(isKeyProviderTypeSupported("smart-account")).toBe(true);
    });
  });

  describe("getSupportedKeyProviderTypes", () => {
    it("should return array of supported types", () => {
      const types = getSupportedKeyProviderTypes();
      expect(types).toContain("mnemonic");
      // Also includes registered but unimplemented types
      expect(types).toContain("smart-account");
    });
  });

  describe("createKeyProvider", () => {
    it("should create MnemonicKeyProvider from config", async () => {
      const provider = await createKeyProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      expect(provider).toBeInstanceOf(MnemonicKeyProvider);
      expect(provider.type).toBe("mnemonic");
    });

    it("should throw for passkey without proper config", async () => {
      await expect(
        createKeyProvider({
          type: "passkey",
          credentialId: "test",
          publicKey: "test",
        }),
      ).rejects.toThrow(); // Missing required fields
    });

    it("should throw for smart-account (not implemented)", async () => {
      await expect(
        createKeyProvider({
          type: "smart-account",
          accountAddress: "0x123",
          factoryAddress: "0x456",
          ownerConfig: {
            type: "mnemonic",
            mnemonic: TEST_MNEMONIC,
          },
        }),
      ).rejects.toThrow(/not yet implemented/);
    });

    it("should throw for unknown type", async () => {
      await expect(
        createKeyProvider({
          type: "unknown-type",
          mnemonic: "test",
        } as unknown as { type: "mnemonic"; mnemonic: string }),
      ).rejects.toThrow(/Unknown key provider type/);
    });
  });

  describe("createMnemonicKeyProvider", () => {
    it("should create provider with mnemonic", async () => {
      const provider = await createMnemonicKeyProvider(TEST_MNEMONIC);

      expect(provider).toBeInstanceOf(MnemonicKeyProvider);
      expect(provider.type).toBe("mnemonic");
      expect(provider.displayName).toBe("Mnemonic Wallet");
    });

    it("should pass hdPathPrefix option", async () => {
      const provider = await createMnemonicKeyProvider(TEST_MNEMONIC, {
        hdPathPrefix: "m/44'/118'/0'/0/0",
      });

      expect(provider).toBeInstanceOf(MnemonicKeyProvider);
    });
  });

  describe("validateKeyProviderConfig", () => {
    it("should validate mnemonic config", async () => {
      const result = await validateKeyProviderConfig({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });
      expect(result).toBe(true);
    });

    it("should reject mnemonic config without mnemonic", async () => {
      await expect(
        validateKeyProviderConfig({
          type: "mnemonic",
          mnemonic: "",
        }),
      ).rejects.toThrow(KeyProviderError);
    });

    it("should reject config without type", async () => {
      await expect(
        validateKeyProviderConfig({} as { type: "mnemonic"; mnemonic: string }),
      ).rejects.toThrow(KeyProviderError);
    });

    it("should reject unknown type", async () => {
      await expect(
        validateKeyProviderConfig({
          type: "unknown-type",
          mnemonic: "test",
        } as unknown as { type: "mnemonic"; mnemonic: string }),
      ).rejects.toThrow(/Unknown key provider type/);
    });
  });
});
