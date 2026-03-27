import { readJsonConfig, writeJsonConfig } from "../config-storage.js";

const CHAINS_CONFIG_FILE = "chains.json";

/**
 * Legacy chain config format stored on disk (v1).
 * This is the flattened format used for persistence.
 */
export interface StoredChainConfig {
  chainId: string;
  chainName: string;
  rpc: string;
  rest: string;
  bech32Prefix: string;
  denom: string;
  minimalDenom: string;
  decimals: number;
  gasPrice: string;
  coinGeckoId?: string;
}

/**
 * Configuration structure v1 (original format).
 */
export interface ChainsConfigV1 {
  version?: 1;
  cosmos: Record<string, StoredChainConfig>;
}

/**
 * Configuration structure v2 (current format).
 */
export interface ChainsConfigV2 {
  version: 2;
  cosmos: Record<string, StoredChainConfig>;
}

/**
 * Current configuration version.
 */
export const CURRENT_CONFIG_VERSION = 2;

/**
 * Configuration structure for custom chains stored in ~/.keplr-mcp/chains.json
 */
export type ChainsConfig = ChainsConfigV2;

/**
 * Migrate config from any version to current version.
 */
function migrateConfig(config: unknown): ChainsConfig {
  // Handle null/undefined
  if (!config || typeof config !== "object") {
    return {
      version: CURRENT_CONFIG_VERSION,
      cosmos: {},
    };
  }

  const obj = config as Record<string, unknown>;

  // Already at current version
  if (obj.version === CURRENT_CONFIG_VERSION) {
    return {
      version: CURRENT_CONFIG_VERSION,
      cosmos: (obj.cosmos as Record<string, StoredChainConfig>) ?? {},
    };
  }

  // Migrate from v1 (or missing version) to v2: normalize to cosmos-only
  return {
    version: CURRENT_CONFIG_VERSION,
    cosmos: (obj.cosmos as Record<string, StoredChainConfig>) ?? {},
  };
}

/**
 * Load custom chains configuration from disk.
 * Automatically migrates from older versions if needed.
 */
export async function loadCustomChains(): Promise<ChainsConfig> {
  const config = await readJsonConfig<unknown>(CHAINS_CONFIG_FILE);
  const migrated = migrateConfig(config);

  // Save if migration occurred
  if (config && (config as ChainsConfig).version !== migrated.version) {
    await saveCustomChains(migrated);
  }

  return migrated;
}

/**
 * Save custom chains configuration to disk.
 */
export async function saveCustomChains(config: ChainsConfig): Promise<void> {
  // Ensure version is set
  const configWithVersion = {
    ...config,
    version: CURRENT_CONFIG_VERSION,
  };
  await writeJsonConfig(CHAINS_CONFIG_FILE, configWithVersion);
}

/**
 * Add a custom Cosmos chain.
 */
export async function addCosmosChain(
  chainConfig: StoredChainConfig,
): Promise<void> {
  const config = await loadCustomChains();
  config.cosmos[chainConfig.chainId] = chainConfig;
  await saveCustomChains(config);
}

/**
 * Remove a custom Cosmos chain.
 * @returns true if the chain was removed, false if it didn't exist
 */
export async function removeCosmosChain(chainId: string): Promise<boolean> {
  const config = await loadCustomChains();
  if (!config.cosmos[chainId]) {
    return false;
  }
  delete config.cosmos[chainId];
  await saveCustomChains(config);
  return true;
}

/**
 * Check if a Cosmos chain is a custom chain.
 */
export async function isCustomCosmosChain(chainId: string): Promise<boolean> {
  const config = await loadCustomChains();
  return chainId in config.cosmos;
}

// Re-export type for backward compatibility
export type { StoredChainConfig as ChainConfig };
