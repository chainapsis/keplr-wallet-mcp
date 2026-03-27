/**
 * KeyProvider Factory
 *
 * Creates KeyProvider instances based on configuration.
 * This module provides backward-compatible APIs that delegate to the KeyProviderRegistry.
 *
 * For new code, prefer using `keyProviderRegistry.createProvider()` directly
 * as it supports dynamic provider registration and better type inference.
 */

import {
  createMnemonicProvider,
  type MnemonicKeyProvider,
} from "./providers/mnemonic.js";
import { keyProviderRegistry } from "./registry.js";
import type {
  KeyProvider,
  KeyProviderConfig,
  KeyProviderType,
} from "./types.js";

/**
 * Check if a key provider type is supported.
 *
 * @deprecated Use `keyProviderRegistry.isRegistered()` for dynamic checks
 */
export const isKeyProviderTypeSupported = (type: KeyProviderType): boolean => {
  return keyProviderRegistry.isRegistered(type);
};

/**
 * Get all supported key provider types.
 *
 * @deprecated Use `keyProviderRegistry.getRegisteredTypes()` for dynamic list
 */
export const getSupportedKeyProviderTypes = (): KeyProviderType[] => {
  return keyProviderRegistry.getRegisteredTypes() as KeyProviderType[];
};

/**
 * Create a KeyProvider from configuration.
 *
 * This is the main factory function that delegates to the registry.
 * For direct registry access with better type inference, use
 * `keyProviderRegistry.createProvider()`.
 *
 * @param config - Provider configuration (varies by type)
 * @returns KeyProvider instance
 * @throws KeyProviderError if configuration is invalid or type unsupported
 */
export const createKeyProvider = async (
  config: KeyProviderConfig,
): Promise<KeyProvider> => {
  return keyProviderRegistry.createProvider(
    config as unknown as { type: string } & Record<string, unknown>,
  );
};

/**
 * Create a mnemonic-based KeyProvider.
 * Convenience function for the most common provider type.
 */
export const createMnemonicKeyProvider = async (
  mnemonic: string,
  options?: { hdPathPrefix?: string },
): Promise<MnemonicKeyProvider> => {
  return createMnemonicProvider({
    type: "mnemonic",
    mnemonic,
    hdPathPrefix: options?.hdPathPrefix,
  });
};

/**
 * Validate a key provider configuration without creating the provider.
 *
 * @param config - Configuration to validate
 * @returns true if valid
 * @throws KeyProviderError if invalid
 */
export const validateKeyProviderConfig = async (
  config: KeyProviderConfig,
): Promise<boolean> => {
  return keyProviderRegistry.validateConfig(
    config as unknown as { type: string } & Record<string, unknown>,
  );
};

// Re-export provider classes for direct use
export { MnemonicKeyProvider } from "./providers/mnemonic.js";

// Re-export registry for advanced use cases
export {
  type KeyProviderPlugin,
  KeyProviderRegistry,
  keyProviderRegistry,
} from "./registry.js";
