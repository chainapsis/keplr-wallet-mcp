import type { KeplrMcpConfig } from "./types.js";

/**
 * Type-safe config helper (identity function).
 * Enables TypeScript autocomplete in keplr-mcp.config.ts.
 *
 * @example
 * // keplr-mcp.config.ts
 * import { defineConfig } from "@keplr-wallet/keplr-wallet-mcp";
 * export default defineConfig({
 *   plugins: [myPlugin()],
 *   toolsets: { default: ["cosmos-query", "cosmos-transaction"] },
 * });
 */
export const defineConfig = (config: KeplrMcpConfig): KeplrMcpConfig => {
  return config;
};
