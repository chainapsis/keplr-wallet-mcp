/**
 * KeyProvider Registry
 *
 * A registry pattern for KeyProvider types that enables plug-and-play extensibility.
 * Instead of hard-coded switch statements and union types, providers register themselves
 * with the registry, allowing new providers to be added without modifying core code.
 *
 * @example
 * ```typescript
 * // Register a new provider type
 * keyProviderRegistry.register({
 *   type: "mnemonic",
 *   displayName: "Mnemonic Wallet",
 *   configSchema: z.object({
 *     type: z.literal("mnemonic"),
 *     mnemonic: z.string(),
 *   }),
 *   create: async (config) => new MnemonicKeyProvider(config),
 *   validate: (config) => {
 *     if (!config.mnemonic) throw new Error("mnemonic required");
 *     return true;
 *   },
 * });
 *
 * // Create a provider using the registry
 * const provider = await keyProviderRegistry.createProvider({
 *   type: "mnemonic",
 *   mnemonic: "your mnemonic phrase here",
 * });
 * ```
 */

import { type ZodSchema, z } from "zod";
import type { KeyProvider } from "./types.js";
import { KeyProviderError, KeyProviderErrorCode } from "./types.js";

/**
 * Plugin definition for a KeyProvider type.
 *
 * Each provider type registers one of these to enable dynamic creation.
 */
export interface KeyProviderPlugin<
  TType extends string = string,
  TConfig extends { type: TType } = { type: TType },
> {
  /**
   * Unique identifier for this provider type.
   * Must match the `type` field in the config.
   */
  type: TType;

  /**
   * Human-readable name for display purposes.
   */
  displayName: string;

  /**
   * Zod schema for validating configuration.
   * If not provided, only the `type` field is validated.
   */
  configSchema?: ZodSchema<TConfig>;

  /**
   * Factory function to create the KeyProvider instance.
   *
   * @param config - Validated configuration
   * @returns KeyProvider instance (may be async)
   */
  create(config: TConfig): KeyProvider | Promise<KeyProvider>;

  /**
   * Optional additional validation beyond schema validation.
   * Useful for async or complex validations.
   *
   * @param config - Configuration to validate
   * @returns true if valid
   * @throws Error with description if invalid
   */
  validate?(config: TConfig): boolean | Promise<boolean>;

  /**
   * Whether this provider type is currently available.
   * Useful for providers that require specific environment.
   *
   * @returns true if the provider can be used
   */
  isAvailable?(): boolean | Promise<boolean>;
}

/**
 * Registry for KeyProvider plugins.
 *
 * Maintains a collection of registered provider types and provides
 * methods for creating and validating providers.
 */
export class KeyProviderRegistry {
  private plugins = new Map<string, KeyProviderPlugin>();

  /**
   * Register a KeyProvider plugin.
   *
   * @param plugin - Plugin definition to register
   * @throws Error if a plugin with the same type is already registered
   */
  register<TType extends string, TConfig extends { type: TType }>(
    plugin: KeyProviderPlugin<TType, TConfig>,
  ): void {
    if (this.plugins.has(plugin.type)) {
      throw new Error(
        `KeyProvider type "${plugin.type}" is already registered`,
      );
    }
    this.plugins.set(plugin.type, plugin as unknown as KeyProviderPlugin);
  }

  /**
   * Unregister a KeyProvider plugin.
   *
   * @param type - Provider type to unregister
   * @returns true if the plugin was unregistered, false if not found
   */
  unregister(type: string): boolean {
    return this.plugins.delete(type);
  }

  /**
   * Check if a provider type is registered.
   *
   * @param type - Provider type to check
   * @returns true if registered
   */
  isRegistered(type: string): boolean {
    return this.plugins.has(type);
  }

  /**
   * Get all registered provider types.
   *
   * @returns Array of registered type identifiers
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Get available provider types (those that pass isAvailable check).
   *
   * @returns Array of available type identifiers
   */
  async getAvailableTypes(): Promise<string[]> {
    const available: string[] = [];
    for (const [type, plugin] of this.plugins) {
      const isAvailable = plugin.isAvailable
        ? await plugin.isAvailable()
        : true;
      if (isAvailable) {
        available.push(type);
      }
    }
    return available;
  }

  /**
   * Get a plugin by type.
   *
   * @param type - Provider type
   * @returns Plugin definition or undefined
   */
  getPlugin(type: string): KeyProviderPlugin | undefined {
    return this.plugins.get(type);
  }

  /**
   * Create a KeyProvider from configuration.
   *
   * @param config - Provider configuration (must include `type` field)
   * @returns KeyProvider instance
   * @throws KeyProviderError if type is not registered or validation fails
   */
  async createProvider(
    config: { type: string } & Record<string, unknown>,
  ): Promise<KeyProvider> {
    const plugin = this.plugins.get(config.type);

    if (!plugin) {
      throw new KeyProviderError(
        `Unknown key provider type: ${config.type}. ` +
          `Registered types: ${this.getRegisteredTypes().join(", ")}`,
        KeyProviderErrorCode.INVALID_CONFIG,
      );
    }

    // Check availability
    if (plugin.isAvailable) {
      const isAvailable = await plugin.isAvailable();
      if (!isAvailable) {
        throw new KeyProviderError(
          `Key provider type "${config.type}" is not available in this environment`,
          KeyProviderErrorCode.NOT_READY,
        );
      }
    }

    // Validate with schema
    if (plugin.configSchema) {
      const result = plugin.configSchema.safeParse(config);
      if (!result.success) {
        throw new KeyProviderError(
          `Invalid configuration for ${config.type}: ${result.error.message}`,
          KeyProviderErrorCode.INVALID_CONFIG,
        );
      }
    }

    // Additional validation
    if (plugin.validate) {
      try {
        await plugin.validate(config as Parameters<typeof plugin.validate>[0]);
      } catch (error) {
        throw new KeyProviderError(
          `Configuration validation failed for ${config.type}: ${error instanceof Error ? error.message : String(error)}`,
          KeyProviderErrorCode.INVALID_CONFIG,
        );
      }
    }

    // Create the provider
    return plugin.create(config as Parameters<typeof plugin.create>[0]);
  }

  /**
   * Validate a configuration without creating the provider.
   *
   * @param config - Configuration to validate
   * @returns true if valid
   * @throws KeyProviderError if invalid
   */
  async validateConfig(
    config: { type: string } & Record<string, unknown>,
  ): Promise<boolean> {
    const plugin = this.plugins.get(config.type);

    if (!plugin) {
      throw new KeyProviderError(
        `Unknown key provider type: ${config.type}`,
        KeyProviderErrorCode.INVALID_CONFIG,
      );
    }

    // Validate with schema
    if (plugin.configSchema) {
      const result = plugin.configSchema.safeParse(config);
      if (!result.success) {
        throw new KeyProviderError(
          `Invalid configuration for ${config.type}: ${result.error.message}`,
          KeyProviderErrorCode.INVALID_CONFIG,
        );
      }
    }

    // Additional validation
    if (plugin.validate) {
      await plugin.validate(config as Parameters<typeof plugin.validate>[0]);
    }

    return true;
  }

  /**
   * Get display name for a provider type.
   *
   * @param type - Provider type
   * @returns Display name or undefined if not registered
   */
  getDisplayName(type: string): string | undefined {
    return this.plugins.get(type)?.displayName;
  }

  /**
   * Clear all registered plugins.
   * Useful for testing.
   */
  clear(): void {
    this.plugins.clear();
  }
}

/**
 * Global KeyProvider registry instance.
 *
 * This is the default registry used throughout the application.
 * Providers are registered here at startup.
 */
export const keyProviderRegistry = new KeyProviderRegistry();

// ============================================================================
// Built-in Provider Plugins (registered below)
// ============================================================================

/**
 * Zod schemas for built-in provider configurations.
 */
export const mnemonicConfigSchema = z.object({
  type: z.literal("mnemonic"),
  mnemonic: z.string().min(1, "Mnemonic is required"),
  hdPathPrefix: z.string().optional(),
});

export const passkeyConfigSchema = z.object({
  type: z.literal("passkey"),
  credentialId: z.string(),
  publicKey: z.string(),
  usePrf: z.boolean().optional(),
});

/**
 * Register built-in provider plugins.
 *
 * This function is called during module initialization to register
 * all built-in provider types (mnemonic, passkey).
 */
export function registerBuiltinProviders(registry: KeyProviderRegistry): void {
  // Import dynamically to avoid circular dependencies
  const registerMnemonic = async () => {
    const { createMnemonicProvider } = await import("./providers/mnemonic.js");
    registry.register({
      type: "mnemonic",
      displayName: "Mnemonic Wallet",
      configSchema: mnemonicConfigSchema,
      create: createMnemonicProvider,
    });
  };

  // Note: These are registered synchronously with async factories
  // The actual imports happen when create() is called
}

/**
 * Initialize the global registry with built-in providers.
 *
 * This is called once at module load time.
 */
function initializeGlobalRegistry(): void {
  // Mnemonic provider
  keyProviderRegistry.register({
    type: "mnemonic",
    displayName: "Mnemonic Wallet",
    configSchema: mnemonicConfigSchema,
    create: async (config) => {
      const { createMnemonicProvider } = await import(
        "./providers/mnemonic.js"
      );
      return createMnemonicProvider(config);
    },
  });

  // Smart Account provider (not yet implemented - throws on create)
  keyProviderRegistry.register({
    type: "smart-account",
    displayName: "Smart Account",
    create: async () => {
      throw new KeyProviderError(
        "Smart account key provider is not yet implemented",
        KeyProviderErrorCode.INVALID_CONFIG,
      );
    },
  });
}

// Initialize global registry on module load
initializeGlobalRegistry();
