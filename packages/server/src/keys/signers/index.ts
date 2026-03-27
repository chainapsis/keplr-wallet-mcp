/**
 * Signer Layer Exports
 *
 * Layer 1 of the key abstraction hierarchy.
 * Provides curve-specific signing primitives.
 */

export {
  P256Signer,
  type P256SignerConfig,
  type P256SignerSignature,
  type WebAuthnAssertion,
  type WebAuthnAssertionOptions,
  type WebAuthnInteractionHandler,
} from "./p256.js";
// Implementations
export {
  createSecp256k1Signer,
  DEFAULT_HD_PATHS,
  Secp256k1Signer,
} from "./secp256k1.js";
// Types
export {
  type CurveType,
  type DerivableSigner,
  type MnemonicSignerConfig,
  type PasskeySignerConfig,
  type PrivateKeySignerConfig,
  type Signer,
  SignerError,
  SignerErrorCode,
  type SignerFactory,
  type SignerSignature,
} from "./types.js";
