/**
 * Authentication Provider Registry
 *
 * Registers all available auth providers with the AuthManager.
 */

import { getAuthManager } from "../manager.js";
import { createBiometricProvider } from "./biometric.js";
import { createTotpProvider } from "./totp.js";

/**
 * Register all authentication providers
 */
export function registerAuthProviders(): void {
  const manager = getAuthManager();

  // Register biometric provider
  manager.registerProvider(createBiometricProvider());

  // Register TOTP provider (Google Authenticator)
  manager.registerProvider(createTotpProvider("google"));

  // Future providers can be registered here:
  // manager.registerProvider(createTotpProvider("authy"));
  // manager.registerProvider(createPinProvider());
}

export { BiometricProvider, createBiometricProvider } from "./biometric.js";
export { createTotpProvider, TotpProvider } from "./totp.js";
