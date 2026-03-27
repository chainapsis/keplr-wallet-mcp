import { keccak256, Secp256k1, Secp256k1Signature } from "@cosmjs/crypto";
import { fromBech32 } from "@cosmjs/encoding";
import { makeSignBytes } from "@cosmjs/proto-signing";
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing.js";
import { AuthInfo, type SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { Any } from "cosmjs-types/google/protobuf/any.js";
import { describe, expect, it } from "vitest";
import { EthermintHdWallet } from "../../../clients/ethermint/wallet.js";

// Well-known test mnemonic
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("EthermintHdWallet", () => {
  describe("fromMnemonic", () => {
    it("derives a valid bech32 address with the given prefix", async () => {
      const wallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "inj",
        "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
      );
      const [account] = await wallet.getAccounts();
      expect(account.address).toMatch(/^inj1/);
      // keccak256-derived address is 20 bytes
      expect(fromBech32(account.address).data.length).toBe(20);
    });

    it("produces different address than standard cosmos derivation", async () => {
      const { DirectSecp256k1HdWallet } = await import("@cosmjs/proto-signing");
      const cosmosWallet = await DirectSecp256k1HdWallet.fromMnemonic(
        TEST_MNEMONIC,
        { prefix: "inj" },
      );
      const ethermintWallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "inj",
        "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
      );

      const [cosmosAccount] = await cosmosWallet.getAccounts();
      const [ethermintAccount] = await ethermintWallet.getAccounts();
      expect(ethermintAccount.address).not.toBe(cosmosAccount.address);
    });

    it("returns compressed secp256k1 pubkey (33 bytes)", async () => {
      const wallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "inj",
        "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
      );
      const [account] = await wallet.getAccounts();
      expect(account.pubkey.length).toBe(33);
      expect(account.algo).toBe("secp256k1");
    });

    it("derives different addresses for different prefixes", async () => {
      const injWallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "inj",
        "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
      );
      const dymWallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "dym",
        "/ethermint.crypto.v1.ethsecp256k1.PubKey",
      );

      const [injAccount] = await injWallet.getAccounts();
      const [dymAccount] = await dymWallet.getAccounts();

      // Same raw bytes, different bech32 prefix
      expect(injAccount.address).toMatch(/^inj1/);
      expect(dymAccount.address).toMatch(/^dym1/);
      expect(fromBech32(injAccount.address).data).toEqual(
        fromBech32(dymAccount.address).data,
      );
    });
  });

  describe("signDirect", () => {
    it("patches AuthInfo pubkey typeUrl to ethsecp256k1", async () => {
      const wallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "inj",
        "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
      );
      const [account] = await wallet.getAccounts();

      // Build a minimal SignDoc with standard cosmos pubkey
      const authInfo = AuthInfo.fromPartial({
        signerInfos: [
          {
            publicKey: Any.fromPartial({
              typeUrl: "/cosmos.crypto.secp256k1.PubKey",
              value: new Uint8Array([10, 33, ...account.pubkey]),
            }),
            modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } },
            sequence: 0n,
          },
        ],
        fee: { amount: [], gasLimit: 200000n },
      });

      const signDoc: SignDoc = {
        bodyBytes: new Uint8Array([10, 0]),
        authInfoBytes: AuthInfo.encode(authInfo).finish(),
        chainId: "injective-1",
        accountNumber: 1635031n,
      };

      const result = await wallet.signDirect(account.address, signDoc);

      // Verify the patched AuthInfo has ethsecp256k1 typeUrl
      const patchedAuthInfo = AuthInfo.decode(result.signed.authInfoBytes);
      expect(patchedAuthInfo.signerInfos[0].publicKey?.typeUrl).toBe(
        "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
      );
      // Pubkey value bytes should be preserved
      expect(patchedAuthInfo.signerInfos[0].publicKey?.value).toEqual(
        authInfo.signerInfos[0].publicKey?.value,
      );
    });

    it("produces a valid secp256k1 signature over patched SignDoc", async () => {
      const wallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "inj",
        "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
      );
      const [account] = await wallet.getAccounts();

      const authInfo = AuthInfo.fromPartial({
        signerInfos: [
          {
            publicKey: Any.fromPartial({
              typeUrl: "/cosmos.crypto.secp256k1.PubKey",
              value: new Uint8Array([10, 33, ...account.pubkey]),
            }),
            modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } },
            sequence: 0n,
          },
        ],
        fee: { amount: [], gasLimit: 200000n },
      });

      const signDoc: SignDoc = {
        bodyBytes: new Uint8Array([10, 0]),
        authInfoBytes: AuthInfo.encode(authInfo).finish(),
        chainId: "injective-1",
        accountNumber: 1n,
      };

      const result = await wallet.signDirect(account.address, signDoc);

      // Verify signature is valid for the PATCHED SignDoc
      const signBytes = makeSignBytes(result.signed);
      const hash = keccak256(signBytes);
      const { fromBase64 } = await import("@cosmjs/encoding");
      const sigBytes = fromBase64(result.signature.signature);
      const sig = Secp256k1Signature.fromFixedLength(sigBytes);
      const valid = await Secp256k1.verifySignature(sig, hash, account.pubkey);
      expect(valid).toBe(true);
    });

    it("throws when signerAddress does not match wallet address", async () => {
      const wallet = await EthermintHdWallet.fromMnemonic(
        TEST_MNEMONIC,
        "inj",
        "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
      );

      const signDoc: SignDoc = {
        bodyBytes: new Uint8Array([]),
        authInfoBytes: new Uint8Array([]),
        chainId: "injective-1",
        accountNumber: 1n,
      };

      await expect(
        wallet.signDirect("inj1wrongaddress", signDoc),
      ).rejects.toThrow("not found in wallet");
    });
  });
});
