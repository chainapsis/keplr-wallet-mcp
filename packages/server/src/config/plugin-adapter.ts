import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KeplrPlugin } from "../plugins/types.js";
import type { KeplrStore } from "../store.js";
import type {
  ExternalPluginContext,
  ExternalPluginFactory,
  KeplrMcpPlugin,
} from "./types.js";

/**
 * Create an ExternalPluginContext backed by a shared Map.
 * The Map is shared across all external plugins — use namespaced keys.
 */
export const createExternalPluginContext = (
  pluginName: string,
  sharedData: Map<string, unknown>,
): ExternalPluginContext => ({
  get: <T>(key: string) => sharedData.get(key) as T | undefined,
  set: (key: string, value: unknown) => {
    sharedData.set(key, value);
  },
  logger: {
    debug: (msg) => console.debug(`[${pluginName}] DEBUG: ${msg}`),
    info: (msg) => console.info(`[${pluginName}] INFO: ${msg}`),
    warn: (msg) => console.error(`[${pluginName}] WARN: ${msg}`),
    error: (msg) => console.error(`[${pluginName}] ERROR: ${msg}`),
  },
});

/**
 * Resolve an external plugin entry to a KeplrMcpPlugin.
 * Handles: plugin object, factory function.
 * String entries (npm package names) are handled by the loader before this.
 */
export const resolveExternalPlugin = (
  entry: KeplrMcpPlugin | ExternalPluginFactory,
): KeplrMcpPlugin | KeplrMcpPlugin[] => {
  if (typeof entry === "function") {
    return entry();
  }
  return entry;
};

/**
 * Wrap an external KeplrMcpPlugin into the internal KeplrPlugin interface.
 * The shared data Map enables inter-plugin communication.
 */
export const wrapExternalPlugin = (
  external: KeplrMcpPlugin,
  sharedData: Map<string, unknown> = new Map(),
): KeplrPlugin => ({
  name: external.name,

  register: async (server: McpServer, _store: KeplrStore): Promise<void> => {
    const ctx = createExternalPluginContext(external.name, sharedData);

    // setup() must complete before registerTools()
    if (external.setup) {
      await external.setup(ctx);
    }
    if (external.registerTools) {
      await external.registerTools(server, ctx);
    }
  },

  onUnload: external.teardown
    ? async (): Promise<void> => {
        await external.teardown?.();
      }
    : undefined,
});
