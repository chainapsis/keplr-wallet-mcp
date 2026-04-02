/**
 * Plugins that are always registered regardless of toolset configuration.
 * These are required for the server to function correctly.
 */
const ALWAYS_REGISTER = new Set([
  "meta-tools", // search-tools, describe-tools — required for tool discovery
  "accounts", // account management — required for all wallet operations
  "confirm", // transaction confirmation flow
  "auth", // authentication
  "adapter-info", // ecosystem info
  "keplr-rpc", // Keplr Infra API key & usage management
]);

/**
 * Maps internal plugin names to their toolset category.
 * Plugins not in this map default to always registered.
 */
const PLUGIN_TO_CATEGORY: Record<string, string> = {
  "cosmos-query": "cosmos-query",
  "cosmos-transaction": "cosmos-transaction",
  cosmwasm: "cosmwasm",
  "cosmos-signing": "cosmos-signing",
  "unified-portfolio": "cosmos-query",
};

/**
 * Determine whether a plugin should be registered at startup.
 *
 * @param pluginName - Internal plugin name
 * @param defaultToolsets - Categories from toolsets.default config (undefined = no filter)
 */
export const shouldRegisterPlugin = (
  pluginName: string,
  defaultToolsets: string[] | undefined,
): boolean => {
  // Always-on plugins
  if (ALWAYS_REGISTER.has(pluginName)) return true;

  // No filter configured → register everything
  if (!defaultToolsets) return true;

  // Check if plugin's category is in the default toolset
  const category = PLUGIN_TO_CATEGORY[pluginName];
  if (!category) return true; // Unknown plugins default to registered

  return defaultToolsets.includes(category);
};
