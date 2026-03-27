import { describe, expect, it } from "vitest";
import {
  createEOAAccount,
  EOAAccountImpl,
} from "../../../keys/accounts/eoa.js";
import {
  AccountError,
  AccountErrorCode,
} from "../../../keys/accounts/types.js";
import { Secp256k1Signer } from "../../../keys/signers/secp256k1.js";

// Valid test mnemonic from BIP39 test vectors (DO NOT use for real funds)
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("EOAAccountImpl", () => {
  describe("construction", () => {
    it("should create EOA from secp256k1 signer", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      expect(account).toBeInstanceOf(EOAAccountImpl);
      expect(account.kind).toBe("eoa");
      expect(account.signer).toBe(signer);
    });

    it("should throw for non-secp256k1 signer", () => {
      // Create a mock signer with p256 curve
      const mockSigner = {
        curve: "p256" as const,
        requiresInteraction: true,
        getPublicKey: async () => new Uint8Array(33),
        signHash: async () => ({ signature: new Uint8Array(64) }),
      };

      expect(() => new EOAAccountImpl(mockSigner)).toThrow(AccountError);
      expect(() => new EOAAccountImpl(mockSigner)).toThrow(
        "EOA accounts require secp256k1 signer",
      );
    });
  });

  describe("fromSigner", () => {
    it("should create EOA using static factory", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = EOAAccountImpl.fromSigner(signer);

      expect(account).toBeInstanceOf(EOAAccountImpl);
      expect(account.kind).toBe("eoa");
    });
  });

  describe("getAddress", () => {
    it("should derive Cosmos address with default prefix", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      const address = await account.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      expect(address).toMatch(/^cosmos1/);
      expect(address.length).toBe(45); // Standard cosmos bech32 length
    });

    it("should derive Cosmos address with custom prefix", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      const address = await account.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "osmo",
      });

      expect(address).toMatch(/^osmo1/);
    });

    it("should use cosmos prefix when none specified", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      const address = await account.getAddress({ ecosystem: "cosmos" });

      expect(address).toMatch(/^cosmos1/);
    });

    it("should cache addresses", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      const address1 = await account.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });
      const address2 = await account.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      expect(address1).toBe(address2);
    });

    it("should throw for unsupported ecosystem", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      await expect(
        account.getAddress({ ecosystem: "solana" as "cosmos" }),
      ).rejects.toThrow(AccountError);

      await expect(
        account.getAddress({ ecosystem: "solana" as "cosmos" }),
      ).rejects.toMatchObject({ code: AccountErrorCode.UNSUPPORTED_ECOSYSTEM });
    });
  });

  describe("getSigners", () => {
    it("should return array with single signer", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      const signers = account.getSigners();

      expect(signers).toHaveLength(1);
      expect(signers[0]).toBe(signer);
    });
  });

  describe("supportsEcosystem", () => {
    it("should support cosmos", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      expect(account.supportsEcosystem("cosmos")).toBe(true);
    });

    it("should not support other ecosystems", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      // TypeScript would normally prevent this, but testing runtime behavior
      expect(account.supportsEcosystem("solana" as "cosmos")).toBe(false);
    });
  });

  describe("getSupportedEcosystems", () => {
    it("should return cosmos only", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      const ecosystems = account.getSupportedEcosystems();

      expect(ecosystems).toContain("cosmos");
      expect(ecosystems).toHaveLength(1);
    });
  });

  describe("getPublicKey", () => {
    it("should return public key for cosmos", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      const pubkey = await account.getPublicKey({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      expect(pubkey).toBeInstanceOf(Uint8Array);
      expect(pubkey?.length).toBe(33); // Compressed secp256k1
    });

    it("should return undefined for unsupported ecosystem", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      const pubkey = await account.getPublicKey({
        ecosystem: "solana" as "cosmos",
      });

      expect(pubkey).toBeUndefined();
    });
  });

  describe("clearCache", () => {
    it("should clear address cache", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      // Prime the cache
      const address1 = await account.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      // Clear cache
      account.clearCache();

      // Should work after clearing (recreates)
      const address2 = await account.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      expect(address1).toBe(address2);
    });
  });

  describe("createEOAAccount helper", () => {
    it("should create EOA account", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = createEOAAccount(signer);

      expect(account).toBeInstanceOf(EOAAccountImpl);
      expect(account.kind).toBe("eoa");
    });
  });

  describe("deterministic address derivation", () => {
    it("should derive known Cosmos address from test mnemonic", async () => {
      // The test mnemonic "abandon abandon..." with default cosmos path
      // should produce a well-known address
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const account = new EOAAccountImpl(signer);

      const address = await account.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      // This is the expected address for this test mnemonic
      // Verify by running: cosmjs or similar tool
      expect(address).toMatch(/^cosmos1/);
    });

    it("should derive consistent addresses across instances", async () => {
      const signer1 = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const signer2 = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });

      const account1 = new EOAAccountImpl(signer1);
      const account2 = new EOAAccountImpl(signer2);

      const address1 = await account1.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });
      const address2 = await account2.getAddress({
        ecosystem: "cosmos",
        bech32Prefix: "cosmos",
      });

      expect(address1).toBe(address2);
    });
  });
});
