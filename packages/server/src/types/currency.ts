/**
 * Currency Types
 *
 * Unified currency handling based on @keplr-wallet/types.
 * Provides conversion utilities between Keplr standard and MCP server formats.
 */

import type {
  AppCurrency,
  Currency as KeplrCurrency,
  FeeCurrency as KeplrFeeCurrency,
} from "@keplr-wallet/types";

// Re-export Keplr types for convenience
export type { KeplrCurrency, KeplrFeeCurrency, AppCurrency };

/**
 * Extended currency type for MCP server use.
 * Adds convenience aliases that match common naming conventions.
 */
export interface McpCurrency extends KeplrCurrency {
  /**
   * Convenience alias for coinDenom.
   * The display symbol (e.g., "ATOM", "OSMO").
   */
  readonly symbol: string;

  /**
   * Convenience alias for coinMinimalDenom.
   * The on-chain denomination (e.g., "uatom", "uosmo").
   */
  readonly minimalDenom: string;

  /**
   * Convenience alias for coinDecimals.
   * Number of decimal places (e.g., 6 for ATOM, 18 for INJ).
   */
  readonly decimals: number;
}

/**
 * Extended fee currency with gas price step information.
 */
export interface McpFeeCurrency extends McpCurrency {
  /**
   * Gas price steps for fee calculation.
   */
  readonly gasPriceStep?: {
    readonly low: number;
    readonly average: number;
    readonly high: number;
  };
}

/**
 * Token info for protocol plugins (Osmosis, Uniswap).
 * Extends the base currency with optional IBC/contract information.
 */
export interface TokenInfo extends KeplrCurrency {
  /**
   * IBC denomination for tokens transferred via IBC.
   * Format: "ibc/{hash}"
   */
  readonly ibcDenom?: string;

  /**
   * Contract address for ERC-20 or CW-20 tokens.
   */
  readonly contractAddress?: string;
}

/**
 * Convert a Keplr Currency to MCP extended format with convenience aliases.
 */
export function toMcpCurrency(currency: KeplrCurrency): McpCurrency {
  return {
    ...currency,
    symbol: currency.coinDenom,
    minimalDenom: currency.coinMinimalDenom,
    decimals: currency.coinDecimals,
  };
}

/**
 * Create an MCP currency from individual values.
 */
export function createMcpCurrency(params: {
  symbol: string;
  minimalDenom: string;
  decimals: number;
  coinGeckoId?: string;
  coinImageUrl?: string;
}): McpCurrency {
  return {
    coinDenom: params.symbol,
    coinMinimalDenom: params.minimalDenom,
    coinDecimals: params.decimals,
    coinGeckoId: params.coinGeckoId,
    coinImageUrl: params.coinImageUrl,
    // Convenience aliases
    symbol: params.symbol,
    minimalDenom: params.minimalDenom,
    decimals: params.decimals,
  };
}

/**
 * Create a fee currency with gas price step from a gas price string.
 *
 * @param currency - Base currency
 * @param gasPriceStr - Gas price string (e.g., "0.025uatom")
 * @returns Fee currency with gas price step
 */
export function createFeeCurrency(
  currency: McpCurrency,
  gasPriceStr: string,
): McpFeeCurrency {
  const gasPriceStep = parseGasPriceStep(gasPriceStr);

  return {
    ...currency,
    gasPriceStep,
  };
}

/**
 * Parse a gas price string into a gas price step object.
 *
 * @param gasPriceStr - Gas price string (e.g., "0.025uatom")
 * @returns Gas price step with low, average, and high values
 */
export function parseGasPriceStep(gasPriceStr: string): {
  low: number;
  average: number;
  high: number;
} {
  const match = gasPriceStr.match(/^([\d.]+)/);
  if (!match) {
    // Default gas price step
    return { low: 0.01, average: 0.025, high: 0.04 };
  }

  const basePrice = parseFloat(match[1]);

  // Create low/average/high from base price
  return {
    low: basePrice,
    average: basePrice * 1.5,
    high: basePrice * 2,
  };
}

/**
 * Known tokens with 18 decimals in Cosmos ecosystem.
 * These tokens deviate from the common 6-decimal standard.
 */
export const KNOWN_18_DECIMAL_DENOMS = new Set([
  "inj", // Injective
  "adydx", // dYdX
  "aevmos", // Evmos
  "wei", // Generic wei-based
]);

/**
 * Get decimals for a token, checking against known 18-decimal tokens.
 *
 * Resolution order:
 * 1. Exact match in KNOWN_18_DECIMAL_DENOMS
 * 2. "st" prefix → strip and recurse (stToken inherits host denom decimals)
 * 3. "a" prefix → atto (10⁻¹⁸) convention (excludes compound denoms with "-" or "/")
 * 4. Default (6)
 *
 * @param denom - The token denomination
 * @param defaultDecimals - Default decimals if not a known 18-decimal token (default: 6)
 * @returns The number of decimals for the token
 */
export function getTokenDecimals(
  denom: string,
  defaultDecimals: number = 6,
  _depth: number = 0,
): number {
  const lowerDenom = denom.toLowerCase();

  // Check if it's a known 18-decimal token
  if (KNOWN_18_DECIMAL_DENOMS.has(lowerDenom)) {
    return 18;
  }

  // Osmosis LP share tokens use 18 decimals
  if (
    lowerDenom.startsWith("gamm/pool/") ||
    lowerDenom.startsWith("cl/pool/")
  ) {
    return 18;
  }

  // stToken prefix: strip "st" and resolve the underlying host denom
  // e.g. staISLM → aISLM → 18, stuatom → uatom → 6
  if (lowerDenom.startsWith("st") && lowerDenom.length > 2 && _depth < 1) {
    return getTokenDecimals(denom.slice(2), defaultDecimals, _depth + 1);
  }

  // "a" prefix = atto = 18 decimals (universal Cosmos EVM chain convention)
  // Exclude compound denoms containing "-" or "/" (e.g. arbitrum-uusdt, factory/…/ausd)
  if (
    lowerDenom.startsWith("a") &&
    lowerDenom.length > 1 &&
    !lowerDenom.includes("-") &&
    !lowerDenom.includes("/")
  ) {
    return 18;
  }

  return defaultDecimals;
}
