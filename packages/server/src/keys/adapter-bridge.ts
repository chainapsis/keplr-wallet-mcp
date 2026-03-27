/**
 * Adapter-KeyProvider Bridge
 *
 * This module provides a registry-based pattern for connecting KeyProviders
 * to EcosystemAdapters. Instead of adapters using instanceof checks for each
 * KeyProvider type, KeyProviders register "bridges" that know how to create
 * clients for specific ecosystems.
 *
 * Benefits:
 * - New KeyProviders can be added without modifying adapter code
 * - Cleaner separation of concerns
 * - Better testability
 *
 * @example
 * ```typescript
 * // In a KeyProvider module, register the bridge:
 * adapterBridgeRegistry.register({
 *   providerType: "mnemonic",
 *   ecosystem: "cosmos",
 *   createClient: async (provider, adapter) => {
 *     const mnemonicProvider = provider as MnemonicKeyProvider;
 *     return adapter.createClient(mnemonicProvider.getMnemonic());
 *   },
 * });
 *
 * // In an adapter, use the registry:
 * async createClientWithProvider(provider: KeyProvider): Promise<EcosystemClient> {
 *   // Check compatibility
 *   if (!provider.getSupportedEcosystems().includes(this.type)) {
 *     throw new Error(`Provider does not support ${this.type}`);
 *   }
 *
 *   // Use the bridge registry
 *   return adapterBridgeRegistry.createClient(provider, this);
 * }
 * ```
 */

import type { EcosystemAdapter, EcosystemClient } from "../ecosystem.js";
import type { KeyProvider, KeyProviderType } from "./types.js";

/**
 * Bridge definition for connecting a KeyProvider type to an ecosystem.
 */
export interface AdapterKeyProviderBridge {
  /**
   * KeyProvider type this bridge handles.
   */
  providerType: KeyProviderType | string;

  /**
   * Ecosystem this bridge creates clients for.
   */
  ecosystem: string;

  /**
   * Priority for bridge selection (higher = preferred).
   * Useful when multiple bridges could handle the same combination.
   * Default is 0.
   */
  priority?: number;

  /**
   * Create a client using the provider and adapter.
   *
   * @param provider - The KeyProvider instance
   * @param adapter - The EcosystemAdapter instance
   * @returns EcosystemClient for this ecosystem
   */
  createClient(
    provider: KeyProvider,
    adapter: EcosystemAdapter,
  ): Promise<EcosystemClient>;

  /**
   * Optional check to see if this bridge can handle the specific provider.
   * Useful for more complex matching beyond just type.
   *
   * @param provider - The KeyProvider to check
   * @returns true if this bridge can handle the provider
   */
  canHandle?(provider: KeyProvider): boolean;
}

/**
 * Registry for adapter-KeyProvider bridges.
 */
export class AdapterBridgeRegistry {
  private bridges: AdapterKeyProviderBridge[] = [];

  /**
   * Register a bridge.
   *
   * @param bridge - Bridge definition to register
   */
  register(bridge: AdapterKeyProviderBridge): void {
    this.bridges.push(bridge);
    // Sort by priority (descending) for consistent selection
    this.bridges.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Unregister all bridges for a provider type and ecosystem.
   *
   * @param providerType - Provider type to unregister
   * @param ecosystem - Ecosystem to unregister for (optional, unregisters all if not specified)
   * @returns Number of bridges removed
   */
  unregister(providerType: string, ecosystem?: string): number {
    const before = this.bridges.length;
    this.bridges = this.bridges.filter((b) => {
      if (b.providerType !== providerType) return true;
      if (ecosystem && b.ecosystem !== ecosystem) return true;
      return false;
    });
    return before - this.bridges.length;
  }

  /**
   * Find a bridge that can handle the given provider and ecosystem.
   *
   * @param provider - KeyProvider instance
   * @param ecosystem - Target ecosystem
   * @returns Bridge that can handle this combination, or undefined
   */
  findBridge(
    provider: KeyProvider,
    ecosystem: string,
  ): AdapterKeyProviderBridge | undefined {
    return this.bridges.find((b) => {
      // Check type and ecosystem match
      if (b.providerType !== provider.type) return false;
      if (b.ecosystem !== ecosystem) return false;

      // Additional check if bridge has canHandle
      if (b.canHandle && !b.canHandle(provider)) return false;

      return true;
    });
  }

  /**
   * Create a client using the appropriate bridge.
   *
   * @param provider - KeyProvider instance
   * @param adapter - EcosystemAdapter instance
   * @returns EcosystemClient
   * @throws Error if no bridge is found
   */
  async createClient(
    provider: KeyProvider,
    adapter: EcosystemAdapter,
  ): Promise<EcosystemClient> {
    const bridge = this.findBridge(provider, adapter.type);

    if (!bridge) {
      throw new Error(
        `No adapter bridge registered for provider type "${provider.type}" ` +
          `and ecosystem "${adapter.type}". ` +
          `Please register a bridge using adapterBridgeRegistry.register().`,
      );
    }

    return bridge.createClient(provider, adapter);
  }

  /**
   * Check if a bridge exists for the given provider and ecosystem.
   *
   * @param providerType - Provider type to check
   * @param ecosystem - Ecosystem to check
   * @returns true if a bridge exists
   */
  hasBridge(providerType: string, ecosystem: string): boolean {
    return this.bridges.some(
      (b) => b.providerType === providerType && b.ecosystem === ecosystem,
    );
  }

  /**
   * Get all registered bridges (for debugging/testing).
   */
  getBridges(): AdapterKeyProviderBridge[] {
    return [...this.bridges];
  }

  /**
   * Clear all registered bridges.
   * Useful for testing.
   */
  clear(): void {
    this.bridges = [];
  }
}

/**
 * Global adapter bridge registry instance.
 */
export const adapterBridgeRegistry = new AdapterBridgeRegistry();

// ============================================================================
// Built-in Bridge Registrations
// ============================================================================

/**
 * Register built-in bridges for all KeyProvider types.
 * Called during module initialization.
 */
function registerBuiltinBridges(): void {
  // Mnemonic → Cosmos
  adapterBridgeRegistry.register({
    providerType: "mnemonic",
    ecosystem: "cosmos",
    createClient: async (provider, adapter) => {
      // Use dynamic import to avoid circular dependencies
      const { MnemonicKeyProvider } = await import("./providers/mnemonic.js");
      const mnemonicProvider = provider as InstanceType<
        typeof MnemonicKeyProvider
      >;
      return adapter.createClient(mnemonicProvider.getMnemonic());
    },
  });
}

// Initialize built-in bridges
registerBuiltinBridges();
