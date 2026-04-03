/**
 * Skip-based denom resolver for Osmosis.
 * Uses Skip `/v2/fungible/assets` for dynamic token lookup with 5-minute TTL cache.
 */

import { getTokenDecimals } from "../../../sdk.js";
import { OSMOSIS_CHAIN_ID } from "./constants.js";
import { type SkipAsset, skipFetch } from "./skip-api.js";

// --- Cache ---

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedAssets: SkipAsset[] | null = null;
let cachedAt = 0;
let pending: Promise<SkipAsset[]> | null = null;

/** Exposed for testing: reset the internal asset cache. */
export const _resetCache = (): void => {
  cachedAssets = null;
  cachedAt = 0;
  pending = null;
};

// --- Structural denom detection ---

/** Returns true if the input looks like a raw on-chain denom (contains `/`). */
export const isStructuralDenom = (input: string): boolean =>
  input.includes("/");

// --- Asset fetching ---

interface SkipAssetsResponse {
  chain_to_assets_map: Record<string, { assets: SkipAsset[] }>;
}

/** Fetch Osmosis assets from Skip API with 5-minute TTL cache. */
export const getSkipOsmosisAssets = async (): Promise<SkipAsset[]> => {
  const now = Date.now();
  if (cachedAssets && now - cachedAt < CACHE_TTL_MS) {
    return cachedAssets;
  }
  if (pending) return pending;

  pending = skipFetch<SkipAssetsResponse>(
    `/v2/fungible/assets?chain_id=${OSMOSIS_CHAIN_ID}`,
  )
    .then((data) => {
      const osmosisEntry = data.chain_to_assets_map[OSMOSIS_CHAIN_ID];
      const assets = osmosisEntry?.assets ?? [];
      if (assets.length === 0) {
        throw new Error(
          `Skip API returned no assets for chain ${OSMOSIS_CHAIN_ID}`,
        );
      }
      cachedAssets = assets;
      cachedAt = Date.now();
      return cachedAssets;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
};

// --- Denom resolution ---

export interface ResolvedDenom {
  denom: string;
  symbol: string;
  decimals: number;
}

/**
 * Resolve a symbol or denom string to `{ denom, symbol, decimals }`.
 *
 * Resolution order:
 * 1. Structural denom (contains `/`) → passthrough, enrich from Skip if available
 * 2. Exact denom match in Skip assets (e.g. `uosmo`)
 * 3. Case-insensitive symbol / recommended_symbol match
 * 4. Error
 */
export const resolveOsmosisDenom = async (
  symbolOrDenom: string,
): Promise<ResolvedDenom> => {
  const assets = await getSkipOsmosisAssets();

  // 1. Structural denom — contains "/" so it's a raw on-chain denom
  if (isStructuralDenom(symbolOrDenom)) {
    const match = assets.find((a) => a.denom === symbolOrDenom);
    if (match) {
      return {
        denom: match.denom,
        symbol: match.recommended_symbol ?? match.symbol,
        decimals: match.decimals,
      };
    }
    // Not in Skip assets but still a valid structural denom — fallback
    const decimals = getTokenDecimals(symbolOrDenom);
    const symbol =
      symbolOrDenom.length > 10
        ? `${symbolOrDenom.slice(0, 10)}...`
        : symbolOrDenom;
    return { denom: symbolOrDenom, symbol, decimals };
  }

  // 2. Exact denom match (e.g. "uosmo")
  const denomMatch = assets.find((a) => a.denom === symbolOrDenom);
  if (denomMatch) {
    return {
      denom: denomMatch.denom,
      symbol: denomMatch.recommended_symbol ?? denomMatch.symbol,
      decimals: denomMatch.decimals,
    };
  }

  // 3. Case-insensitive symbol match — prefer recommended_symbol exact match first
  const lower = symbolOrDenom.toLowerCase();

  // 3a. recommended_symbol exact match (canonical name, e.g. "USDC" not "USDC.carbon")
  const recMatch = assets.find(
    (a) => a.recommended_symbol?.toLowerCase() === lower,
  );
  if (recMatch) {
    return {
      denom: recMatch.denom,
      symbol: recMatch.recommended_symbol ?? recMatch.symbol,
      decimals: recMatch.decimals,
    };
  }

  // 3b. symbol match (may match variants like "USDC.wh")
  const symbolMatch = assets.find((a) => a.symbol.toLowerCase() === lower);
  if (symbolMatch) {
    return {
      denom: symbolMatch.denom,
      symbol: symbolMatch.recommended_symbol ?? symbolMatch.symbol,
      decimals: symbolMatch.decimals,
    };
  }

  // 4. Not found
  throw new Error(
    `Token '${symbolOrDenom}' not found on Osmosis. Use exact denom or check symbol.`,
  );
};
