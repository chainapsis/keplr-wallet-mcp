import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EcosystemClient } from "../ecosystem.js";
import type { KeplrStore } from "../store.js";

/**
 * Context provided to plugins for accessing server capabilities.
 *
 * This provides a controlled interface to the server, replacing direct
 * access to the global store. Benefits:
 * - Better testability (can mock the context)
 * - Cleaner dependency injection
 * - Plugins don't need to know store internals
 */
export interface PluginContext {
  /** MCP Server for tool registration */
  server: McpServer;

  /**
   * Get a client for a specific ecosystem.
   * Lazily initializes if not already created.
   *
   * @param ecosystem - Ecosystem type (e.g., "cosmos", "evm")
   * @returns The ecosystem client
   */
  getClient<T extends EcosystemClient>(ecosystem: string): Promise<T>;

  /**
   * Get plugin-specific configuration.
   * Configuration is passed during plugin initialization.
   *
   * @returns Plugin configuration or undefined if none set
   */
  getConfig<T>(): T | undefined;

  /**
   * Logger for plugin-specific logging.
   * Prefixes logs with plugin name.
   */
  logger: PluginLogger;

  /**
   * Subscribe to events emitted by the store.
   * Returns an unsubscribe function.
   *
   * @param eventType - Type of event to subscribe to
   * @param listener - Event listener callback
   * @returns Unsubscribe function
   */
  on(eventType: string, listener: (event: unknown) => void): () => void;

  /**
   * Emit an event to all subscribers.
   *
   * @param event - Event to emit
   */
  emit(event: { type: string; data: Record<string, unknown> }): void;
}

/**
 * Logger interface for plugins.
 */
export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Plugin interface for extending the MCP server.
 *
 * Plugins can register tools, prompts, and other MCP capabilities.
 * They can optionally implement lifecycle hooks for initialization
 * and cleanup.
 */
export interface KeplrPlugin {
  /** Unique identifier for this plugin */
  name: string;

  /**
   * Semantic version of this plugin.
   * Used for dependency resolution and compatibility checking.
   */
  version?: string;

  /**
   * Plugin dependencies (by name).
   * These plugins will be registered before this one.
   *
   * @example ["cosmos-query", "cosmos-transaction"]
   */
  dependencies?: string[];

  /**
   * Register the plugin's capabilities with the server.
   *
   * This is called during server initialization.
   * Use this to register tools, prompts, and other MCP capabilities.
   *
   * @param server - MCP server instance
   * @param store - Keplr store instance (deprecated, use context in future)
   */
  register(server: McpServer, store: KeplrStore): void | Promise<void>;

  /**
   * Called when the active account changes.
   *
   * Use this to clear caches, update internal state, or perform
   * cleanup/initialization for the new account.
   *
   * @param newAccount - Name of the new active account, or null if none
   * @param previousAccount - Name of the previous account, or null
   */
  onAccountChanged?(
    newAccount: string | null,
    previousAccount: string | null,
  ): void | Promise<void>;

  /**
   * Called when a client is initialized for an ecosystem.
   *
   * Use this to perform ecosystem-specific initialization
   * that depends on having an active client.
   *
   * @param ecosystem - Ecosystem type (e.g., "cosmos", "evm")
   * @param source - How the client was initialized ("env", "keychain")
   */
  onClientInitialized?(ecosystem: string, source: string): void | Promise<void>;

  /**
   * Called when a client is disconnected.
   *
   * Use this to clean up resources or state associated with
   * the ecosystem client.
   *
   * @param ecosystem - Ecosystem type that was disconnected
   */
  onClientDisconnected?(ecosystem: string): void | Promise<void>;

  /**
   * Called when the plugin is being unloaded.
   *
   * Use this to clean up resources, close connections,
   * and perform any necessary cleanup.
   */
  onUnload?(): void | Promise<void>;
}

/**
 * Context available to tool handlers.
 * Provides access to server capabilities (elicitation, etc.) and store.
 */
export interface ToolContext {
  /**
   * Low-level MCP Server instance for elicitation.
   * Access via McpServer.server property.
   */
  server: Server;
  /** Keplr store for accessing state */
  store: KeplrStore;
}

/**
 * Create a PluginContext from the server and store.
 *
 * @param server - MCP server instance
 * @param store - Keplr store instance
 * @param pluginName - Name of the plugin (for logging)
 * @param config - Optional plugin configuration
 * @returns PluginContext instance
 */
export function createPluginContext(
  server: McpServer,
  store: KeplrStore,
  pluginName: string,
  config?: unknown,
): PluginContext {
  const logger: PluginLogger = {
    debug: (msg, ...args) => console.debug(`[${pluginName}]`, msg, ...args),
    info: (msg, ...args) => console.info(`[${pluginName}]`, msg, ...args),
    warn: (msg, ...args) => console.warn(`[${pluginName}]`, msg, ...args),
    error: (msg, ...args) => console.error(`[${pluginName}]`, msg, ...args),
  };

  return {
    server,
    getClient: <T extends EcosystemClient>(ecosystem: string) =>
      store.getClientFor<T>(ecosystem),
    getConfig: <T>() => config as T | undefined,
    logger,
    on: (eventType, listener) =>
      store.on(
        eventType as Parameters<typeof store.on>[0],
        listener as Parameters<typeof store.on>[1],
      ),
    emit: (event) => store.emit(event as Parameters<typeof store.emit>[0]),
  };
}

/**
 * Plugin registry for managing plugin lifecycle.
 *
 * Handles plugin registration, dependency resolution, and lifecycle hooks.
 */
export class PluginRegistry {
  private plugins = new Map<string, KeplrPlugin>();
  private registrationOrder: string[] = [];
  private server: McpServer | null = null;
  private store: KeplrStore | null = null;

  /**
   * Add a plugin to the registry.
   * Does not register it with the server yet.
   *
   * @param plugin - Plugin to add
   */
  add(plugin: KeplrPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Get a plugin by name.
   *
   * @param name - Plugin name
   * @returns Plugin instance or undefined
   */
  get(name: string): KeplrPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Check if a plugin is registered.
   *
   * @param name - Plugin name
   * @returns true if registered
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get all registered plugin names.
   *
   * @returns Array of plugin names
   */
  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Resolve plugin dependencies and return registration order.
   *
   * @returns Array of plugin names in dependency order
   * @throws Error if circular dependency detected
   */
  private resolveDependencies(): string[] {
    const resolved: string[] = [];
    const visiting = new Set<string>();

    const visit = (name: string, path: string[] = []): void => {
      if (resolved.includes(name)) return;

      if (visiting.has(name)) {
        throw new Error(
          `Circular plugin dependency detected: ${[...path, name].join(" -> ")}`,
        );
      }

      const plugin = this.plugins.get(name);
      if (!plugin) {
        throw new Error(
          `Plugin "${name}" not found (required by ${path[path.length - 1] || "root"})`,
        );
      }

      visiting.add(name);

      // Visit dependencies first
      for (const dep of plugin.dependencies || []) {
        visit(dep, [...path, name]);
      }

      visiting.delete(name);
      resolved.push(name);
    };

    // Visit all plugins
    for (const name of this.plugins.keys()) {
      visit(name);
    }

    return resolved;
  }

  /**
   * Register all plugins with the server in dependency order.
   *
   * @param server - MCP server instance
   * @param store - Keplr store instance
   */
  async registerAll(server: McpServer, store: KeplrStore): Promise<void> {
    this.server = server;
    this.store = store;

    // Resolve dependencies and get registration order
    this.registrationOrder = this.resolveDependencies();

    // Register plugins in order
    for (const name of this.registrationOrder) {
      const plugin = this.plugins.get(name);
      if (plugin) {
        await plugin.register(server, store);
      }
    }

    // Set up event listeners for lifecycle hooks
    this.setupLifecycleListeners(store);
  }

  /**
   * Set up store event listeners to call plugin lifecycle hooks.
   */
  private setupLifecycleListeners(store: KeplrStore): void {
    // Listen for account changes
    store.on("account:switched", async (event) => {
      const data = event.data as {
        previousAccount: string | null;
        newAccount: string | null;
      };
      await this.notifyAccountChanged(data.newAccount, data.previousAccount);
    });

    // Listen for client initialization
    store.on("client:initialized", async (event) => {
      const data = event.data as {
        ecosystem: string;
        source: string;
      };
      await this.notifyClientInitialized(data.ecosystem, data.source);
    });

    // Listen for client disconnection
    store.on("client:disconnected", async (event) => {
      const data = event.data as {
        ecosystem: string;
      };
      await this.notifyClientDisconnected(data.ecosystem);
    });
  }

  /**
   * Notify all plugins of an account change.
   */
  async notifyAccountChanged(
    newAccount: string | null,
    previousAccount: string | null,
  ): Promise<void> {
    for (const name of this.registrationOrder) {
      const plugin = this.plugins.get(name);
      if (plugin?.onAccountChanged) {
        try {
          await plugin.onAccountChanged(newAccount, previousAccount);
        } catch (error) {
          console.error(
            `[PluginRegistry] Error in ${name}.onAccountChanged:`,
            error,
          );
        }
      }
    }
  }

  /**
   * Notify all plugins of client initialization.
   */
  async notifyClientInitialized(
    ecosystem: string,
    source: string,
  ): Promise<void> {
    for (const name of this.registrationOrder) {
      const plugin = this.plugins.get(name);
      if (plugin?.onClientInitialized) {
        try {
          await plugin.onClientInitialized(ecosystem, source);
        } catch (error) {
          console.error(
            `[PluginRegistry] Error in ${name}.onClientInitialized:`,
            error,
          );
        }
      }
    }
  }

  /**
   * Notify all plugins of client disconnection.
   */
  async notifyClientDisconnected(ecosystem: string): Promise<void> {
    for (const name of this.registrationOrder) {
      const plugin = this.plugins.get(name);
      if (plugin?.onClientDisconnected) {
        try {
          await plugin.onClientDisconnected(ecosystem);
        } catch (error) {
          console.error(
            `[PluginRegistry] Error in ${name}.onClientDisconnected:`,
            error,
          );
        }
      }
    }
  }

  /**
   * Unload all plugins in reverse order.
   */
  async unloadAll(): Promise<void> {
    // Unload in reverse order
    for (const name of [...this.registrationOrder].reverse()) {
      const plugin = this.plugins.get(name);
      if (plugin?.onUnload) {
        try {
          await plugin.onUnload();
        } catch (error) {
          console.error(`[PluginRegistry] Error in ${name}.onUnload:`, error);
        }
      }
    }

    this.plugins.clear();
    this.registrationOrder = [];
    this.server = null;
    this.store = null;
  }

  /**
   * Clear all plugins without calling onUnload.
   * Useful for testing.
   */
  clear(): void {
    this.plugins.clear();
    this.registrationOrder = [];
  }
}

/**
 * Global plugin registry instance.
 */
export const pluginRegistry = new PluginRegistry();
