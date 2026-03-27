/**
 * SDK version for compatibility checking.
 * External adapters and protocols can declare their required sdkVersion.
 */
export const SDK_VERSION = "1.0.0";

/**
 * Check if a plugin's SDK version is compatible with the server.
 * Uses semantic versioning: major version must match.
 *
 * @param pluginVersion - The sdkVersion declared by the plugin (optional)
 * @param pluginName - Name of the plugin for warning messages
 * @returns Compatibility result with optional warning message
 */
export function checkVersionCompatibility(
  pluginVersion: string | undefined,
  pluginName: string,
): { compatible: boolean; warning?: string } {
  if (!pluginVersion) {
    return {
      compatible: true,
      warning: `${pluginName} does not specify sdkVersion`,
    };
  }

  const [sdkMajor] = SDK_VERSION.split(".").map(Number);
  const [pluginMajor] = pluginVersion.split(".").map(Number);

  if (pluginMajor !== sdkMajor) {
    return {
      compatible: false,
      warning: `${pluginName} requires SDK v${pluginVersion}, but server is v${SDK_VERSION}`,
    };
  }

  return { compatible: true };
}
