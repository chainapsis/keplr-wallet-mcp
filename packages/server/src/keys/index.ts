/**
 * Key Management Module
 *
 * Provides a unified interface for different key management strategies:
 * - Mnemonic (BIP39)
 * - Passkey/WebAuthn (future)
 * - Smart Account / Account Abstraction (future)
 *
 * Architecture: 3-Layer Key Abstraction
 *   Layer 3: KeyProvider (orchestration) - this module
 *   Layer 2: Account (EOA vs Smart Account) - ./accounts/
 *   Layer 1: Signer (curve-specific primitives) - ./signers/
 */

export { createEOAAccount, EOAAccountImpl } from "./accounts/eoa.js";
// ============================================================================
// Layer 2: Account (EOA)
// ============================================================================
export {
  type Account,
  AccountError,
  AccountErrorCode,
  type AccountKind,
  type AddressContext as AccountAddressContext,
  type EOAAccount,
} from "./accounts/types.js";
export {
  P256Signer,
  type P256SignerConfig,
  type P256SignerSignature,
  type WebAuthnAssertion,
  type WebAuthnAssertionOptions,
  type WebAuthnInteractionHandler,
} from "./signers/p256.js";
export {
  createSecp256k1Signer,
  DEFAULT_HD_PATHS,
  Secp256k1Signer,
} from "./signers/secp256k1.js";

// ============================================================================
// Layer 1: Signer (curve-specific primitives)
// ============================================================================
export {
  type CurveType as SignerCurveType,
  type DerivableSigner,
  type MnemonicSignerConfig,
  type PasskeySignerConfig,
  type PrivateKeySignerConfig,
  type Signer,
  SignerError,
  SignerErrorCode,
  type SignerFactory,
  type SignerSignature,
} from "./signers/types.js";

// ============================================================================
// Layer 3: KeyProvider (orchestration)
// ============================================================================

// Adapter Bridge (for plug-and-play KeyProvider → Adapter integration)
export {
  AdapterBridgeRegistry,
  type AdapterKeyProviderBridge,
  adapterBridgeRegistry,
} from "./adapter-bridge.js";
// ADR-36 (Cosmos Arbitrary Message Signing)
export {
  ADR36_MSG_TYPE,
  type Adr36SignDoc,
  extractAdr36Data,
  extractAdr36Signer,
  isValidAdr36SignDoc,
  makeAdr36SignDoc,
  serializeAdr36SignDoc,
} from "./adr36.js";
// Factory (with backward-compatible APIs)
export {
  createKeyProvider,
  createMnemonicKeyProvider,
  getSupportedKeyProviderTypes,
  isKeyProviderTypeSupported,
  validateKeyProviderConfig,
} from "./factory.js";
// Provider implementations
export { MnemonicKeyProvider } from "./providers/mnemonic.js";
// Registry (for dynamic provider registration)
export {
  type KeyProviderPlugin,
  KeyProviderRegistry,
  keyProviderRegistry,
  mnemonicConfigSchema,
  passkeyConfigSchema,
} from "./registry.js";

// Types
export {
  type AddressContext,
  type CurveType,
  type EcosystemType,
  type KeyProvider,
  type KeyProviderCapabilities,
  type KeyProviderConfig,
  KeyProviderError,
  KeyProviderErrorCode,
  type KeyProviderFactory,
  type KeyProviderType,
  type MnemonicKeyProviderConfig,
  type PasskeyKeyProviderConfig as TypesPasskeyKeyProviderConfig,
  type SignRequest,
  type SignResponse,
  type SignType,
  type SmartAccountKeyProviderConfig,
} from "./types.js";
