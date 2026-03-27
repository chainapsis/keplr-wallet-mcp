/**
 * IBC Resolution Utilities
 *
 * Tier 1: Resolves IBC channel IDs to human-readable destination chain names.
 * Tier 2: Resolves unregistered IBC token denoms to original token metadata
 *         via on-chain denom trace queries.
 * Both tiers use caching to avoid repeated API calls.
 *
 * Example:
 *   "channel-141" on cosmoshub-4 → "Osmosis"
 *   "ibc/27394F..." on osmosis-1 → ATOM (6 decimals)
 */

import type { ChainInfo } from "@keplr-wallet/types";
import {
  type DenomMetadata,
  findChainByName,
  getChainConfig,
  resolveChainDenom,
} from "../chains/cosmos.js";
import type { BalanceResult, CosmosClient } from "../clients/cosmos.js";
import { getRpcResolver } from "../rpc/resolver.js";
import { getTokenDecimals } from "../types/currency.js";
import { formatDisplayAmount } from "./balance-formatter.js";
import { safeParseJson } from "./lcd-fetch.js";

const LOG_PREFIX = "[IBC]";

/** Cache key format: `${sourceChainId}:${channelId}` */
interface IbcCacheEntry {
  chainName: string;
  counterpartyChainId: string;
  expiresAt: number;
}

const ibcChannelCache = new Map<string, IbcCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const buildCacheKey = (chainId: string, channelId: string): string =>
  `${chainId}:${channelId}`;

/**
 * Get cached IBC destination name (sync).
 *
 * @param chainId - Source chain ID (e.g., "cosmoshub-4")
 * @param channelId - IBC channel ID (e.g., "channel-141")
 * @returns Chain name or null if not cached/expired
 */
export const getIbcDestinationName = (
  chainId: string,
  channelId: string,
): string | null => {
  const cacheKey = buildCacheKey(chainId, channelId);
  const cached = ibcChannelCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.chainName;
  }

  if (cached) {
    ibcChannelCache.delete(cacheKey);
  }

  return null;
};

/**
 * Get cached IBC destination chain ID (sync).
 *
 * @param chainId - Source chain ID
 * @param channelId - IBC channel ID
 * @returns Counterparty chain ID or null if not cached/expired
 */
export const getIbcDestinationChainId = (
  chainId: string,
  channelId: string,
): string | null => {
  const cacheKey = buildCacheKey(chainId, channelId);
  const cached = ibcChannelCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.counterpartyChainId;
  }

  if (cached) {
    ibcChannelCache.delete(cacheKey);
  }

  return null;
};

/**
 * Preload IBC channel mappings for a chain (async).
 * Fetches IBC channels (optionally filtered) and caches the mappings.
 *
 * @param client - CosmosClient instance
 * @param chain - Source chain info
 * @param channels - Optional list of specific channels to preload
 */
export const preloadIbcChannels = async (
  client: CosmosClient,
  chain: ChainInfo,
  channels?: string[],
): Promise<void> => {
  try {
    const { channels: ibcChannels } = await client.getIbcChannels(chain, {
      enrichChainIds: true,
    });

    const channelsToCache = channels
      ? ibcChannels.filter((c) => channels.includes(c.channelId))
      : ibcChannels;

    const expiresAt = Date.now() + CACHE_TTL_MS;

    for (const channel of channelsToCache) {
      if (channel.counterpartyChainId) {
        const cacheKey = buildCacheKey(chain.chainId, channel.channelId);
        const chainInfo = findChainByName(channel.counterpartyChainId);
        const chainName = chainInfo?.chainName ?? channel.counterpartyChainId;

        ibcChannelCache.set(cacheKey, {
          chainName,
          counterpartyChainId: channel.counterpartyChainId,
          expiresAt,
        });
      }
    }
  } catch (_) {
    // IBC channel preloading is best-effort; raw channel IDs shown as fallback
  }
};

/**
 * Resolve a single IBC channel to destination chain name (async).
 * Checks cache first, only fetching if not already cached.
 *
 * @param client - CosmosClient instance
 * @param chain - Source chain info
 * @param channelId - IBC channel ID
 * @returns Chain name or null if resolution fails
 */
export const resolveIbcDestination = async (
  client: CosmosClient,
  chain: ChainInfo,
  channelId: string,
): Promise<string | null> => {
  const cached = getIbcDestinationName(chain.chainId, channelId);
  if (cached) {
    return cached;
  }

  await preloadIbcChannels(client, chain, [channelId]);
  return getIbcDestinationName(chain.chainId, channelId);
};

/**
 * Format an IBC transfer summary with human-readable destination.
 *
 * @param amount - Amount string (e.g., "10 ATOM")
 * @param channelId - IBC channel ID
 * @param chainId - Source chain ID (for cache lookup)
 * @returns Formatted summary string
 */
export const formatIbcTransferSummary = (
  amount: string,
  channelId: string,
  chainId: string,
): string => {
  const destName = getIbcDestinationName(chainId, channelId);

  if (destName) {
    return `IBC transfer ${amount} to ${destName} (via ${channelId})`;
  }

  return `IBC transfer ${amount} via ${channelId}`;
};

/**
 * Clear the IBC channel cache and denom trace cache.
 * Useful for testing or forcing refresh.
 */
export const clearIbcCache = (): void => {
  ibcChannelCache.clear();
  ibcDenomTraceCache.clear();
};

/**
 * Get cache stats for debugging.
 */
export const getIbcCacheStats = (): {
  size: number;
  entries: Array<{
    key: string;
    chainName: string;
    expiresIn: number;
  }>;
} => {
  const now = Date.now();
  const entries: Array<{
    key: string;
    chainName: string;
    expiresIn: number;
  }> = [];

  for (const [key, entry] of ibcChannelCache.entries()) {
    if (entry.expiresAt > now) {
      entries.push({
        key,
        chainName: entry.chainName,
        expiresIn: Math.round((entry.expiresAt - now) / 1000),
      });
    }
  }

  return {
    size: entries.length,
    entries,
  };
};

// ── Tier 2: Dynamic IBC Denom Trace Resolution ────────────────────────

/** Result of querying an IBC denom trace from the chain REST API. */
export interface DenomTrace {
  baseDenom: string;
  path: string;
}

/**
 * Cache entry for resolved IBC denom traces.
 * Uses a discriminated union: successful resolutions have `resolved: true` with metadata,
 * failed (negative) resolutions have `resolved: false`.
 */
type DenomTraceCacheEntry =
  | {
      resolved: true;
      baseDenom: string;
      path: string;
      displayDenom: string;
      decimals: number;
      coinGeckoId?: string;
      expiresAt: number;
      cachedAt: number;
    }
  | {
      resolved: false;
      baseDenom: string;
      path: string;
      expiresAt: number;
      cachedAt: number;
    };

/**
 * Denom trace cache. Key: `${chainId}:${ibcHash}`
 * TTL: 24 hours (denom traces are immutable once created; TTL bounds memory growth)
 */
const ibcDenomTraceCache = new Map<string, DenomTraceCacheEntry>();
const DENOM_TRACE_TTL_MS = 24 * 60 * 60 * 1000;
const DENOM_TRACE_CACHE_MAX_SIZE = 1000;

const SINGLE_HOP_PATTERN = /^transfer\/channel-\d+$/;

/** Input validation: IBC hashes are uppercase hex, 64 chars */
const IBC_HASH_PATTERN = /^[A-F0-9]{64}$/;

/** Input validation: channel IDs follow channel-N format */
const CHANNEL_ID_PATTERN = /^channel-\d+$/;

/** Fetch timeout for REST queries (5 seconds) */
const FETCH_TIMEOUT_MS = 5_000;

/** Helper: store a negative cache entry to prevent repeated failed queries. */
const cacheNegativeResult = (
  cacheKey: string,
  baseDenom: string,
  path: string,
): void => {
  evictIfNeeded();
  ibcDenomTraceCache.set(cacheKey, {
    resolved: false,
    baseDenom,
    path,
    expiresAt: Date.now() + DENOM_TRACE_TTL_MS,
    cachedAt: Date.now(),
  });
};

/**
 * Heuristic fallback: when trace succeeds but chain config or asset list lookup fails,
 * derive decimals from the base denom name instead of returning null.
 * This prevents 18-decimal tokens (INJ, stINJ, stEVMOS, GAMM LP) from being
 * misreported as 6-decimal.
 */
const cacheHeuristicResult = (
  cacheKey: string,
  trace: DenomTrace,
): DenomMetadata => {
  const heuristicDecimals = getTokenDecimals(trace.baseDenom);
  const result: DenomMetadata = {
    displayDenom: trace.baseDenom,
    decimals: heuristicDecimals,
    coinGeckoId: undefined,
  };
  evictIfNeeded();
  ibcDenomTraceCache.set(cacheKey, {
    resolved: true,
    baseDenom: trace.baseDenom,
    path: trace.path,
    displayDenom: trace.baseDenom,
    decimals: heuristicDecimals,
    coinGeckoId: undefined,
    expiresAt: Date.now() + DENOM_TRACE_TTL_MS,
    cachedAt: Date.now(),
  });
  return result;
};

/**
 * Evict entries when cache exceeds max size.
 * Strategy: First evict expired entries, then LRU (oldest cachedAt) if still over limit.
 */
const evictIfNeeded = (): void => {
  if (ibcDenomTraceCache.size < DENOM_TRACE_CACHE_MAX_SIZE) return;

  const now = Date.now();

  // Phase 1: Evict expired entries
  for (const [key, entry] of ibcDenomTraceCache.entries()) {
    if (entry.expiresAt <= now) {
      ibcDenomTraceCache.delete(key);
    }
  }

  // Phase 2: If still over limit, evict oldest entries (LRU by cachedAt)
  if (ibcDenomTraceCache.size >= DENOM_TRACE_CACHE_MAX_SIZE) {
    const entries = Array.from(ibcDenomTraceCache.entries()).sort(
      ([, a], [, b]) => a.cachedAt - b.cachedAt,
    );
    const toEvict = entries.slice(
      0,
      ibcDenomTraceCache.size - DENOM_TRACE_CACHE_MAX_SIZE + 1,
    );
    for (const [key] of toEvict) {
      ibcDenomTraceCache.delete(key);
    }
  }
};

/**
 * Query IBC denom trace from chain REST API.
 *
 * @param restEndpoint - Chain LCD/REST endpoint
 * @param ibcHash - IBC hash (without "ibc/" prefix, must be 64-char uppercase hex)
 * @returns Denom trace or null on failure
 */
export const queryDenomTrace = async (
  restEndpoint: string,
  ibcHash: string,
  headers?: Record<string, string>,
): Promise<DenomTrace | null> => {
  if (!IBC_HASH_PATTERN.test(ibcHash)) {
    // Invalid IBC hash format (expected 64-char uppercase hex)
    return null;
  }

  try {
    const url = `${restEndpoint}/ibc/apps/transfer/v1/denom_traces/${ibcHash}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers,
    });
    if (!response.ok) {
      console.error(
        `${LOG_PREFIX} Denom trace query failed: ${response.status} ${response.statusText} for ${ibcHash.slice(0, 16)}...`,
      );
      return null;
    }

    const data: unknown = await safeParseJson<unknown>(
      response,
      `denom_traces/${ibcHash.slice(0, 16)}`,
    );
    const trace =
      data &&
      typeof data === "object" &&
      "denom_trace" in data &&
      data.denom_trace &&
      typeof data.denom_trace === "object" &&
      "path" in data.denom_trace &&
      "base_denom" in data.denom_trace &&
      typeof data.denom_trace.path === "string" &&
      typeof data.denom_trace.base_denom === "string"
        ? data.denom_trace
        : null;

    if (!trace) {
      // Malformed or empty denom trace response
      return null;
    }

    return {
      baseDenom: trace.base_denom as string,
      path: trace.path as string,
    };
  } catch (error) {
    console.error(
      `${LOG_PREFIX} Denom trace query error for ${ibcHash.slice(0, 16)}...:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
};

/**
 * Query counterparty chain ID for an IBC channel via REST.
 * Assumes the channel is on the 'transfer' port.
 *
 * Performs a 3-step lookup:
 * 1. Channel → connection_hops[0]
 * 2. Connection → client_id
 * 3. Client state → chain_id
 *
 * @param restEndpoint - Chain LCD/REST endpoint
 * @param channelId - IBC channel ID (e.g., "channel-0")
 * @returns Counterparty chain ID or null on failure
 */
export const queryCounterpartyChainId = async (
  restEndpoint: string,
  channelId: string,
  headers?: Record<string, string>,
): Promise<string | null> => {
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    // Invalid channel ID format (expected channel-N)
    return null;
  }

  try {
    // Step 1: channel → connection hops
    const channelUrl = `${restEndpoint}/ibc/core/channel/v1/channels/${channelId}/ports/transfer`;
    const channelResponse = await fetch(channelUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers,
    });
    if (!channelResponse.ok) {
      console.error(
        `${LOG_PREFIX} Channel query failed for ${channelId}: ${channelResponse.status}`,
      );
      return null;
    }

    const channelData: unknown = await safeParseJson<unknown>(
      channelResponse,
      `channels/${channelId}`,
    );
    const connectionHops =
      channelData &&
      typeof channelData === "object" &&
      "channel" in channelData &&
      channelData.channel &&
      typeof channelData.channel === "object" &&
      "connection_hops" in channelData.channel &&
      Array.isArray(channelData.channel.connection_hops)
        ? channelData.channel.connection_hops
        : null;

    const connectionId =
      connectionHops && typeof connectionHops[0] === "string"
        ? connectionHops[0]
        : null;
    if (!connectionId) {
      // No connection hops in channel response
      return null;
    }

    // Step 2: connection → client ID
    const connectionUrl = `${restEndpoint}/ibc/core/connection/v1/connections/${connectionId}`;
    const connectionResponse = await fetch(connectionUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers,
    });
    if (!connectionResponse.ok) {
      console.error(
        `${LOG_PREFIX} Connection query failed for ${connectionId}: ${connectionResponse.status}`,
      );
      return null;
    }

    const connectionData: unknown = await safeParseJson<unknown>(
      connectionResponse,
      `connections/${connectionId}`,
    );
    const clientId =
      connectionData &&
      typeof connectionData === "object" &&
      "connection" in connectionData &&
      connectionData.connection &&
      typeof connectionData.connection === "object" &&
      "client_id" in connectionData.connection &&
      typeof connectionData.connection.client_id === "string"
        ? connectionData.connection.client_id
        : null;
    if (!clientId) {
      // No client ID in connection response
      return null;
    }

    // Step 3: client state → chain ID
    const clientUrl = `${restEndpoint}/ibc/core/client/v1/client_states/${clientId}`;
    const clientResponse = await fetch(clientUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers,
    });
    if (!clientResponse.ok) {
      console.error(
        `${LOG_PREFIX} Client state query failed for ${clientId}: ${clientResponse.status}`,
      );
      return null;
    }

    const clientData: unknown = await safeParseJson<unknown>(
      clientResponse,
      `client_states/${clientId}`,
    );
    const chainId =
      clientData &&
      typeof clientData === "object" &&
      "client_state" in clientData &&
      clientData.client_state &&
      typeof clientData.client_state === "object" &&
      "chain_id" in clientData.client_state &&
      typeof clientData.client_state.chain_id === "string"
        ? clientData.client_state.chain_id
        : null;

    if (!chainId) {
      // No chain_id in client state response; caller handles null
    }

    return chainId;
  } catch (error) {
    console.error(
      `${LOG_PREFIX} Counterparty chain ID query error for ${channelId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
};

/**
 * Resolve an IBC denom to its original token metadata.
 *
 * Flow:
 * 0. Validate ibc/ prefix
 * 1. Check denom trace cache
 * 2. Query denom trace REST API
 * 3. Parse path (single-hop only; multi-hop returns null)
 * 4. Find counterparty chain ID (from channel cache or REST fallback)
 * 5. Look up base denom on counterparty chain config
 *
 * @param chain - Source chain where the IBC denom exists
 * @param ibcDenom - Full IBC denom (e.g., "ibc/27394F...")
 * @returns DenomMetadata or null if resolution fails
 */
export const resolveIbcDenom = async (
  chain: ChainInfo,
  ibcDenom: string,
): Promise<DenomMetadata | null> => {
  if (!ibcDenom.startsWith("ibc/")) {
    return null;
  }

  const ibcHash = ibcDenom.slice(4);
  const cacheKey = `${chain.chainId}:${ibcHash}`;

  const cached = ibcDenomTraceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.resolved) {
      return {
        displayDenom: cached.displayDenom,
        decimals: cached.decimals,
        coinGeckoId: cached.coinGeckoId,
      };
    }
    return null; // Negative cache hit
  }

  // No REST endpoint configured for this chain; denom trace query impossible
  if (!chain.rest) {
    return null;
  }

  const lcdEndpoint = getRpcResolver().resolveLcdEndpoint(
    chain.chainId,
    chain.rest,
  );
  const restEndpoint = lcdEndpoint.url;

  const trace = await queryDenomTrace(
    restEndpoint,
    ibcHash,
    lcdEndpoint.headers,
  );
  if (!trace) {
    cacheNegativeResult(cacheKey, "", "");
    return null;
  }

  // Multi-hop IBC paths (e.g. transfer/channel-0/transfer/channel-1) are not supported;
  // resolving them requires recursive trace queries across intermediate chains.
  if (!SINGLE_HOP_PATTERN.test(trace.path)) {
    cacheNegativeResult(cacheKey, trace.baseDenom, trace.path);
    return null;
  }

  const channelId = trace.path.split("/")[1];

  let counterpartyChainId = getIbcDestinationChainId(chain.chainId, channelId);
  if (!counterpartyChainId) {
    counterpartyChainId = await queryCounterpartyChainId(
      restEndpoint,
      channelId,
      lcdEndpoint.headers,
    );
    if (counterpartyChainId) {
      const channelCacheKey = buildCacheKey(chain.chainId, channelId);
      const chainInfo = findChainByName(counterpartyChainId);
      ibcChannelCache.set(channelCacheKey, {
        chainName: chainInfo?.chainName ?? counterpartyChainId,
        counterpartyChainId,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }
  }

  if (!counterpartyChainId) {
    cacheNegativeResult(cacheKey, trace.baseDenom, trace.path);
    return null;
  }

  const counterpartyChain = getChainConfig(counterpartyChainId);
  if (!counterpartyChain) {
    return cacheHeuristicResult(cacheKey, trace);
  }

  // Base denom may not exist in counterparty chain's asset list (e.g. CW20 tokens, factory denoms);
  // fall back to heuristic on miss
  const resolved = resolveChainDenom(counterpartyChain, trace.baseDenom);
  if (resolved) {
    evictIfNeeded();
    ibcDenomTraceCache.set(cacheKey, {
      resolved: true,
      baseDenom: trace.baseDenom,
      path: trace.path,
      displayDenom: resolved.displayDenom,
      decimals: resolved.decimals,
      coinGeckoId: resolved.coinGeckoId,
      expiresAt: Date.now() + DENOM_TRACE_TTL_MS,
      cachedAt: Date.now(),
    });
    return resolved;
  }

  return cacheHeuristicResult(cacheKey, trace);
};

/**
 * Enrich balance results by resolving unresolved IBC denoms.
 *
 * For each balance where displayDenom starts with "ibc/",
 * attempts to resolve the original token name via denom trace.
 * Recalculates displayAmount using the resolved token's decimals.
 *
 * @param balances - Formatted balance results
 * @param chain - Source chain info
 * @returns Enriched balance results
 */
export const enrichIbcDenoms = async (
  balances: BalanceResult[],
  chain: ChainInfo,
): Promise<BalanceResult[]> => {
  const unresolvedIndices: number[] = [];
  for (let i = 0; i < balances.length; i++) {
    if (balances[i].displayDenom.startsWith("ibc/")) {
      unresolvedIndices.push(i);
    }
  }

  if (unresolvedIndices.length === 0) {
    return balances;
  }

  const results = await Promise.allSettled(
    unresolvedIndices.map((idx) => resolveIbcDenom(chain, balances[idx].denom)),
  );

  const enriched = [...balances];
  for (let i = 0; i < unresolvedIndices.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      const idx = unresolvedIndices[i];
      const metadata = result.value;

      enriched[idx] = {
        ...enriched[idx],
        displayDenom: metadata.displayDenom,
        displayAmount: formatDisplayAmount(
          enriched[idx].amount,
          metadata.decimals,
        ),
      };
    } else if (result.status === "rejected") {
      console.error(
        `${LOG_PREFIX} Unexpected rejection resolving ${balances[unresolvedIndices[i]].denom}:`,
        result.reason,
      );
    }
  }

  return enriched;
};
