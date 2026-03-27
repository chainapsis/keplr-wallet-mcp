/**
 * Ethermint-compatible HD Wallet implementing OfflineDirectSigner.
 *
 * For chains with custom EthAccount types (Injective, Dymension, XRPL EVM):
 * - Address derivation: keccak256(uncompressedPubkey[1:])[12:] → bech32
 * - HD path: m/44'/60'/0'/0/0 (coinType 60)
 * - signDirect: patches AuthInfo pubkey typeUrl to ethsecp256k1 before signing
 */

import { encodeSecp256k1Signature } from "@cosmjs/amino";
import {
  Bip39,
  EnglishMnemonic,
  keccak256,
  Secp256k1,
  Slip10,
  Slip10Curve,
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
import { AuthInfo } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";

const ETHERMINT_HD_PATH = "m/44'/60'/0'/0/0";

export class EthermintHdWallet implements OfflineDirectSigner {
  private constructor(
    private readonly privkey: Uint8Array,
    private readonly compressedPubkey: Uint8Array,
    private readonly address: string,
    private readonly pubkeyTypeUrl: string,
  ) {}

  static async fromMnemonic(
    mnemonic: string,
    prefix: string,
    pubkeyTypeUrl: string,
  ): Promise<EthermintHdWallet> {
    const englishMnemonic = new EnglishMnemonic(mnemonic);
    const seed = await Bip39.mnemonicToSeed(englishMnemonic);
    const { privkey } = Slip10.derivePath(
      Slip10Curve.Secp256k1,
      seed,
      stringToPath(ETHERMINT_HD_PATH),
    );

    const keypair = await Secp256k1.makeKeypair(privkey);
    const compressedPubkey = Secp256k1.compressPubkey(keypair.pubkey);

    // EVM address: last 20 bytes of keccak256(uncompressed_pubkey without 0x04 prefix)
    const rawAddress = keccak256(keypair.pubkey.slice(1)).slice(12);
    const address = toBech32(prefix, rawAddress);

    return new EthermintHdWallet(
      privkey,
      compressedPubkey,
      address,
      pubkeyTypeUrl,
    );
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
    const [account] = await this.getAccounts();
    if (signerAddress !== account.address) {
      throw new Error(
        `Address ${signerAddress} not found in wallet (have ${account.address})`,
      );
    }

    // Patch AuthInfo: replace pubkey typeUrl with ethsecp256k1 variant
    const authInfo = AuthInfo.decode(signDoc.authInfoBytes);
    for (const signerInfo of authInfo.signerInfos) {
      if (signerInfo.publicKey?.typeUrl.includes("secp256k1")) {
        signerInfo.publicKey = {
          typeUrl: this.pubkeyTypeUrl,
          value: signerInfo.publicKey.value,
        };
      }
    }
    const patchedAuthInfoBytes = AuthInfo.encode(authInfo).finish();
    const patchedSignDoc: SignDoc = {
      ...signDoc,
      authInfoBytes: patchedAuthInfoBytes,
    };

    // Sign the patched SignDoc
    // Ethermint's ethsecp256k1 uses keccak256 for signature hashing (not sha256)
    const signBytes = makeSignBytes(patchedSignDoc);
    const hash = keccak256(signBytes);
    const signature = await Secp256k1.createSignature(hash, this.privkey);
    const signatureBytes = new Uint8Array([
      ...signature.r(32),
      ...signature.s(32),
    ]);

    return {
      signed: patchedSignDoc,
      signature: encodeSecp256k1Signature(
        this.compressedPubkey,
        signatureBytes,
      ),
    };
  }
}
