/**
 * Ethermint-compatible HD Wallet
 *
 * For chains with "eth-address-gen" feature flag (e.g., Injective, XRPL EVM, Dymension).
 * Uses keccak256(uncompressed_pubkey[1:]) for address derivation instead of
 * ripemd160(sha256(compressed_pubkey)) used by standard Cosmos chains.
 */

import { encodeSecp256k1Signature } from "@cosmjs/amino";
import {
  Bip39,
  EnglishMnemonic,
  keccak256,
  Secp256k1,
  Slip10,
  Slip10Curve,
  sha256,
  stringToPath,
} from "@cosmjs/crypto";
import { toBech32 } from "@cosmjs/encoding";
import {
  type AccountData,
  type DirectSignResponse,
  makeSignBytes,
  type OfflineDirectSigner,
} from "@cosmjs/proto-signing";
import type { SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";

export class EthermintHdWallet implements OfflineDirectSigner {
  private privkey: Uint8Array;
  private compressedPubkey: Uint8Array;
  private address: string;

  private constructor(
    privkey: Uint8Array,
    compressedPubkey: Uint8Array,
    address: string,
  ) {
    this.privkey = privkey;
    this.compressedPubkey = compressedPubkey;
    this.address = address;
  }

  static async fromMnemonic(
    mnemonic: string,
    prefix: string,
    hdPath = "m/44'/60'/0'/0/0",
  ): Promise<EthermintHdWallet> {
    const englishMnemonic = new EnglishMnemonic(mnemonic);
    const seed = await Bip39.mnemonicToSeed(englishMnemonic);
    const { privkey } = Slip10.derivePath(
      Slip10Curve.Secp256k1,
      seed,
      stringToPath(hdPath),
    );

    const keypair = await Secp256k1.makeKeypair(privkey);
    const compressedPubkey = Secp256k1.compressPubkey(keypair.pubkey);

    // EVM address: last 20 bytes of keccak256(uncompressed_pubkey without 0x04 prefix)
    const rawAddress = keccak256(keypair.pubkey.slice(1)).slice(12);
    const address = toBech32(prefix, rawAddress);

    return new EthermintHdWallet(privkey, compressedPubkey, address);
  }

  async getAccounts(): Promise<readonly AccountData[]> {
    return [
      {
        address: this.address,
        algo: "secp256k1" as const,
        pubkey: this.compressedPubkey,
      },
    ];
  }

  async signDirect(
    signerAddress: string,
    signDoc: SignDoc,
  ): Promise<DirectSignResponse> {
    if (signerAddress !== this.address) {
      throw new Error(`Address ${signerAddress} not found in wallet`);
    }

    const signBytes = makeSignBytes(signDoc);
    const hashedMessage = sha256(signBytes);
    const signature = await Secp256k1.createSignature(
      hashedMessage,
      this.privkey,
    );

    // toFixedLength() may include recovery byte; Cosmos SDK expects exactly 64 bytes (r || s)
    const sig64 = signature.toFixedLength().slice(0, 64);

    return {
      signed: signDoc,
      signature: encodeSecp256k1Signature(this.compressedPubkey, sig64),
    };
  }
}
