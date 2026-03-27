import { describe, expect, it } from "vitest";
import { EthermintHdWallet } from "../../clients/ethermint-wallet.js";

// BIP39 test vector mnemonic (DO NOT use for real funds)
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("EthermintHdWallet", () => {
  describe("fromMnemonic", () => {
    it("should derive keccak256-based bech32 address for ethermint chains", async () => {
      const wallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "ethm",
      );
      const [account] = await wallet.getAccounts();

      expect(account.address).toMatch(/^ethm1/);
      expect(account.algo).toBe("secp256k1");
      expect(account.pubkey).toBeInstanceOf(Uint8Array);
      expect(account.pubkey.length).toBe(33); // compressed pubkey
    });

    it("should derive different addresses for different prefixes", async () => {
      const ethmWallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "ethm",
      );
      const injWallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "inj",
      );
      const [ethmAccount] = await ethmWallet.getAccounts();
      const [injAccount] = await injWallet.getAccounts();

      // Same key derivation but different bech32 prefixes
      expect(ethmAccount.address).toMatch(/^ethm1/);
      expect(injAccount.address).toMatch(/^inj1/);
      // Same underlying raw address (different prefix encoding)
      expect(ethmAccount.pubkey).toEqual(injAccount.pubkey);
    });

    it("should produce different address than standard Cosmos derivation", async () => {
      const { DirectSecp256k1HdWallet } = await import("@cosmjs/proto-signing");

      // Standard Cosmos wallet (coinType 118, ripemd160 address)
      const cosmosWallet = await DirectSecp256k1HdWallet.fromMnemonic(
        TEST_MNEMONIC,
        { prefix: "cosmos" },
      );
      const [cosmosAccount] = await cosmosWallet.getAccounts();

      // Ethermint wallet (coinType 60, keccak256 address)
      const ethermintWallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "cosmos",
      );
      const [ethermintAccount] = await ethermintWallet.getAccounts();

      // Addresses must differ (different key + different hash algorithm)
      expect(cosmosAccount.address).not.toBe(ethermintAccount.address);
    });

    it("should use custom HD path when provided", async () => {
      const defaultWallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "ethm",
      );
      const customWallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "ethm",
        "m/44'/118'/0'/0/0",
      );
      const [defaultAccount] = await defaultWallet.getAccounts();
      const [customAccount] = await customWallet.getAccounts();

      // Different HD paths produce different keys and addresses
      expect(defaultAccount.address).not.toBe(customAccount.address);
    });
  });

  describe("signDirect", () => {
    it("should reject signing with wrong address", async () => {
      const wallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "ethm",
      );

      const fakeSignDoc = {
        bodyBytes: new Uint8Array([1, 2, 3]),
        authInfoBytes: new Uint8Array([4, 5, 6]),
        chainId: "test-1",
        accountNumber: BigInt(0),
      };

      await expect(
        wallet.signDirect("ethm1wrongaddress", fakeSignDoc),
      ).rejects.toThrow("not found in wallet");
    });

    it("should sign with correct address", async () => {
      const wallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "ethm",
      );
      const [account] = await wallet.getAccounts();

      const signDoc = {
        bodyBytes: new Uint8Array([1, 2, 3]),
        authInfoBytes: new Uint8Array([4, 5, 6]),
        chainId: "test-1",
        accountNumber: BigInt(0),
      };

      const result = await wallet.signDirect(account.address, signDoc);

      expect(result.signed).toBe(signDoc);
      expect(result.signature).toBeDefined();
      expect(result.signature.pub_key).toBeDefined();
      expect(result.signature.signature).toBeTruthy();
    });
  });
});
