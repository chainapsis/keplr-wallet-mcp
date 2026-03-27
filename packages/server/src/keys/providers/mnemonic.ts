/**
 * Mnemonic (BIP39) Key Provider
 *
 * Provides key management using BIP39 mnemonic phrases.
 * Supports both Cosmos (secp256k1) and EVM (secp256k1) ecosystems.
 *
 * Architecture:
 *   MnemonicKeyProvider (Layer 3: KeyProvider)
 *     → EOAAccountImpl (Layer 2: Account)
 *       → Secp256k1Signer (Layer 1: Signer)
 */

import { sha256 } from "@cosmjs/crypto";
import { EOAAccountImpl } from "../accounts/eoa.js";
import type { Account } from "../accounts/types.js";
import { DEFAULT_HD_PATHS, Secp256k1Signer } from "../signers/secp256k1.js";
import {
  type AddressContext,
  type EcosystemType,
  type KeyProvider,
  type KeyProviderCapabilities,
  KeyProviderError,
  KeyProviderErrorCode,
  type MnemonicKeyProviderConfig,
  type SignRequest,
  type SignResponse,
} from "../types.js";

/**
 * MnemonicKeyProvider implements KeyProvider using BIP39 mnemonics.
 *
 * This provider:
 * - Stores mnemonic in memory (inherent JS limitation)
 * - Derives keys for both Cosmos and EVM ecosystems
 * - Supports secp256k1 curve only
 * - Can export private keys (has the mnemonic)
 *
 * Internal structure:
 * - Uses Secp256k1Signer for cryptographic operations
 * - Uses EOAAccountImpl for address derivation
 */
export class MnemonicKeyProvider implements KeyProvider {
  readonly type = "mnemonic" as const;
  readonly displayName = "Mnemonic Wallet";
  readonly capabilities: KeyProviderCapabilities = {
    curves: ["secp256k1"],
    signTypes: ["direct", "amino", "adr36"],
    canExportKey: true,
    requiresUserInteraction: false,
    supportsDerivation: true,
  };

  private mnemonic: string;
  private hdPathPrefix?: string;

  // Layer 1 & 2 abstractions (lazy initialized)
  private _signer?: Secp256k1Signer;
  private _account?: EOAAccountImpl;

  /**
   * Create a MnemonicKeyProvider.
   *
   * Note: This validates the mnemonic but doesn't initialize
   * the signer/account until first use (lazy initialization).
   */
  constructor(config: MnemonicKeyProviderConfig) {
    if (!config.mnemonic || config.mnemonic.trim() === "") {
      throw new KeyProviderError(
        "Mnemonic is required",
        KeyProviderErrorCode.INVALID_CONFIG,
      );
    }
    this.mnemonic = config.mnemonic;
    this.hdPathPrefix = config.hdPathPrefix;
  }

  /**
   * Ensure signer and account are initialized.
   * Called lazily on first use.
   */
  private async ensureInitialized(): Promise<void> {
    if (this._signer && this._account) return;

    this._signer = await Secp256k1Signer.fromMnemonic({
      mnemonic: this.mnemonic,
      path: this.hdPathPrefix || DEFAULT_HD_PATHS.cosmos,
    });
    this._account = new EOAAccountImpl(this._signer);
  }

  /**
   * Get the signer (throws if not initialized).
   */
  private get signer(): Secp256k1Signer {
    if (!this._signer) {
      throw new KeyProviderError(
        "Provider not initialized. Call getAddress() or sign() first.",
        KeyProviderErrorCode.NOT_READY,
      );
    }
    return this._signer;
  }

  /**
   * Get the account (throws if not initialized).
   */
  private get account(): EOAAccountImpl {
    if (!this._account) {
      throw new KeyProviderError(
        "Provider not initialized. Call getAddress() or sign() first.",
        KeyProviderErrorCode.NOT_READY,
      );
    }
    return this._account;
  }

  async getAddress(context: AddressContext): Promise<string> {
    await this.ensureInitialized();
    try {
      return await this.account.getAddress({
        ecosystem: context.ecosystem as EcosystemType,
        chainId: context.chainId,
        bech32Prefix: context.bech32Prefix,
      });
    } catch (error) {
      // Re-throw as KeyProviderError for backward compatibility
      if (error instanceof Error && error.name === "AccountError") {
        throw new KeyProviderError(
          error.message,
          KeyProviderErrorCode.UNSUPPORTED_CHAIN,
          error,
        );
      }
      throw error;
    }
  }

  async getPublicKey(context: AddressContext): Promise<Uint8Array | undefined> {
    await this.ensureInitialized();
    return this.account.getPublicKey({
      ecosystem: context.ecosystem as EcosystemType,
      chainId: context.chainId,
      bech32Prefix: context.bech32Prefix,
    });
  }

  async sign(request: SignRequest): Promise<SignResponse> {
    await this.ensureInitialized();

    if (request.ecosystem === "cosmos") {
      return this.signCosmos(request);
    }

    throw new KeyProviderError(
      `Unsupported ecosystem: ${request.ecosystem}`,
      KeyProviderErrorCode.UNSUPPORTED_CHAIN,
    );
  }

  private async signCosmos(request: SignRequest): Promise<SignResponse> {
    if (
      request.signType !== "direct" &&
      request.signType !== "amino" &&
      request.signType !== "adr36"
    ) {
      throw new KeyProviderError(
        `Unsupported sign type for Cosmos: ${request.signType}`,
        KeyProviderErrorCode.UNSUPPORTED_SIGN_TYPE,
      );
    }

    // For Cosmos signing, we expect the data to be the sign bytes
    // ADR-36 also uses amino format, so it's handled the same way
    const signBytes =
      request.data instanceof Uint8Array
        ? request.data
        : new TextEncoder().encode(JSON.stringify(request.data));

    // Hash the data with SHA-256 (Cosmos standard)
    const hashedData = sha256(signBytes);

    // Sign using the signer
    const sigResult = await this.signer.signHash(hashedData);

    // Get public key for the response
    const publicKey = await this.signer.getPublicKey();

    return {
      signature: sigResult.signature,
      publicKey,
    };
  }

  async isReady(): Promise<boolean> {
    // Mnemonic provider is always ready if it was constructed
    return true;
  }

  async disconnect(): Promise<void> {
    // Clear caches
    if (this._account) {
      this._account.clearCache();
    }
    // Note: Cannot securely erase mnemonic from JS memory
  }

  async getAllAddresses(): Promise<Map<string, string>> {
    await this.ensureInitialized();

    const addresses = new Map<string, string>();

    // Cosmos address (with common prefixes)
    const cosmosAddress = await this.getAddress({
      ecosystem: "cosmos",
      bech32Prefix: "cosmos",
    });
    addresses.set("cosmos", cosmosAddress);

    return addresses;
  }

  /**
   * Get the mnemonic phrase (for backup/export).
   * Only available for mnemonic providers.
   */
  getMnemonic(): string {
    return this.mnemonic;
  }

  /**
   * Get the ecosystems supported by this provider.
   * Mnemonic wallets support Cosmos ecosystem only.
   */
  getSupportedEcosystems(): EcosystemType[] {
    return ["cosmos"];
  }

  /**
   * Get the internal Account abstraction.
   * Part of the 3-layer key architecture.
   *
   * Note: Returns undefined if not yet initialized (lazy loading).
   * Call getAddress() or sign() first to initialize.
   */
  getAccount(): Account | undefined {
    return this._account;
  }

  /**
   * Check if this provider uses Passkey.
   * Always false for mnemonic providers.
   */
  isPasskeyOwned(): boolean {
    return false;
  }

  /**
   * Get the internal Signer.
   * Useful for direct access to signing primitives.
   *
   * Note: Returns undefined if not yet initialized (lazy loading).
   * Call getAddress() or sign() first to initialize.
   */
  getSigner(): Secp256k1Signer | undefined {
    return this._signer;
  }
}

/**
 * Create a MnemonicKeyProvider from configuration.
 */
export const createMnemonicProvider = async (
  config: MnemonicKeyProviderConfig,
): Promise<MnemonicKeyProvider> => {
  // Create the provider (validates mnemonic)
  const provider = new MnemonicKeyProvider(config);

  // Eagerly initialize to ensure mnemonic is valid
  await provider.getAddress({ ecosystem: "cosmos" });

  return provider;
};
