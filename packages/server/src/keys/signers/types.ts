/**
 * Signer Layer (Layer 1)
 *
 * Curve-specific signing primitives. This is the lowest level of the
 * key abstraction hierarchy, dealing only with cryptographic operations.
 *
 * Hierarchy:
 *   KeyProvider (orchestration)
 *     → Account (EOA vs Smart Account)
 *       → Signer (curve-specific primitives)
 */

/**
 * Supported elliptic curve types.
 */
export type CurveType = "secp256k1" | "p256" | "ed25519";

/**
 * Result of a signing operation.
 */
export interface SignerSignature {
  /** The raw signature bytes (r || s for ECDSA, full signature for EdDSA) */
  signature: Uint8Array;
  /** Recovery parameter for secp256k1 (used by EVM ecrecover). Undefined for other curves. */
  recoveryParam?: number;
}

/**
 * Base interface for all signers.
 *
 * A Signer represents a single key on a specific elliptic curve.
 * It handles the low-level cryptographic operations.
 */
export interface Signer {
  /** The elliptic curve this signer uses */
  readonly curve: CurveType;

  /**
   * Whether signing requires user interaction (e.g., biometric prompt).
   * - Mnemonic-derived: false
   * - Passkey/WebAuthn: true
   * - Hardware wallet: true
   */
  readonly requiresInteraction: boolean;

  /**
   * Get the public key for this signer.
   * @returns The public key bytes (compressed format for secp256k1/p256)
   */
  getPublicKey(): Promise<Uint8Array>;

  /**
   * Sign a pre-hashed message.
   *
   * IMPORTANT: The caller is responsible for hashing the message appropriately
   * for the target protocol (e.g., SHA-256 for Cosmos, Keccak-256 for EVM).
   *
   * @param hash The message hash to sign (typically 32 bytes)
   * @returns The signature with optional recovery parameter
   */
  signHash(hash: Uint8Array): Promise<SignerSignature>;
}

/**
 * Signer that supports HD (Hierarchical Deterministic) derivation.
 *
 * Only some signers support derivation:
 * - Secp256k1Signer from mnemonic: Yes
 * - Ed25519Signer from mnemonic: Yes
 * - P256Signer from Passkey: No (single key per credential)
 */
export interface DerivableSigner extends Signer {
  /**
   * Derive a child signer at the given path.
   *
   * @param path BIP32/SLIP10 derivation path (e.g., "m/44'/118'/0'/0/0")
   * @returns A new signer derived at the path
   */
  deriveChild(path: string): Promise<Signer>;

  /**
   * Get the derivation path of this signer (if derived).
   * @returns The derivation path or undefined if this is the root
   */
  getDerivationPath(): string | undefined;
}

/**
 * Configuration for creating a signer from a mnemonic.
 */
export interface MnemonicSignerConfig {
  /** BIP39 mnemonic phrase */
  mnemonic: string;
  /** Optional derivation path (default varies by curve) */
  path?: string;
  /** Optional password for mnemonic (BIP39 passphrase) */
  password?: string;
}

/**
 * Configuration for creating a signer from a private key.
 */
export interface PrivateKeySignerConfig {
  /** Raw private key bytes */
  privateKey: Uint8Array;
}

/**
 * Configuration for creating a signer from a Passkey/WebAuthn credential.
 */
export interface PasskeySignerConfig {
  /** The credential ID from WebAuthn registration */
  credentialId: string;
  /** The public key from registration (COSE format) */
  publicKey: Uint8Array;
  /** Optional RP ID for WebAuthn assertion */
  rpId?: string;
}

/**
 * Signer factory function type.
 */
export type SignerFactory<C, S extends Signer> = (config: C) => Promise<S>;

/**
 * Error thrown when signer operations fail.
 */
export class SignerError extends Error {
  constructor(
    message: string,
    public readonly code: SignerErrorCode,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "SignerError";
  }
}

/**
 * Error codes for signer operations.
 */
export enum SignerErrorCode {
  /** Invalid private key format or value */
  INVALID_PRIVATE_KEY = "INVALID_PRIVATE_KEY",
  /** Invalid public key format */
  INVALID_PUBLIC_KEY = "INVALID_PUBLIC_KEY",
  /** Invalid mnemonic phrase */
  INVALID_MNEMONIC = "INVALID_MNEMONIC",
  /** Invalid derivation path */
  INVALID_DERIVATION_PATH = "INVALID_DERIVATION_PATH",
  /** User cancelled the signing operation (for interactive signers) */
  USER_CANCELLED = "USER_CANCELLED",
  /** Signing operation failed */
  SIGNING_FAILED = "SIGNING_FAILED",
  /** Curve not supported */
  UNSUPPORTED_CURVE = "UNSUPPORTED_CURVE",
  /** Derivation not supported for this signer type */
  DERIVATION_NOT_SUPPORTED = "DERIVATION_NOT_SUPPORTED",
}
