/**
 * CoinGecko price service with in-memory caching.
 * Used by the unified portfolio tool to fetch USD values.
 *
 * Supports both free and pro tiers:
 * - Free tier: longer cache TTL (5min), request throttling (2s interval), retry with backoff
 * - Pro tier: shorter cache TTL (60s), no throttling, minimal retry
 *
 * Set COINGECKO_API_KEY env var to use the pro API with higher rate limits.
 */

import { safeParseJson } from "../utils/lcd-fetch.js";

export interface TokenPrice {
  usd: number;
  usd_24h_change?: number;
}

export interface PriceService {
  /** Get price for a single CoinGecko ID */
  getPrice(coinGeckoId: string): Promise<TokenPrice | null>;
  /** Get prices for multiple CoinGecko IDs at once */
  getPrices(coinGeckoIds: string[]): Promise<Map<string, TokenPrice>>;
  /** Clear the cache */
  clearCache(): void;
  /** Whether the service was recently rate-limited */
  isRateLimited(): boolean;
}

interface CacheEntry {
  price: TokenPrice;
  expiresAt: number;
}

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const COINGECKO_API_BASE = COINGECKO_API_KEY
  ? "https://pro-api.coingecko.com/api/v3"
  : "https://api.coingecko.com/api/v3";

/** Free tier: 5 minutes to minimize API calls. Pro tier: 60 seconds for fresher data. */
const DEFAULT_CACHE_TTL_MS = COINGECKO_API_KEY ? 60_000 : 300_000;

/** Free tier: max 50 IDs per request (URL length safety). Pro tier: 250. */
const BATCH_CHUNK_SIZE = COINGECKO_API_KEY ? 250 : 50;

/** Free tier: 2s between requests to stay under 30 calls/min. Pro tier: no throttle. */
const THROTTLE_INTERVAL_MS = COINGECKO_API_KEY ? 0 : 2_000;

/** Free tier: retry up to 3 times on 429. Pro tier: 1 retry. */
const MAX_RETRIES = COINGECKO_API_KEY ? 1 : 3;

/** Rate limit cooldown period (60 seconds) */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

class PriceServiceImpl implements PriceService {
  private cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private lastRequestTime = 0;
  private rateLimitedUntil = 0;

  constructor(cacheTtlMs?: number) {
    this.cacheTtlMs = cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async getPrice(coinGeckoId: string): Promise<TokenPrice | null> {
    const prices = await this.getPrices([coinGeckoId]);
    return prices.get(coinGeckoId) ?? null;
  }

  async getPrices(coinGeckoIds: string[]): Promise<Map<string, TokenPrice>> {
    const result = new Map<string, TokenPrice>();
    if (coinGeckoIds.length === 0) return result;

    const now = Date.now();
    const uncachedIds: string[] = [];

    // Collect cached entries and identify uncached ones
    for (const id of coinGeckoIds) {
      const cached = this.cache.get(id);
      if (cached && cached.expiresAt > now) {
        result.set(id, cached.price);
      } else {
        uncachedIds.push(id);
      }
    }

    // Fetch uncached IDs in chunks to avoid URL length limits
    if (uncachedIds.length > 0) {
      const chunks = chunkArray(uncachedIds, BATCH_CHUNK_SIZE);
      for (const chunk of chunks) {
        const fetched = await this.fetchWithRetry(chunk);
        for (const [id, price] of fetched) {
          this.cache.set(id, {
            price,
            expiresAt: now + this.cacheTtlMs,
          });
          result.set(id, price);
        }
      }
    }

    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }

  /** Throttle requests for free tier to avoid hitting rate limits */
  private async throttle(): Promise<void> {
    if (THROTTLE_INTERVAL_MS <= 0) return;
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < THROTTLE_INTERVAL_MS) {
      await sleep(THROTTLE_INTERVAL_MS - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  /** Fetch with exponential backoff retry on 429 */
  private async fetchWithRetry(
    ids: string[],
  ): Promise<Map<string, TokenPrice>> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.throttle();
      const result = await this.fetchPrices(ids);

      // fetchPrices returns null on 429 to signal rate limit
      if (result === null) {
        if (attempt < MAX_RETRIES) {
          const backoffMs = Math.min(1_000 * 2 ** attempt, 10_000);
          console.warn(
            `[PriceService] Rate limited, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
          );
          await sleep(backoffMs);
          continue;
        }
        // All retries exhausted
        this.rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        console.warn(
          "[PriceService] Rate limit retries exhausted, entering cooldown",
        );
        return new Map();
      }

      return result;
    }

    return new Map();
  }

  /** Returns null on 429 (to trigger retry), Map on success/other errors */
  private async fetchPrices(
    ids: string[],
  ): Promise<Map<string, TokenPrice> | null> {
    const result = new Map<string, TokenPrice>();

    try {
      const url = `${COINGECKO_API_BASE}/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`;
      const headers: Record<string, string> = {};
      if (COINGECKO_API_KEY) {
        headers["x-cg-pro-api-key"] = COINGECKO_API_KEY;
      }
      const response = await fetch(url, { headers });

      if (response.status === 429) {
        return null; // Signal retry
      }

      if (!response.ok) {
        console.warn(
          `[PriceService] CoinGecko API error: ${response.status} ${response.statusText}`,
        );
        return result;
      }

      const data = await safeParseJson<
        Record<string, { usd?: number; usd_24h_change?: number }>
      >(response, "coingecko/simple/price");

      for (const id of ids) {
        const entry = data[id];
        if (entry?.usd != null) {
          result.set(id, {
            usd: entry.usd,
            usd_24h_change: entry.usd_24h_change,
          });
        }
      }
    } catch (error) {
      console.warn(
        `[PriceService] Failed to fetch prices: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }
}

/** Split an array into chunks of the given size */
const chunkArray = <T>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

/** Map display denom/symbol to CoinGecko ID for well-known tokens */
export const DENOM_TO_COINGECKO: Record<string, string> = {
  // Cosmos tokens
  ATOM: "cosmos",
  OSMO: "osmosis",
  STARS: "stargaze",
  INJ: "injective-protocol",
  // Deprecated chains — tokens still exist on Osmosis and other chains via IBC
  JUNO: "juno-network",
  NTRN: "neutron-3",
  KAVA: "kava",
  KYVE: "kyve-network",
  LAVA: "lava-network",
  NYM: "nym",
  SAGA: "saga-2",
  STRD: "stride",
  ZIG: "zignaly",
  CRO: "crypto-com-chain",
  XRP: "ripple",
  TIA: "celestia",
  DYDX: "dydx-chain",
  SEI: "sei-network",
  AKT: "akash-network",
  REGEN: "regen",
  ARCH: "archway",
  ATONE: "atomone",
  AXL: "axelar",
  BABY: "babylon",
  BLD: "agoric",
  BOOT: "bostrom",
  DYM: "dymension",
  HASH: "hash-2",
  HUAHUA: "chihuahua-token",
  INIT: "initia",
  IRIS: "iris-network",
  JKL: "jackal-protocol",
  LUME: "lumera",
  LUNA: "terra-luna-2",
  LUNC: "terra-luna",
  NLS: "nolus",
  OM: "mantra-dao",
  P2P: "sentinel",
  PASG: "passage",
  PHOTON: "photon-2",
  POKT: "pocket-network",
  QCK: "quicksilver",
  RUNE: "thorchain",
  SCRT: "secret",
  SEDA: "seda-2",
  SOMM: "sommelier",
  UX: "umee",
  XION: "xion-2",
  XPLA: "xpla",
  XPRT: "persistence",
  ZETA: "zetachain",
  // EVM tokens
  ETH: "ethereum",
  MATIC: "matic-network",
  POL: "matic-network",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
  OP: "optimism",
  ARB: "arbitrum",
  BERA: "berachain-bera",
  // Stablecoins
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
};

/** Resolve a display denom or symbol to CoinGecko ID */
export const resolveCoingeckoId = (
  denomOrSymbol: string,
): string | undefined => {
  return DENOM_TO_COINGECKO[denomOrSymbol.toUpperCase()];
};

let instance: PriceService | null = null;

/**
 * Get the singleton PriceService instance.
 * Note: cacheTtlMs is only applied on first call when the instance is created.
 * Subsequent calls return the existing instance regardless of cacheTtlMs.
 * Set COINGECKO_API_KEY env var to use the pro API with higher rate limits.
 */
export const getPriceService = (cacheTtlMs?: number): PriceService => {
  if (!instance) {
    instance = new PriceServiceImpl(cacheTtlMs);
  }
  return instance;
};

/** Reset the singleton (for testing) */
export const resetPriceService = (): void => {
  instance = null;
};
