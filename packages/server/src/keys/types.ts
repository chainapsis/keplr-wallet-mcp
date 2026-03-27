/**
 * Key Management Abstraction
 *
 * This module provides a unified interface for different key management strategies:
 * - Mnemonic (BIP39)
 * - Passkey/WebAuthn (future)
 * - Smart Account / Account Abstraction (future)
 *
 * Architecture: 3-Layer Key Abstraction
 *   Layer 3: KeyProvider (orchestration, this file)
 *   Layer 2: Account (EOA vs Smart Account) - ./accounts/
 *   Layer 1: Signer (curve-specific primitives) - ./signers/
 */

import type { Account } from "./accounts/types.js";

/**
 * Supported ecosystem types.
 * These are managed centrally so KeyProviders can declare which ecosystems they support.
 */
export type EcosystemType = "cosmos";

/**
 * Supported key provider types.
 * - mnemonic: BIP39 seed phrase stored in OS keychain
 * - passkey: WebAuthn/FIDO2 credential (future)
 * - smart-account: ERC-4337 or EIP-7702 smart account (future)
 */
export type KeyProviderType = "mnemonic" | "passkey" | "smart-account";

/**
 * Elliptic curve types supported by key providers.
 */
export type CurveType = "secp256k1" | "p256" | "ed25519";

/**
 * Signature types that can be requested.
 */
export type SignType =
  | "direct" // Cosmos Direct (protobuf)
  | "amino" // Cosmos Amino (legacy JSON)
  | "adr36"; // Cosmos ADR-36 (arbitrary message signing)

/**
 * Capabilities of a key provider.
 */
export interface KeyProviderCapabilities {
  /** Supported elliptic curves */
  curves: CurveType[];
  /** Supported signature types */
  signTypes: SignType[];
  /** Whether the private key can be exported (mnemonic only) */
  canExportKey: boolean;
  /** Whether signing requires user interaction (e.g., passkey) */
  requiresUserInteraction: boolean;
  /** Whether multiple addresses can be derived (HD wallets) */
  supportsDerivation: boolean;
}

/**
 * Context for address derivation.
 */
export interface AddressContext {
  /** Ecosystem type (cosmos, evm, etc.) */
  ecosystem: string;
  /** Chain ID for chain-specific addresses */
  chainId?: string;
  /** Bech32 prefix for Cosmos addresses */
  bech32Prefix?: string;
  /** Derivation path override (HD wallets) */
  derivationPath?: string;
}

/**
 * Request to sign data.
 */
export interface SignRequest {
  /** Type of signature required */
  signType: SignType;
  /** Data to sign (format depends on signType) */
  data: Uint8Array | object;
  /** Ecosystem context */
  ecosystem: string;
  /** Chain ID */
  chainId?: string;
  /** Signer address (for verification) */
  signerAddress?: string;
}

/**
 * Response from signing operation.
 */
export interface SignResponse {
  /** The signature bytes */
  signature: Uint8Array;
  /** Public key used for signing (if available) */
  publicKey?: Uint8Array;
  /** Recovery parameter for ECDSA */
  recoveryParam?: number;
}

/**
 * Core interface for key management providers.
 *
 * All key management strategies (mnemonic, passkey, etc.)
 * implement this interface to provide a unified API for signing operations.
 */
export interface KeyProvider {
  /** Unique type identifier */
  readonly type: KeyProviderType;
  /** Human-readable display name */
  readonly displayName: string;
  /** Provider capabilities */
  readonly capabilities: KeyProviderCapabilities;

  /**
   * Get the address for a specific context (ecosystem/chain).
   * @param context Address derivation context
   * @returns The address string
   */
  getAddress(context: AddressContext): Promise<string>;

  /**
   * Get the public key for a specific context.
   * Some providers may not expose the public key.
   * @param context Address derivation context
   * @returns The public key bytes or undefined if not available
   */
  getPublicKey(context: AddressContext): Promise<Uint8Array | undefined>;

  /**
   * Sign data according to the request type.
   * @param request Sign request with data and context
   * @returns Sign response with signature
   */
  sign(request: SignRequest): Promise<SignResponse>;

  /**
   * Check if the provider is ready for signing.
   * For example, a passkey session may have expired.
   * @returns true if ready for signing operations
   */
  isReady(): Promise<boolean>;

  /**
   * Disconnect and clean up resources.
   * For mnemonic: no-op (memory cleanup)
   * For passkey: release WebAuthn session
   */
  disconnect(): Promise<void>;

  /**
   * Get addresses for all supported ecosystems/chains.
   * Useful for displaying all addresses in a portfolio view.
   * @returns Map of ecosystem -> address
   */
  getAllAddresses?(): Promise<Map<string, string>>;

  /**
   * Get the ecosystems supported by this key provider.
   * This allows adapters to check compatibility without knowing provider implementation details.
   * @returns Array of supported ecosystem types
   */
  getSupportedEcosystems(): EcosystemType[];

  /**
   * Get the internal Account abstraction.
   *
   * The Account layer provides:
   * - Account type information (EOA vs Smart Account)
   * - Access to underlying Signer(s)
   * - Ecosystem compatibility checking
   *
   * This method may return undefined for providers that don't yet
   * implement the Account abstraction (backward compatibility).
   *
   * @returns The Account instance or undefined
   */
  getAccount?(): Account | undefined;

  /**
   * Check if this provider uses a Passkey (WebAuthn) for signing.
   *
   * This is useful for:
   * - Determining if user interaction is needed for signing
   * - Knowing if PRF extension might be available
   * - UX decisions (show "Sign with Passkey" button)
   *
   * @returns true if the provider uses Passkey
   */
  isPasskeyOwned?(): boolean;
}

/**
 * Factory function type for creating KeyProvider instances.
 */
export type KeyProviderFactory = (
  config: KeyProviderConfig,
) => Promise<KeyProvider>;

/**
 * Configuration for creating a KeyProvider.
 * The shape depends on the provider type.
 */
export type KeyProviderConfig =
  | MnemonicKeyProviderConfig
  | PasskeyKeyProviderConfig
  | SmartAccountKeyProviderConfig;

/**
 * Configuration for mnemonic-based key provider.
 */
export interface MnemonicKeyProviderConfig {
  type: "mnemonic";
  /** BIP39 mnemonic phrase */
  mnemonic: string;
  /** Optional HD derivation path prefix */
  hdPathPrefix?: string;
}

/**
 * Configuration for passkey-based key provider (future).
 */
export interface PasskeyKeyProviderConfig {
  type: "passkey";
  /** WebAuthn credential ID */
  credentialId: string;
  /** Public key from registration */
  publicKey: string;
  /** Whether to use PRF extension for key derivation */
  usePrf?: boolean;
}

/**
 * Configuration for smart account key provider (future).
 */
export interface SmartAccountKeyProviderConfig {
  type: "smart-account";
  /** Smart account address */
  accountAddress: string;
  /** Factory address used to deploy */
  factoryAddress: string;
  /** Inner signer configuration (owner key) */
  ownerConfig: Exclude<KeyProviderConfig, SmartAccountKeyProviderConfig>;
}

/**
 * Error thrown when key provider operation fails.
 */
export class KeyProviderError extends Error {
  constructor(
    message: string,
    public readonly code: KeyProviderErrorCode,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "KeyProviderError";
  }
}

/**
 * Error codes for key provider operations.
 */
export enum KeyProviderErrorCode {
  /** User rejected the operation */
  USER_REJECTED = "USER_REJECTED",
  /** Invalid signature type for this provider */
  UNSUPPORTED_SIGN_TYPE = "UNSUPPORTED_SIGN_TYPE",
  /** Invalid chain or ecosystem */
  UNSUPPORTED_CHAIN = "UNSUPPORTED_CHAIN",
  /** Provider not ready */
  NOT_READY = "NOT_READY",
  /** Invalid configuration */
  INVALID_CONFIG = "INVALID_CONFIG",
  /** Network error */
  NETWORK_ERROR = "NETWORK_ERROR",
  /** Unknown error */
  UNKNOWN = "UNKNOWN",
}
