/**
 * Osmosis protocol constants
 */

import {
  getRpcResolver,
  getTokenDecimals,
} from "@keplr-wallet/keplr-wallet-mcp/sdk";
import type { Currency } from "@keplr-wallet/types";
import { z } from "zod";

export const OSMOSIS_CHAIN_ID = "osmosis-1";

/** Human-readable amount schema: positive decimal number (e.g., "10", "0.5", "1.23") */
export const AMOUNT_IN_SCHEMA = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "Must be a positive number (e.g., '10', '0.5')")
  .describe(
    "Amount of input token in human-readable form (e.g., '10' for 10 OSMO)",
  );

/** Slippage tolerance schema (basis points): 1-500 bps = 0.01%-5%, default 50 bps = 0.5% */
export const SLIPPAGE_BPS_SCHEMA = z
  .number()
  .int()
  .min(1)
  .max(500)
  .optional()
  .default(50)
  .describe(
    "Slippage tolerance in basis points (1-500, default: 50 = 0.5%). Range: 0.01% to 5%.",
  );
const OSMOSIS_REST_FALLBACK = "https://lcd.osmosis.zone";

/** Resolve Osmosis LCD endpoint via the RPC resolver (Keplr infra when available). */
export const getOsmosisRest = (): {
  url: string;
  headers?: Record<string, string>;
} =>
  getRpcResolver().resolveLcdEndpoint(OSMOSIS_CHAIN_ID, OSMOSIS_REST_FALLBACK);

// --- Skip API configuration ---

export const SKIP_API_URL =
  process.env.SKIP_API_URL ?? "https://api.skip.build";
export const SKIP_API_KEY = process.env.SKIP_API_KEY;

/**
 * Token info extending Currency with IBC denom and convenience aliases.
 */
export interface OsmosisToken extends Currency {
  /** IBC denomination (for non-native tokens) */
  ibcDenom?: string;

  // Convenience aliases matching legacy naming
  /** Alias for coinMinimalDenom */
  readonly denom: string;
  /** Alias for coinDenom */
  readonly symbol: string;
  /** Alias for coinDecimals */
  readonly decimals: number;
}

/**
 * Helper to create an OsmosisToken with convenience aliases.
 */
function createToken(params: {
  symbol: string;
  minimalDenom: string;
  decimals: number;
  coinGeckoId?: string;
  ibcDenom?: string;
}): OsmosisToken {
  return {
    coinDenom: params.symbol,
    coinMinimalDenom: params.minimalDenom,
    coinDecimals: params.decimals,
    coinGeckoId: params.coinGeckoId,
    ibcDenom: params.ibcDenom,
    // Convenience aliases
    get denom() {
      return this.coinMinimalDenom;
    },
    get symbol() {
      return this.coinDenom;
    },
    get decimals() {
      return this.coinDecimals;
    },
  };
}

/**
 * Common token denominations on Osmosis using Keplr Currency format.
 * IBC denoms are the full trace paths.
 */
export const TOKENS: Record<string, OsmosisToken> = {
  // Native OSMO
  OSMO: createToken({
    symbol: "OSMO",
    minimalDenom: "uosmo",
    decimals: 6,
    coinGeckoId: "osmosis",
  }),
  // ION (native Osmosis governance token)
  ION: createToken({
    symbol: "ION",
    minimalDenom: "uion",
    decimals: 6,
    coinGeckoId: "ion",
  }),
  // ATOM via IBC from Cosmos Hub
  ATOM: createToken({
    symbol: "ATOM",
    minimalDenom:
      "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
    decimals: 6,
    coinGeckoId: "cosmos",
    ibcDenom:
      "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
  }),
  // USDC via IBC from Noble
  USDC: createToken({
    symbol: "USDC",
    minimalDenom:
      "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
    decimals: 6,
    coinGeckoId: "usd-coin",
    ibcDenom:
      "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
  }),
  // USDT via IBC from Kava
  USDT: createToken({
    symbol: "USDT",
    minimalDenom:
      "ibc/4ABBEF4C8926DDDB320AE5188CFD63267ABBCEFC0583E4AE05D6E5AA2401DDAB",
    decimals: 6,
    coinGeckoId: "tether",
    ibcDenom:
      "ibc/4ABBEF4C8926DDDB320AE5188CFD63267ABBCEFC0583E4AE05D6E5AA2401DDAB",
  }),
  // stATOM (liquid staked ATOM from Stride)
  stATOM: createToken({
    symbol: "stATOM",
    minimalDenom:
      "ibc/C140AFD542AE77BD7DCC83F13FDD8C5E5BB8C4929785E6EC2F4C636F98F17901",
    decimals: 6,
    coinGeckoId: "stride-staked-atom",
    ibcDenom:
      "ibc/C140AFD542AE77BD7DCC83F13FDD8C5E5BB8C4929785E6EC2F4C636F98F17901",
  }),
  // TIA (Celestia) via IBC
  TIA: createToken({
    symbol: "TIA",
    minimalDenom:
      "ibc/D79E7D83AB399BFFF93433E54FAA480C191248FC556924A2A8351AE2638B3877",
    decimals: 6,
    coinGeckoId: "celestia",
    ibcDenom:
      "ibc/D79E7D83AB399BFFF93433E54FAA480C191248FC556924A2A8351AE2638B3877",
  }),
  // INJ (Injective) via IBC - note: 18 decimals
  INJ: createToken({
    symbol: "INJ",
    minimalDenom:
      "ibc/64BA6E31FE887D66C6F8F31C7B1A80C7CA179239677B4088BB55F5EA07DBE273",
    decimals: 18,
    coinGeckoId: "injective-protocol",
    ibcDenom:
      "ibc/64BA6E31FE887D66C6F8F31C7B1A80C7CA179239677B4088BB55F5EA07DBE273",
  }),
};

/**
 * Well-known pool IDs for common pairs
 * These are the most liquid pools for direct swaps
 */
export const KNOWN_POOLS: Record<
  string,
  { poolId: number; tokenA: string; tokenB: string }
> = {
  "OSMO/ATOM": { poolId: 1, tokenA: "OSMO", tokenB: "ATOM" },
  "ION/OSMO": { poolId: 2, tokenA: "ION", tokenB: "OSMO" },
  "OSMO/USDC": { poolId: 678, tokenA: "OSMO", tokenB: "USDC" },
  "ATOM/USDC": { poolId: 1251, tokenA: "ATOM", tokenB: "USDC" },
  "OSMO/USDT": { poolId: 712, tokenA: "OSMO", tokenB: "USDT" },
  "OSMO/stATOM": { poolId: 803, tokenA: "OSMO", tokenB: "stATOM" },
  "OSMO/TIA": { poolId: 1248, tokenA: "OSMO", tokenB: "TIA" },
};

/**
 * Resolve token symbol or denom to full token info.
 * Uses Keplr Currency format with convenience aliases.
 */
export function resolveToken(symbolOrDenom: string): OsmosisToken {
  const upperInput = symbolOrDenom.toUpperCase();

  // Check known tokens by symbol (case-insensitive)
  for (const [key, token] of Object.entries(TOKENS)) {
    if (key.toUpperCase() === upperInput) {
      return token;
    }
  }

  // Check if it's already a denom (starts with 'u' for native or 'ibc/' for IBC)
  if (symbolOrDenom.startsWith("u") || symbolOrDenom.startsWith("ibc/")) {
    // Try to find by denom
    for (const token of Object.values(TOKENS)) {
      if (token.coinMinimalDenom === symbolOrDenom) {
        return token;
      }
    }

    // Unknown denom - use getTokenDecimals for proper decimal detection
    const decimals = getTokenDecimals(symbolOrDenom);
    const displaySymbol =
      symbolOrDenom.length > 10
        ? `${symbolOrDenom.slice(0, 10)}...`
        : symbolOrDenom;

    return createToken({
      symbol: displaySymbol,
      minimalDenom: symbolOrDenom,
      decimals,
      ...(symbolOrDenom.startsWith("ibc/") && { ibcDenom: symbolOrDenom }),
    });
  }

  throw new Error(
    `Unknown token "${symbolOrDenom}". Supported symbols: ${Object.keys(TOKENS).join(", ")}`,
  );
}

/**
 * Legacy helpers for backward compatibility.
 */
export function getLegacyTokenInfo(symbolOrDenom: string): {
  denom: string;
  decimals: number;
  symbol: string;
} {
  const token = resolveToken(symbolOrDenom);
  return {
    denom: token.coinMinimalDenom,
    decimals: token.coinDecimals,
    symbol: token.coinDenom,
  };
}
