/**
 * External plugin factory function type.
 * A plugin package exports a default factory function that returns a KeplrMcpPlugin.
 */
export type ExternalPluginFactory = (
  options?: Record<string, unknown>,
) => KeplrMcpPlugin | KeplrMcpPlugin[];

/**
 * External-facing plugin interface.
 * Simpler than the internal KeplrPlugin — only 3 lifecycle hooks.
 */
export interface KeplrMcpPlugin {
  /** Unique identifier for this plugin */
  name: string;

  /**
   * Initialize the plugin: register adapters, key providers, bridges.
   * All plugins' setup() completes before any registerTools() is called.
   */
  setup?(ctx: ExternalPluginContext): Promise<void> | void;

  /**
   * Register MCP tools, prompts, and resources with the server.
   * Called after all plugins have run setup().
   */
  registerTools?(
    server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
    ctx: ExternalPluginContext,
  ): Promise<void> | void;

  /** Cleanup on server shutdown */
  teardown?(): Promise<void> | void;
}

/**
 * Context passed to external plugin hooks.
 * Simpler than the internal PluginContext.
 */
export interface ExternalPluginContext {
  /** Get/set shared data between plugins (namespaced by plugin name) */
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  /** Logger prefixed with plugin name */
  logger: {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

/** RPC resolution configuration */
export interface RpcConfig {
  /**
   * Keplr infrastructure API key (from KEPLR_RPC_API_KEY env var or explicit).
   * When set, uses Keplr-hosted RPC/LCD endpoints with header auth for 25 supported chains.
   */
  apiKey?: string;
  /** Per-chain RPC URL overrides (highest priority) */
  overrides?: Record<string, string>;
}

/** Toolset configuration */
export interface ToolsetConfig {
  /**
   * Categories to register at startup.
   * Tools outside this list are NOT registered initially.
   * Meta-tools (search-tools, describe-tools) are always registered regardless.
   * Keep under 40 to stay within Claude Desktop / Cursor tool limits.
   *
   * Available categories: "account-management", "authentication",
   * "cosmos-query", "cosmos-transaction", "cosmwasm",
   * "cosmos-signing", "chain-management"
   */
  default: string[];
}

/** Skip Routes API configuration */
export interface SkipApiConfig {
  /**
   * Skip Routes API key. Sent as `authorization` header (no Bearer prefix).
   * Currently only read from SKIP_API_KEY env var at runtime.
   * Config file value will be used in a future release.
   */
  apiKey?: string;
  /** Skip Routes API base URL. Defaults to "https://api.skip.build". */
  apiUrl?: string;
}

/** Top-level config for keplr-mcp.config.ts */
export interface KeplrMcpConfig {
  /**
   * External plugin packages to load.
   * Each entry is either:
   * - A string: npm package name (auto-imports default export)
   * - A KeplrMcpPlugin object: pre-instantiated plugin
   * - An ExternalPluginFactory: factory function to call
   */
  plugins?: (string | KeplrMcpPlugin | ExternalPluginFactory)[];

  /** Toolset configuration for tool count management */
  toolsets?: Partial<ToolsetConfig>;

  /** RPC endpoint configuration */
  rpc?: RpcConfig;

  /** Skip Routes API configuration */
  skip?: SkipApiConfig;
}
