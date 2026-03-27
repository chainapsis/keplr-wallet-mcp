/**
 * WebAuthn Module
 *
 * Provides CLI-based WebAuthn credential management.
 */

export {
  CLIWebAuthnHandler,
  createCLIWebAuthnHandler,
  isWebAuthnAvailable,
  type WebAuthnRegistrationOptions,
  type WebAuthnRegistrationResult,
} from "./cli-handler.js";
