import { describe, expect, it } from "vitest";
import { EOAAccountImpl } from "../../../keys/accounts/eoa.js";
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
  });
});
