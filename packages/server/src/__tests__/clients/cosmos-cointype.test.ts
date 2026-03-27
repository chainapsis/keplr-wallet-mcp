import { stringToPath } from "@cosmjs/crypto";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { describe, expect, it } from "vitest";
import { EthermintHdWallet } from "../../clients/ethermint-wallet.js";

// BIP39 test vector mnemonic (DO NOT use for real funds)
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("CoinType-aware address derivation", () => {
  describe("non-118 Cosmos chains", () => {
    it("should derive different address for coinType 330 (Terra)", async () => {
      const cosmos118 = await DirectSecp256k1HdWallet.fromMnemonic(
        TEST_MNEMONIC,
        {
          prefix: "terra",
          hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
        },
      );
      const terra330 = await DirectSecp256k1HdWallet.fromMnemonic(
        TEST_MNEMONIC,
        {
          prefix: "terra",
          hdPaths: [stringToPath("m/44'/330'/0'/0/0")],
        },
      );

      const [cosmos118Account] = await cosmos118.getAccounts();
      const [terra330Account] = await terra330.getAccounts();

      expect(cosmos118Account.address).toMatch(/^terra1/);
      expect(terra330Account.address).toMatch(/^terra1/);
      expect(cosmos118Account.address).not.toBe(terra330Account.address);
    });

    it("should derive different address for coinType 505 (Provenance)", async () => {
      const cosmos118 = await DirectSecp256k1HdWallet.fromMnemonic(
        TEST_MNEMONIC,
        {
          prefix: "pb",
          hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
        },
      );
      const pb505 = await DirectSecp256k1HdWallet.fromMnemonic(TEST_MNEMONIC, {
        prefix: "pb",
        hdPaths: [stringToPath("m/44'/505'/0'/0/0")],
      });

      const [cosmos118Account] = await cosmos118.getAccounts();
      const [pb505Account] = await pb505.getAccounts();

      expect(cosmos118Account.address).toMatch(/^pb1/);
      expect(pb505Account.address).toMatch(/^pb1/);
      expect(cosmos118Account.address).not.toBe(pb505Account.address);
    });
  });

  describe("EVM chains (eth-address-gen)", () => {
    it("should derive keccak256 address for XRPL EVM", async () => {
      const wallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "ethm",
        "m/44'/60'/0'/0/0",
      );
      const [account] = await wallet.getAccounts();

      expect(account.address).toMatch(/^ethm1/);
    });

    it("should derive keccak256 address for Injective", async () => {
      const wallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "inj",
        "m/44'/60'/0'/0/0",
      );
      const [account] = await wallet.getAccounts();

      expect(account.address).toMatch(/^inj1/);
    });

    it("should not match standard Cosmos address for same prefix", async () => {
      // If someone mistakenly used standard Cosmos derivation for an EVM chain
      const cosmosWallet = await DirectSecp256k1HdWallet.fromMnemonic(
        TEST_MNEMONIC,
        {
          prefix: "inj",
          hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
        },
      );
      const ethermintWallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "inj",
        "m/44'/60'/0'/0/0",
      );

      const [cosmosAccount] = await cosmosWallet.getAccounts();
      const [ethermintAccount] = await ethermintWallet.getAccounts();

      // Both address derivation path AND hash algorithm differ
      expect(cosmosAccount.address).not.toBe(ethermintAccount.address);
    });
  });
});
