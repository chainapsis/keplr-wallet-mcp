import type { ChainInfo, Currency, FeeCurrency } from "@keplr-wallet/types";
import { getRpcResolver } from "../rpc/resolver.js";
import { safeParseJson } from "../utils/lcd-fetch.js";

/**
 * Response type for Osmosis txfees fee_tokens query.
 */
interface OsmosisFeeTokensResponse {
  fee_tokens: {
    denom: string;
    poolID: string;
  }[];
}

/**
 * Response type for feemarket gas prices query.
 */
interface FeeMarketGasPricesResponse {
  prices: {
    denom: string;
    amount: string;
  }[];
}

/**
 * Cache entry for fee tokens.
 */
interface FeeTokenCacheEntry {
  tokens: FeeCurrency[];
  timestamp: number;
}

/**
 * Cache for fee tokens per chain.
 * Cached for 5 minutes to avoid excessive API calls.
 */
const feeTokenCache: Map<string, FeeTokenCacheEntry> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if chain has osmosis-txfees feature.
 */
export function hasOsmosisTxFees(chain: ChainInfo): boolean {
  return chain.features?.includes("osmosis-txfees") ?? false;
}

/**
 * Check if chain has feemarket feature.
 */
export function hasFeeMarket(chain: ChainInfo): boolean {
  return chain.features?.includes("feemarket") ?? false;
}

/**
 * Check if chain has dynamic fee token support.
 */
export function hasDynamicFeeTokens(chain: ChainInfo): boolean {
  return hasOsmosisTxFees(chain) || hasFeeMarket(chain);
}

/**
 * Fetch fee tokens from Osmosis txfees module.
 */
async function fetchOsmosisFeeTokens(
  restEndpoint: string,
  chain: ChainInfo,
  headers?: Record<string, string>,
): Promise<FeeCurrency[]> {
  try {
    const response = await fetch(
      `${restEndpoint}/osmosis/txfees/v1beta1/fee_tokens`,
      { headers },
    );

    if (!response.ok) {
      console.warn(`Failed to fetch Osmosis fee tokens: ${response.status}`);
      return [];
    }

    const data = await safeParseJson<OsmosisFeeTokensResponse>(
      response,
      "/osmosis/txfees/v1beta1/fee_tokens",
    );
    const feeTokens: FeeCurrency[] = [];

    for (const token of data.fee_tokens) {
      // Try to find the currency in chain's currencies first
      const existingCurrency = chain.currencies.find(
        (c: Currency) => c.coinMinimalDenom === token.denom,
      );

      if (existingCurrency) {
        // Check if gasPriceStep exists (it's optional on Currency type)
        const defaultGasPriceStep = { low: 0.0025, average: 0.025, high: 0.04 };
        const gasPriceStep: { low: number; average: number; high: number } =
          "gasPriceStep" in existingCurrency &&
          existingCurrency.gasPriceStep &&
          typeof existingCurrency.gasPriceStep === "object" &&
          "low" in existingCurrency.gasPriceStep
            ? (existingCurrency.gasPriceStep as {
                low: number;
                average: number;
                high: number;
              })
            : defaultGasPriceStep;
        feeTokens.push({
          ...existingCurrency,
          gasPriceStep,
        });
      } else {
        // For IBC tokens, create a basic entry
        const isIBC = token.denom.startsWith("ibc/");
        feeTokens.push({
          coinDenom: isIBC ? `IBC/${token.denom.slice(4, 10)}...` : token.denom,
          coinMinimalDenom: token.denom,
          coinDecimals: 6, // Default, might need adjustment
          gasPriceStep: {
            low: 0.0025,
            average: 0.025,
            high: 0.04,
          },
        });
      }
    }

    return feeTokens;
  } catch (error) {
    console.warn(`Error fetching Osmosis fee tokens: ${error}`);
    return [];
  }
}

/**
 * Fetch fee tokens from feemarket module.
 */
async function fetchFeeMarketTokens(
  restEndpoint: string,
  chain: ChainInfo,
  headers?: Record<string, string>,
): Promise<FeeCurrency[]> {
  try {
    const response = await fetch(`${restEndpoint}/feemarket/v1/gas_prices`, {
      headers,
    });

    if (!response.ok) {
      console.warn(`Failed to fetch feemarket gas prices: ${response.status}`);
      return [];
    }

    const data = await safeParseJson<FeeMarketGasPricesResponse>(
      response,
      "/feemarket/v1/gas_prices",
    );
    const feeTokens: FeeCurrency[] = [];

    for (const price of data.prices) {
      const existingCurrency = chain.currencies.find(
        (c: Currency) => c.coinMinimalDenom === price.denom,
      );

      const gasPrice = parseFloat(price.amount);

      if (existingCurrency) {
        feeTokens.push({
          ...existingCurrency,
          gasPriceStep: {
            low: gasPrice,
            average: gasPrice * 1.2,
            high: gasPrice * 1.5,
          },
        });
      } else {
        feeTokens.push({
          coinDenom: price.denom,
          coinMinimalDenom: price.denom,
          coinDecimals: 6,
          gasPriceStep: {
            low: gasPrice,
            average: gasPrice * 1.2,
            high: gasPrice * 1.5,
          },
        });
      }
    }

    return feeTokens;
  } catch (error) {
    console.warn(`Error fetching feemarket tokens: ${error}`);
    return [];
  }
}

/**
 * Get fee tokens for a chain, using dynamic fetching if available.
 * Returns cached results if available and not expired.
 */
export async function getDynamicFeeTokens(
  chain: ChainInfo,
): Promise<FeeCurrency[]> {
  const cacheKey = chain.chainId;

  // Check cache
  const cached = feeTokenCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.tokens;
  }

  const resolved = getRpcResolver().resolveLcdEndpoint(
    chain.chainId,
    chain.rest,
  );

  let dynamicTokens: FeeCurrency[] = [];

  // Fetch based on chain features
  if (hasOsmosisTxFees(chain)) {
    dynamicTokens = await fetchOsmosisFeeTokens(
      resolved.url,
      chain,
      resolved.headers,
    );
  } else if (hasFeeMarket(chain)) {
    dynamicTokens = await fetchFeeMarketTokens(
      resolved.url,
      chain,
      resolved.headers,
    );
  }

  // Merge with static fee currencies (static ones take priority for gas prices)
  const staticDenoms = new Set(
    chain.feeCurrencies.map((fc: FeeCurrency) => fc.coinMinimalDenom),
  );
  const mergedTokens = [
    ...chain.feeCurrencies,
    ...dynamicTokens.filter((dt) => !staticDenoms.has(dt.coinMinimalDenom)),
  ];

  // Update cache
  feeTokenCache.set(cacheKey, {
    tokens: mergedTokens,
    timestamp: Date.now(),
  });

  return mergedTokens;
}

/**
 * Get all fee tokens for a chain (static + dynamic).
 * This is the main function to use for getting available fee tokens.
 */
export async function getAllFeeTokens(
  chain: ChainInfo,
): Promise<FeeCurrency[]> {
  if (hasDynamicFeeTokens(chain)) {
    return getDynamicFeeTokens(chain);
  }

  // For chains without dynamic fee tokens, return static config
  return chain.feeCurrencies;
}

/**
 * Clear the fee token cache for a specific chain or all chains.
 */
export function clearFeeTokenCache(chainId?: string): void {
  if (chainId) {
    feeTokenCache.delete(chainId);
  } else {
    feeTokenCache.clear();
  }
}

/**
 * Get cache info for debugging.
 */
export function getFeeTokenCacheInfo(): {
  chainId: string;
  tokenCount: number;
  ageMs: number;
}[] {
  const now = Date.now();
  return Array.from(feeTokenCache.entries()).map(([chainId, entry]) => ({
    chainId,
    tokenCount: entry.tokens.length,
    ageMs: now - entry.timestamp,
  }));
}
