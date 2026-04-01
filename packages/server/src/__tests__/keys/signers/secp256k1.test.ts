import { sha256 } from "@cosmjs/crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HD_PATHS,
  Secp256k1Signer,
} from "../../../keys/signers/secp256k1.js";
import { SignerError, SignerErrorCode } from "../../../keys/signers/types.js";

// Valid test mnemonic from BIP39 test vectors (DO NOT use for real funds)
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("Secp256k1Signer", () => {
  describe("fromMnemonic", () => {
    it("should use default Cosmos HD path when none specified", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });

      expect(signer.getDerivationPath()).toBe(DEFAULT_HD_PATHS.cosmos);
    });

    it("should use custom HD path when specified", async () => {
      const customPath = "m/44'/60'/0'/0/0";
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
        path: customPath,
      });

      expect(signer.getDerivationPath()).toBe(customPath);
    });

    it("should produce different keys for different paths", async () => {
      const cosmosSigner = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
        path: DEFAULT_HD_PATHS.cosmos,
      });
      const altSigner = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
        path: "m/44'/118'/1'/0/0",
      });

      const cosmosPubkey = await cosmosSigner.getPublicKey();
      const altPubkey = await altSigner.getPublicKey();

      expect(cosmosPubkey).not.toEqual(altPubkey);
    });

    it("should throw SignerError for invalid mnemonic", async () => {
      await expect(
        Secp256k1Signer.fromMnemonic({ mnemonic: "invalid mnemonic words" }),
      ).rejects.toThrow(SignerError);

      await expect(
        Secp256k1Signer.fromMnemonic({ mnemonic: "invalid mnemonic words" }),
      ).rejects.toMatchObject({ code: SignerErrorCode.INVALID_MNEMONIC });
    });

    it("should throw SignerError for empty mnemonic", async () => {
      await expect(
        Secp256k1Signer.fromMnemonic({ mnemonic: "" }),
      ).rejects.toThrow(SignerError);
    });
  });

  describe("fromPrivateKey", () => {
    it("should not support derivation when created from private key", async () => {
      const mnemonicSigner = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const privateKey = mnemonicSigner.getPrivateKey();

      const signer = await Secp256k1Signer.fromPrivateKey({ privateKey });

      expect(signer.canDerive()).toBe(false);
      expect(signer.getDerivationPath()).toBeUndefined();
    });

    it("should throw for invalid private key length", async () => {
      const invalidKey = new Uint8Array(16); // Too short

      await expect(
        Secp256k1Signer.fromPrivateKey({ privateKey: invalidKey }),
      ).rejects.toThrow(SignerError);

      await expect(
        Secp256k1Signer.fromPrivateKey({ privateKey: invalidKey }),
      ).rejects.toMatchObject({ code: SignerErrorCode.INVALID_PRIVATE_KEY });
    });

    it("should throw for zero private key", async () => {
      const zeroKey = new Uint8Array(32); // All zeros is invalid

      await expect(
        Secp256k1Signer.fromPrivateKey({ privateKey: zeroKey }),
      ).rejects.toThrow(SignerError);
    });
  });

  describe("getPublicKey", () => {
    it("should return compressed public key (33 bytes)", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });

      const pubkey = await signer.getPublicKey();

      expect(pubkey).toBeInstanceOf(Uint8Array);
      expect(pubkey.length).toBe(33);
      // Compressed pubkey starts with 0x02 or 0x03
      expect(pubkey[0] === 0x02 || pubkey[0] === 0x03).toBe(true);
    });
  });

  describe("getUncompressedPublicKey", () => {
    it("should return uncompressed public key (65 bytes)", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });

      const pubkey = await signer.getUncompressedPublicKey();

      expect(pubkey).toBeInstanceOf(Uint8Array);
      expect(pubkey.length).toBe(65);
      // Uncompressed pubkey starts with 0x04
      expect(pubkey[0]).toBe(0x04);
    });
  });

  describe("signHash", () => {
    it("should sign a 32-byte hash", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });

      const message = new TextEncoder().encode("Hello, World!");
      const hash = sha256(message);

      const result = await signer.signHash(hash);

      expect(result.signature).toBeInstanceOf(Uint8Array);
      expect(result.signature.length).toBe(64); // r + s
      expect(result.recoveryParam).toBeDefined();
      expect(result.recoveryParam).toBeGreaterThanOrEqual(0);
      expect(result.recoveryParam).toBeLessThanOrEqual(3);
    });

    it("should produce consistent signatures for same input", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });

      const hash = sha256(new TextEncoder().encode("Test message"));

      const result1 = await signer.signHash(hash);
      const result2 = await signer.signHash(hash);

      // Note: ECDSA with RFC6979 produces deterministic signatures
      expect(result1.signature).toEqual(result2.signature);
    });

    it("should throw for non-32-byte hash", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });

      const invalidHash = new Uint8Array(16);

      await expect(signer.signHash(invalidHash)).rejects.toThrow(SignerError);
      await expect(signer.signHash(invalidHash)).rejects.toMatchObject({
        code: SignerErrorCode.SIGNING_FAILED,
      });
    });
  });

  describe("deriveChild", () => {
    it("should derive child signer at different path", async () => {
      const rootSigner = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });

      const childSigner = await rootSigner.deriveChild("m/44'/118'/1'/0/0");

      expect(childSigner).toBeInstanceOf(Secp256k1Signer);

      const rootPubkey = await rootSigner.getPublicKey();
      const childPubkey = await childSigner.getPublicKey();

      expect(rootPubkey).not.toEqual(childPubkey);
    });

    it("should throw for private key signer (non-derivable)", async () => {
      const mnemonicSigner = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const privateKey = mnemonicSigner.getPrivateKey();
      const pkSigner = await Secp256k1Signer.fromPrivateKey({ privateKey });

      await expect(pkSigner.deriveChild("m/44'/0'/0'/0/0")).rejects.toThrow(
        SignerError,
      );
      await expect(
        pkSigner.deriveChild("m/44'/0'/0'/0/0"),
      ).rejects.toMatchObject({
        code: SignerErrorCode.DERIVATION_NOT_SUPPORTED,
      });
    });

    it("should throw for invalid derivation path", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });

      await expect(signer.deriveChild("invalid path")).rejects.toThrow(
        SignerError,
      );
      await expect(signer.deriveChild("invalid path")).rejects.toMatchObject({
        code: SignerErrorCode.INVALID_DERIVATION_PATH,
      });
    });
  });

  describe("canDerive", () => {
    it("should return true for mnemonic signer", async () => {
      const signer = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });

      expect(signer.canDerive()).toBe(true);
    });

    it("should return false for private key signer", async () => {
      const mnemonicSigner = await Secp256k1Signer.fromMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const pkSigner = await Secp256k1Signer.fromPrivateKey({
        privateKey: mnemonicSigner.getPrivateKey(),
      });

      expect(pkSigner.canDerive()).toBe(false);
    });
  });
});
