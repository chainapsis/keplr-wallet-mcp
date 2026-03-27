/**
 * Secp256k1 Signer Implementation
 *
 * Provides secp256k1 signing capabilities for both Cosmos and EVM ecosystems.
 * Supports BIP32/SLIP10 key derivation from mnemonics.
 */

import {
  Bip39,
  EnglishMnemonic,
  Secp256k1,
  Slip10,
  Slip10Curve,
  stringToPath,
} from "@cosmjs/crypto";
import {
  type CurveType,
  type DerivableSigner,
  type MnemonicSignerConfig,
  type PrivateKeySignerConfig,
  type Signer,
  SignerError,
  SignerErrorCode,
  type SignerSignature,
} from "./types.js";

/**
 * Default HD paths for different ecosystems.
 * Using BIP44 standard: m / purpose' / coin_type' / account' / change / address_index
 */
export const DEFAULT_HD_PATHS = {
  cosmos: "m/44'/118'/0'/0/0",
} as const;

/**
 * Secp256k1Signer provides signing using the secp256k1 elliptic curve.
 *
 * This is the standard curve for:
 * - Cosmos (all Cosmos SDK chains)
 * - EVM (Ethereum and all EVM-compatible chains)
 * - Bitcoin
 *
 * Supports HD derivation when created from a mnemonic.
 */
export class Secp256k1Signer implements DerivableSigner {
  readonly curve: CurveType = "secp256k1";
  readonly requiresInteraction = false;

  private privateKey: Uint8Array;
  private publicKeyCache?: Uint8Array;
  private seed?: Uint8Array; // For derivation
  private derivationPath?: string;

  private constructor(
    privateKey: Uint8Array,
    seed?: Uint8Array,
    derivationPath?: string,
  ) {
    this.privateKey = privateKey;
    this.seed = seed;
    this.derivationPath = derivationPath;
  }

  /**
   * Create a signer from a BIP39 mnemonic phrase.
   *
   * @param config Mnemonic configuration
   * @returns A derivable secp256k1 signer
   */
  static async fromMnemonic(
    config: MnemonicSignerConfig,
  ): Promise<Secp256k1Signer> {
    try {
      const englishMnemonic = new EnglishMnemonic(config.mnemonic);
      const seed = await Bip39.mnemonicToSeed(
        englishMnemonic,
        config.password || "",
      );

      const path = config.path || DEFAULT_HD_PATHS.cosmos;
      const { privkey } = Slip10.derivePath(
        Slip10Curve.Secp256k1,
        seed,
        stringToPath(path),
      );

      return new Secp256k1Signer(privkey, seed, path);
    } catch (error) {
      if (error instanceof Error && error.message.includes("mnemonic")) {
        throw new SignerError(
          "Invalid mnemonic phrase",
          SignerErrorCode.INVALID_MNEMONIC,
          error,
        );
      }
      throw new SignerError(
        `Failed to create signer from mnemonic: ${error instanceof Error ? error.message : String(error)}`,
        SignerErrorCode.INVALID_MNEMONIC,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Create a signer from a raw private key.
   *
   * Note: A signer created this way cannot derive child keys.
   *
   * @param config Private key configuration
   * @returns A secp256k1 signer (non-derivable)
   */
  static async fromPrivateKey(
    config: PrivateKeySignerConfig,
  ): Promise<Secp256k1Signer> {
    if (config.privateKey.length !== 32) {
      throw new SignerError(
        `Invalid private key length: expected 32 bytes, got ${config.privateKey.length}`,
        SignerErrorCode.INVALID_PRIVATE_KEY,
      );
    }

    // Validate the private key is valid for secp256k1
    try {
      // This will throw if the private key is invalid
      await Secp256k1.makeKeypair(config.privateKey);
    } catch (error) {
      throw new SignerError(
        "Invalid secp256k1 private key",
        SignerErrorCode.INVALID_PRIVATE_KEY,
        error instanceof Error ? error : undefined,
      );
    }

    return new Secp256k1Signer(config.privateKey);
  }

  async getPublicKey(): Promise<Uint8Array> {
    if (this.publicKeyCache) {
      return this.publicKeyCache;
    }

    const keypair = await Secp256k1.makeKeypair(this.privateKey);
    // Return compressed public key (33 bytes)
    this.publicKeyCache = Secp256k1.compressPubkey(keypair.pubkey);
    return this.publicKeyCache;
  }

  /**
   * Get the uncompressed public key (65 bytes).
   * Useful for EVM address derivation.
   */
  async getUncompressedPublicKey(): Promise<Uint8Array> {
    const keypair = await Secp256k1.makeKeypair(this.privateKey);
    return keypair.pubkey;
  }

  async signHash(hash: Uint8Array): Promise<SignerSignature> {
    if (hash.length !== 32) {
      throw new SignerError(
        `Invalid hash length: expected 32 bytes, got ${hash.length}`,
        SignerErrorCode.SIGNING_FAILED,
      );
    }

    try {
      const signature = await Secp256k1.createSignature(hash, this.privateKey);

      // The signature from CosmJS toFixedLength() returns 64 bytes (r || s)
      const fixedLengthSig = signature.toFixedLength();

      // Ensure we return exactly 64 bytes (r || s)
      // toFixedLength() should return 64 bytes, but we slice to be safe
      const sig64 = fixedLengthSig.slice(0, 64);

      // Calculate recovery parameter
      const recoveryParam = signature.recovery;

      return {
        signature: sig64,
        recoveryParam,
      };
    } catch (error) {
      throw new SignerError(
        `Signing failed: ${error instanceof Error ? error.message : String(error)}`,
        SignerErrorCode.SIGNING_FAILED,
        error instanceof Error ? error : undefined,
      );
    }
  }

  async deriveChild(path: string): Promise<Signer> {
    if (!this.seed) {
      throw new SignerError(
        "Cannot derive child keys: signer was not created from a mnemonic",
        SignerErrorCode.DERIVATION_NOT_SUPPORTED,
      );
    }

    try {
      const { privkey } = Slip10.derivePath(
        Slip10Curve.Secp256k1,
        this.seed,
        stringToPath(path),
      );

      return new Secp256k1Signer(privkey, this.seed, path);
    } catch (error) {
      throw new SignerError(
        `Invalid derivation path: ${path}`,
        SignerErrorCode.INVALID_DERIVATION_PATH,
        error instanceof Error ? error : undefined,
      );
    }
  }

  getDerivationPath(): string | undefined {
    return this.derivationPath;
  }

  /**
   * Check if this signer supports HD derivation.
   */
  canDerive(): boolean {
    return this.seed !== undefined;
  }

  /**
   * Get the raw private key bytes.
   *
   * WARNING: Handle with extreme care. Never log or expose this value.
   */
  getPrivateKey(): Uint8Array {
    return this.privateKey;
  }
}

/**
 * Create a Secp256k1Signer from a mnemonic with default settings.
 */
export const createSecp256k1Signer = async (
  mnemonic: string,
  path?: string,
): Promise<Secp256k1Signer> => {
  return Secp256k1Signer.fromMnemonic({ mnemonic, path });
};
