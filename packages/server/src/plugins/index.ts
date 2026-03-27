import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { discoverExternalAdapters } from "../adapter-loader.js";
import { CosmosAdapter } from "../adapters/cosmos.js";
import { initializeAuthManager } from "../auth/manager.js";
import { registerAuthProviders } from "../auth/providers/index.js";
import { initializeCustomChains } from "../chains/cosmos.js";
import { wrapExternalPlugin } from "../config/plugin-adapter.js";
import { shouldRegisterPlugin } from "../config/toolset-filter.js";
import type { KeplrMcpPlugin } from "../config/types.js";
import type { EcosystemAdapter } from "../ecosystem.js";
import { discoverProtocolPlugins } from "../protocol-loader.js";
import type { KeplrStore } from "../store.js";
import accountsPlugin from "./accounts.js";
import adapterInfoPlugin from "./adapter-info.js";
import authPlugin from "./auth.js";
import chainManagementPlugin from "./chain-management.js";
import confirmPlugin from "./confirm.js";
import keplrRpcPlugin from "./keplr-rpc.js";
import metaToolsPlugin from "./meta/index.js";
import unifiedPortfolioPlugin from "./unified-portfolio.js";

const builtinAdapters: EcosystemAdapter[] = [new CosmosAdapter()];

export async function registerAll(
  server: McpServer,
  store: KeplrStore,
  externalPlugins: KeplrMcpPlugin[] = [],
  defaultToolsets?: string[],
): Promise<void> {
  // Initialize active account in store
  await store.initializeActiveAccount();

  // Initialize authentication system
  registerAuthProviders();
  await initializeAuthManager();

  // Initialize custom Cosmos chains from storage
  await initializeCustomChains();

  const allAdapters: EcosystemAdapter[] = [...builtinAdapters];

  // Discover and merge external adapters
  const external = await discoverExternalAdapters();
  const builtinTypes = new Set(builtinAdapters.map((a) => a.type));
  for (const adapter of external) {
    if (builtinTypes.has(adapter.type)) {
      console.error(
        `[keplr] Skipping external "${adapter.type}" — conflicts with built-in.`,
      );
      continue;
    }
    allAdapters.push(adapter);
  }

  // 1. Register adapters
  for (const adapter of allAdapters) {
    store.registerAdapter(adapter);
  }

  // 2. Initialize adapters (load custom chains, etc.)
  for (const adapter of allAdapters) {
    if (adapter.initialize) {
      await adapter.initialize();
    }
  }

  // 3. Common plugins — filtered by toolset config
  const commonPlugins = [
    { name: "meta-tools", plugin: metaToolsPlugin },
    { name: "accounts", plugin: accountsPlugin },
    { name: "confirm", plugin: confirmPlugin },
    { name: "adapter-info", plugin: adapterInfoPlugin },
    { name: "chain-management", plugin: chainManagementPlugin },
    { name: "auth", plugin: authPlugin },
    { name: "unified-portfolio", plugin: unifiedPortfolioPlugin },
    { name: "keplr-rpc", plugin: keplrRpcPlugin },
  ];
  for (const { name, plugin } of commonPlugins) {
    if (shouldRegisterPlugin(name, defaultToolsets)) {
      await plugin.register(server, store);
    }
  }

  // 3b. External plugins from keplr-mcp.config.ts
  const sharedData = new Map<string, unknown>();
  for (const plugin of externalPlugins) {
    const wrapped = wrapExternalPlugin(plugin, sharedData);
    await wrapped.register(server, store);
  }

  // 4. Ecosystem-specific plugins (collected from adapters)
  for (const adapter of allAdapters) {
    for (const plugin of adapter.getPlugins()) {
      await plugin.register(server, store);
    }
  }

  // 5. Protocol plugins (Uniswap, Aave, etc.)
  const adapterTypes = new Set(allAdapters.map((a) => a.type));
  const protocolPlugins = await discoverProtocolPlugins();
  for (const protocol of protocolPlugins) {
    if (!adapterTypes.has(protocol.ecosystem)) {
      console.error(
        `[keplr] Skipping protocol "${protocol.protocolId}" — requires "${protocol.ecosystem}" adapter.`,
      );
      continue;
    }
    store.registerProtocol(protocol);
    await protocol.register(server, store);
  }
}
