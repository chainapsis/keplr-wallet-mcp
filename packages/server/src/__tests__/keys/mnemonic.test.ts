import { describe, expect, it } from "vitest";
import {
  createMnemonicProvider,
  MnemonicKeyProvider,
} from "../../keys/providers/mnemonic.js";
import { KeyProviderError, type SignType } from "../../keys/types.js";

// Valid test mnemonic from BIP39 test vectors (DO NOT use for real funds)
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("MnemonicKeyProvider", () => {
  describe("construction", () => {
    it("should create provider with valid mnemonic", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      expect(provider).toBeInstanceOf(MnemonicKeyProvider);
      expect(provider.type).toBe("mnemonic");
      expect(provider.displayName).toBe("Mnemonic Wallet");
    });

    it("should throw for empty mnemonic", () => {
      expect(
        () =>
          new MnemonicKeyProvider({
            type: "mnemonic",
            mnemonic: "",
          }),
      ).toThrow(KeyProviderError);
    });

    it("should throw for whitespace-only mnemonic", () => {
      expect(
        () =>
          new MnemonicKeyProvider({
            type: "mnemonic",
            mnemonic: "   ",
          }),
      ).toThrow(KeyProviderError);
    });
  });

  describe("capabilities", () => {
    it("should have correct capabilities", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      expect(provider.capabilities.curves).toContain("secp256k1");
      expect(provider.capabilities.signTypes).toContain("direct");
      expect(provider.capabilities.signTypes).toContain("amino");
      expect(provider.capabilities.canExportKey).toBe(true);
      expect(provider.capabilities.requiresUserInteraction).toBe(false);
      expect(provider.capabilities.supportsDerivation).toBe(true);
    });
  });

  describe("getAddress", () => {
    it("should get Cosmos address with default prefix", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      const address = await provider.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      expect(address).toMatch(/^cosmos1/);
      expect(address).toHaveLength(45); // cosmos bech32 address length
    });

    it("should get Cosmos address with custom prefix", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      const address = await provider.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "osmo",
      });

      expect(address).toMatch(/^osmo1/);
    });

    it("should throw for unsupported ecosystem", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      await expect(
        provider.getAddress({
          ecosystem: "solana" as "cosmos",
        }),
      ).rejects.toThrow(KeyProviderError);
    });

    it("should cache wallet for same prefix", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      const address1 = await provider.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });
      const address2 = await provider.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      expect(address1).toBe(address2);
    });
  });

  describe("getPublicKey", () => {
    it("should get public key for Cosmos", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      const pubkey = await provider.getPublicKey({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      expect(pubkey).toBeInstanceOf(Uint8Array);
      expect(pubkey?.length).toBe(33); // compressed secp256k1 pubkey
    });
  });

  describe("isReady", () => {
    it("should always return true", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      expect(await provider.isReady()).toBe(true);
    });
  });

  describe("disconnect", () => {
    it("should clear wallet cache", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      // Prime the cache
      await provider.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      // Disconnect
      await provider.disconnect();

      // Should still work (recreates wallet)
      const address = await provider.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });
      expect(address).toMatch(/^cosmos1/);
    });
  });

  describe("getAllAddresses", () => {
    it("should return addresses for all ecosystems", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      const addresses = await provider.getAllAddresses();

      expect(addresses.has("cosmos")).toBe(true);
      expect(addresses.get("cosmos")).toMatch(/^cosmos1/);
    });
  });

  describe("getMnemonic", () => {
    it("should return the mnemonic", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      expect(provider.getMnemonic()).toBe(TEST_MNEMONIC);
    });
  });

  describe("getSupportedEcosystems", () => {
    it("should return cosmos only", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      const ecosystems = provider.getSupportedEcosystems();

      expect(ecosystems).toContain("cosmos");
      expect(ecosystems).toHaveLength(1);
    });
  });

  describe("sign", () => {
    it("should throw for unsupported ecosystem", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      await expect(
        provider.sign({
          signType: "direct",
          data: new Uint8Array([1, 2, 3]),
          ecosystem: "solana",
        }),
      ).rejects.toThrow(KeyProviderError);
    });

    it("should throw for unsupported sign type on Cosmos", async () => {
      const provider = await createMnemonicProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      await expect(
        provider.sign({
          signType: "unknown-type" as SignType,
          data: new Uint8Array([1, 2, 3]),
          ecosystem: "cosmos",
        }),
      ).rejects.toThrow(KeyProviderError);
    });
  });
});
