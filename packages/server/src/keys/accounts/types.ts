/**
 * Account Layer (Layer 2)
 *
 * Account type abstractions. This layer distinguishes between
 * different account models (EOA, Smart Account) and handles
 * address derivation and ecosystem compatibility.
 *
 * Hierarchy:
 *   KeyProvider (orchestration)
 *     → Account (EOA vs Smart Account) ← This layer
 *       → Signer (curve-specific primitives)
 */

import type { Signer } from "../signers/types.js";
import type { EcosystemType } from "../types.js";

/**
 * Types of accounts.
 * - eoa: Externally Owned Account (controlled by private key)
 */
export type AccountKind = "eoa";

/**
 * Context for address derivation.
 */
export interface AddressContext {
  /** Target ecosystem (cosmos, evm) */
  ecosystem: EcosystemType;
  /** Chain ID for chain-specific addresses */
  chainId?: string;
  /** Bech32 prefix for Cosmos addresses */
  bech32Prefix?: string;
}

/**
 * Base interface for all account types.
 *
 * An Account represents a blockchain identity that can sign transactions.
 * It abstracts over the underlying signer(s) and provides ecosystem-specific
 * address derivation.
 */
export interface Account {
  /** The type of account */
  readonly kind: AccountKind;

  /**
   * Get the address for a specific ecosystem/chain context.
   *
   * @param context Address derivation context
   * @returns The address string (bech32 for Cosmos, 0x-prefixed for EVM)
   */
  getAddress(context: AddressContext): Promise<string>;

  /**
   * Get all signers associated with this account.
   *
   * - EOA: Returns a single signer
   * - Smart Account: Returns owner signer(s)
   */
  getSigners(): Signer[];

  /**
   * Check if this account supports a specific ecosystem.
   *
   * @param ecosystem The ecosystem to check
   * @returns true if the account can be used with this ecosystem
   */
  supportsEcosystem(ecosystem: EcosystemType): boolean;

  /**
   * Get the public key for a specific context.
   *
   * @param context Address derivation context
   * @returns The public key bytes or undefined if not available
   */
  getPublicKey(context: AddressContext): Promise<Uint8Array | undefined>;
}

/**
 * Externally Owned Account (EOA).
 *
 * An EOA is controlled by a single private key. The address is
 * deterministically derived from the public key.
 *
 * Constraints:
 * - Must use secp256k1 curve (for Cosmos/EVM compatibility)
 * - Single signer only
 */
export interface EOAAccount extends Account {
  readonly kind: "eoa";

  /** The signer controlling this EOA (must be secp256k1) */
  readonly signer: Signer;
}

/**
 * Error thrown when account operations fail.
 */
export class AccountError extends Error {
  constructor(
    message: string,
    public readonly code: AccountErrorCode,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

/**
 * Error codes for account operations.
 */
export enum AccountErrorCode {
  /** Ecosystem not supported by this account */
  UNSUPPORTED_ECOSYSTEM = "UNSUPPORTED_ECOSYSTEM",
  /** Signer curve not compatible with account type */
  INCOMPATIBLE_SIGNER = "INCOMPATIBLE_SIGNER",
  /** Smart account not deployed */
  NOT_DEPLOYED = "NOT_DEPLOYED",
  /** Failed to build user operation */
  BUILD_OPERATION_FAILED = "BUILD_OPERATION_FAILED",
  /** Invalid account configuration */
  INVALID_CONFIG = "INVALID_CONFIG",
}
