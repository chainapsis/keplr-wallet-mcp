import type { RpcConfig } from "../config/types.js";
import { KEPLR_CHAIN_MAP } from "./keplr-chains.js";

/** Resolved RPC endpoint. Compatible with CosmJS HttpEndpoint. */
export interface ResolvedEndpoint {
  url: string;
  headers?: Record<string, string>;
}

const KEPLR_ENDPOINT_BASE = "https://api.keplr.app";

/**
 * Chains where the Keplr LCD endpoint is known to be unreliable.
 * These skip Keplr infra for LCD and fall back to chain config.
 * RPC resolution is unaffected.
 */
const KEPLR_LCD_EXCLUDED_CHAINS: ReadonlySet<string> = new Set([]);

/**
 * Resolves RPC/LCD endpoints with a tiered priority:
 * 1. Per-chain override (config.overrides) — RPC only
 * 2. Keplr infrastructure (config.apiKey + supported chains) → api.keplr.app + X-API-Key
 * 3. Chain config fallback (chain.rpc / chain.rest)
 */
export class RpcResolver {
  constructor(private readonly config: RpcConfig) {}

  /** Whether this resolver was initialized with a Keplr API key. */
  get hasApiKey(): boolean {
    return !!this.config.apiKey;
  }

  /** The configured API key, if any. */
  get apiKey(): string | undefined {
    return this.config.apiKey;
  }

  /**
   * Resolve the best RPC endpoint for a given chain ID.
   * Returns an object compatible with CosmJS HttpEndpoint interface.
   * @param chainId - Cosmos chain ID
   * @param fallbackUrl - Fallback URL from chain config (chain.rpc)
   */
  resolveEndpoint(chainId: string, fallbackUrl: string): ResolvedEndpoint {
    // Priority 1: explicit chain override
    const override = this.config.overrides?.[chainId];
    if (override) {
      return { url: override };
    }

    // Priority 2: Keplr infrastructure (31 supported chains)
    if (this.config.apiKey) {
      const keplrName = KEPLR_CHAIN_MAP[chainId];
      if (keplrName) {
        return {
          url: `${KEPLR_ENDPOINT_BASE}/rpc/${keplrName}`,
          headers: {
            "X-API-Key": this.config.apiKey,
            "X-Client-Type": "keplr-mcp",
          },
        };
      }
    }

    // Priority 3: chain config fallback
    if (!fallbackUrl) {
      throw new Error(`No RPC endpoint available for chain ${chainId}`);
    }
    return { url: fallbackUrl };
  }

  /**
   * Resolve the best LCD (REST) endpoint for a given chain ID.
   * @param chainId - Cosmos chain ID
   * @param fallbackUrl - Fallback URL from chain config (chain.rest)
   */
  resolveLcdEndpoint(chainId: string, fallbackUrl: string): ResolvedEndpoint {
    // Priority 1: Keplr infrastructure (skip chains with known LCD issues)
    if (this.config.apiKey && !KEPLR_LCD_EXCLUDED_CHAINS.has(chainId)) {
      const keplrName = KEPLR_CHAIN_MAP[chainId];
      if (keplrName) {
        return {
          url: `${KEPLR_ENDPOINT_BASE}/rest/${keplrName}`,
          headers: {
            "X-API-Key": this.config.apiKey,
            "X-Client-Type": "keplr-mcp",
          },
        };
      }
    }

    // Priority 2: chain config fallback
    if (!fallbackUrl) {
      throw new Error(`No LCD endpoint available for chain ${chainId}`);
    }
    return { url: fallbackUrl };
  }
}

/** Singleton resolver — initialized lazily from config */
let _resolver: RpcResolver | null = null;

export const getRpcResolver = (config?: RpcConfig): RpcResolver => {
  if (!_resolver) {
    _resolver = new RpcResolver(config ?? {});
  } else if (config?.apiKey && !_resolver.hasApiKey) {
    // Singleton was initialized without config (e.g. early import). Re-initialize with proper config.
    console.warn(
      "[rpc] Resolver was initialized without API key — reinitializing with config",
    );
    _resolver = new RpcResolver(config);
  }
  return _resolver;
};

/** Reset singleton for testing. */
export const _resetResolver = (): void => {
  _resolver = null;
};
