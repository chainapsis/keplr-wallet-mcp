/**
 * EOA (Externally Owned Account) Implementation
 *
 * Standard account type controlled by a single secp256k1 private key.
 * Supports both Cosmos and EVM ecosystems.
 */

import { rawSecp256k1PubkeyToRawAddress } from "@cosmjs/amino";
import { toBech32 } from "@cosmjs/encoding";
import type { Secp256k1Signer } from "../signers/secp256k1.js";
import type { Signer } from "../signers/types.js";
import type { EcosystemType } from "../types.js";
import {
  AccountError,
  AccountErrorCode,
  type AddressContext,
  type EOAAccount,
} from "./types.js";

/**
 * Supported ecosystems for EOA accounts with secp256k1.
 */
const EOA_SUPPORTED_ECOSYSTEMS: EcosystemType[] = ["cosmos"];

/**
 * EOAAccountImpl provides an EOA account implementation.
 *
 * Features:
 * - Single secp256k1 signer
 * - Cosmos address derivation (bech32)
 * - EVM address derivation (keccak256 of pubkey)
 * - Caching for derived addresses
 */
export class EOAAccountImpl implements EOAAccount {
  readonly kind = "eoa" as const;
  readonly signer: Signer;

  private addressCache = new Map<string, string>();

  constructor(signer: Signer) {
    // Validate signer is secp256k1
    if (signer.curve !== "secp256k1") {
      throw new AccountError(
        `EOA accounts require secp256k1 signer, got ${signer.curve}`,
        AccountErrorCode.INCOMPATIBLE_SIGNER,
      );
    }
    this.signer = signer;
  }

  /**
   * Create an EOA from a Secp256k1Signer.
   */
  static fromSigner(signer: Secp256k1Signer): EOAAccountImpl {
    return new EOAAccountImpl(signer);
  }

  async getAddress(context: AddressContext): Promise<string> {
    if (!this.supportsEcosystem(context.ecosystem)) {
      throw new AccountError(
        `EOA does not support ecosystem: ${context.ecosystem}`,
        AccountErrorCode.UNSUPPORTED_ECOSYSTEM,
      );
    }

    const cacheKey = this.makeCacheKey(context);
    const cached = this.addressCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let address: string;

    if (context.ecosystem === "cosmos") {
      address = await this.deriveCosmosAddress(
        context.bech32Prefix || "cosmos",
      );
    } else {
      throw new AccountError(
        `Unknown ecosystem: ${context.ecosystem}`,
        AccountErrorCode.UNSUPPORTED_ECOSYSTEM,
      );
    }

    this.addressCache.set(cacheKey, address);
    return address;
  }

  getSigners(): Signer[] {
    return [this.signer];
  }

  supportsEcosystem(ecosystem: EcosystemType): boolean {
    return EOA_SUPPORTED_ECOSYSTEMS.includes(ecosystem);
  }

  async getPublicKey(context: AddressContext): Promise<Uint8Array | undefined> {
    if (!this.supportsEcosystem(context.ecosystem)) {
      return undefined;
    }
    // Return compressed public key for all ecosystems
    return this.signer.getPublicKey();
  }

  /**
   * Get the ecosystems this account supports.
   */
  getSupportedEcosystems(): EcosystemType[] {
    return [...EOA_SUPPORTED_ECOSYSTEMS];
  }

  private makeCacheKey(context: AddressContext): string {
    if (context.ecosystem === "cosmos") {
      return `cosmos:${context.bech32Prefix || "cosmos"}`;
    }
    return context.ecosystem;
  }

  /**
   * Derive a Cosmos bech32 address from the public key.
   */
  private async deriveCosmosAddress(bech32Prefix: string): Promise<string> {
    const compressedPubkey = await this.signer.getPublicKey();

    // Convert compressed pubkey to raw address (20 bytes)
    // This is: RIPEMD160(SHA256(pubkey))
    const rawAddress = rawSecp256k1PubkeyToRawAddress(compressedPubkey);

    // Encode as bech32
    return toBech32(bech32Prefix, rawAddress);
  }

  /**
   * Clear the address cache.
   * Call this if the underlying signer changes (shouldn't normally happen).
   */
  clearCache(): void {
    this.addressCache.clear();
  }
}

/**
 * Create an EOA account from a signer.
 */
export const createEOAAccount = (signer: Secp256k1Signer): EOAAccountImpl => {
  return new EOAAccountImpl(signer);
};
