/**
 * Authentication Manager
 *
 * Central manager for authentication providers.
 * Coordinates auth checks and provider registration.
 */

import { loadAuthConfig, saveAuthConfig } from "./config.js";
import type { TotpProvider } from "./providers/totp.js";
import type {
  AuthAction,
  AuthConfig,
  AuthContext,
  AuthProvider,
  AuthResult,
  AuthSetupContext,
  AuthSetupResult,
} from "./types.js";

/**
 * Authentication Manager
 */
class AuthManager {
  private providers: Map<string, AuthProvider> = new Map();
  private config: AuthConfig | null = null;

  /**
   * Initialize the manager (load config)
   */
  async initialize(): Promise<void> {
    this.config = await loadAuthConfig();
  }

  /**
   * Register an authentication provider
   */
  registerProvider(provider: AuthProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Unregister an authentication provider
   */
  unregisterProvider(providerId: string): void {
    this.providers.delete(providerId);
  }

  /**
   * Get a provider by ID
   */
  getProvider(providerId: string): AuthProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get the TOTP provider (typed helper to avoid repeated casting)
   */
  getTotpProvider(): TotpProvider | undefined {
    return this.providers.get("totp") as TotpProvider | undefined;
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): AuthProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get available providers (those that can be used on this system)
   */
  async getAvailableProviders(): Promise<AuthProvider[]> {
    const available: AuthProvider[] = [];
    for (const provider of this.providers.values()) {
      if (await provider.isAvailable()) {
        available.push(provider);
      }
    }
    return available;
  }

  /**
   * Get the current configuration
   */
  async getConfig(): Promise<AuthConfig> {
    if (!this.config) {
      this.config = await loadAuthConfig();
    }
    return this.config;
  }

  /**
   * Reload configuration from storage
   */
  async reloadConfig(): Promise<AuthConfig> {
    this.config = await loadAuthConfig();
    return this.config;
  }

  /**
   * Check if auth is enabled globally
   */
  async isEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.enabled;
  }

  /**
   * Check if auth is required for a specific action
   */
  async isAuthRequired(action: AuthAction): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.enabled) {
      return false;
    }
    const requirement = config.requirements[action];
    return requirement?.enabled ?? false;
  }

  /**
   * Get required providers for an action
   */
  async getRequiredProviders(action: AuthAction): Promise<AuthProvider[]> {
    const config = await this.getConfig();
    const requirement = config.requirements[action];

    if (!requirement?.enabled) {
      return [];
    }

    const providers: AuthProvider[] = [];
    for (const providerId of requirement.providers) {
      const provider = this.providers.get(providerId);
      if (provider) {
        providers.push(provider);
      }
    }
    return providers;
  }

  /**
   * Authenticate user for an action
   *
   * Priority-based provider selection: tries each provider in order,
   * succeeding on first success. Providers returning requiresInput=true
   * are skipped (enabling fallback from TOTP to biometric).
   * If preferredMethod is specified, only that provider is used.
   */
  async authenticate(context: AuthContext): Promise<AuthResult> {
    const config = await this.getConfig();

    // Check if auth is enabled (skip if caller explicitly opts out)
    if (!config.enabled && !context.skipEnabledCheck) {
      return { success: true };
    }

    // Check if action requires auth
    const requirement = config.requirements[context.action];
    if (!requirement?.enabled) {
      return { success: true };
    }

    // Get required providers
    let providers = await this.getRequiredProviders(context.action);
    if (providers.length === 0) {
      return {
        success: false,
        error:
          "Authentication is required but no providers are configured. Set up a provider with auth-setup.",
      };
    }

    // If preferred method is specified, filter to only that provider
    if (context.preferredMethod) {
      const preferred = providers.find((p) => p.id === context.preferredMethod);
      if (preferred) {
        providers = [preferred];
      }
    }

    // Try each provider in priority order
    let lastError: AuthResult | null = null;
    const requiresInputProviders: string[] = [];
    let lastRequiresInputResult: AuthResult | null = null;

    for (const provider of providers) {
      const result = await provider.authenticate(context);

      if (result.success) {
        return { success: true };
      }

      // Provider needs user input (e.g., TOTP needs code) — skip to next
      if (result.requiresInput) {
        requiresInputProviders.push(provider.id);
        lastRequiresInputResult = result;
        continue;
      }

      // Real failure
      lastError = result;
    }

    // All providers require input (no real failures)
    if (
      requiresInputProviders.length > 0 &&
      requiresInputProviders.length === providers.length
    ) {
      return {
        success: false,
        error:
          lastRequiresInputResult?.error ??
          `Authentication requires input. Available methods: ${requiresInputProviders.join(", ")}`,
        requiresInput: true,
      };
    }

    return (
      lastError ?? {
        success: false,
        error: "All authentication methods failed",
      }
    );
  }

  /**
   * Setup an auth provider
   */
  async setupProvider(
    providerId: string,
    context: AuthSetupContext,
  ): Promise<AuthSetupResult> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return {
        success: false,
        error: `Provider not found: ${providerId}`,
      };
    }

    // Check if provider is available
    const available = await provider.isAvailable();
    if (!available) {
      return {
        success: false,
        error: `Provider not available on this system: ${provider.name}`,
      };
    }

    // Run setup
    const result = await provider.setup(context);

    if (result.success) {
      // Enable the provider in config
      // Note: provider id is "totp" but config key is "otp" for backwards compatibility
      const config = await this.getConfig();
      if (providerId === "biometric") {
        config.providers.biometric = { enabled: true };
      } else if (providerId === "totp") {
        config.providers.otp = { enabled: true };
      }
      await saveAuthConfig(config);
      this.config = config;
    }

    return result;
  }

  /**
   * Disable an auth provider.
   * Throws if this is the last provider for any enabled action requirement.
   */
  async disableProvider(providerId: string): Promise<void> {
    // Guard: prevent removing the last provider for any enabled action
    const config = await this.getConfig();
    for (const action of Object.keys(config.requirements) as AuthAction[]) {
      const req = config.requirements[action];
      if (
        req.enabled &&
        req.providers.length === 1 &&
        req.providers[0] === providerId
      ) {
        throw new Error(
          `Cannot disable '${providerId}' — it is the only provider for '${action}'. Use auth-disable to turn off authentication entirely.`,
        );
      }
    }

    const provider = this.providers.get(providerId);
    if (provider) {
      await provider.disable();
    }

    // Disable in config
    // Note: provider id is "totp" but config key is "otp" for backwards compatibility
    if (providerId === "biometric") {
      config.providers.biometric = { enabled: false };
    } else if (providerId === "totp") {
      config.providers.otp = { enabled: false };
    }

    // Remove from all requirements
    for (const action of Object.keys(config.requirements) as AuthAction[]) {
      config.requirements[action].providers = config.requirements[
        action
      ].providers.filter((p) => p !== providerId);

      if (config.requirements[action].providers.length === 0) {
        config.requirements[action].enabled = false;
      }
    }

    await saveAuthConfig(config);
    this.config = config;
  }

  /**
   * Get status summary for tools
   */
  async getStatus(): Promise<{
    enabled: boolean;
    availableProviders: Array<{ id: string; name: string; available: boolean }>;
    requirements: Record<AuthAction, { enabled: boolean; providers: string[] }>;
  }> {
    const config = await this.getConfig();

    const providerStatus: Array<{
      id: string;
      name: string;
      available: boolean;
    }> = [];
    for (const provider of this.providers.values()) {
      providerStatus.push({
        id: provider.id,
        name: provider.name,
        available: await provider.isAvailable(),
      });
    }

    const requirements: Record<
      AuthAction,
      { enabled: boolean; providers: string[] }
    > = {} as Record<AuthAction, { enabled: boolean; providers: string[] }>;
    for (const [action, req] of Object.entries(config.requirements)) {
      requirements[action as AuthAction] = {
        enabled: req.enabled,
        providers: req.providers,
      };
    }

    return {
      enabled: config.enabled,
      availableProviders: providerStatus,
      requirements,
    };
  }
}

// Singleton instance
let authManagerInstance: AuthManager | null = null;

/**
 * Get the AuthManager singleton
 */
export function getAuthManager(): AuthManager {
  if (!authManagerInstance) {
    authManagerInstance = new AuthManager();
  }
  return authManagerInstance;
}

/**
 * Initialize the AuthManager (call at server startup)
 */
export async function initializeAuthManager(): Promise<AuthManager> {
  const manager = getAuthManager();
  await manager.initialize();
  return manager;
}

export { AuthManager };
