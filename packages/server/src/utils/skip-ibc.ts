/**
 * Skip API client for IBC channel resolution.
 *
 * Uses Skip Route API to resolve the optimal IBC channel for a transfer,
 * replacing the slow N+1 LCD query approach.
 */

// --- Configuration ---

const SKIP_API_URL = process.env.SKIP_API_URL ?? "https://api.skip.build";
const SKIP_API_KEY = process.env.SKIP_API_KEY;

// --- Types ---

export interface SkipAsset {
  denom: string;
  chain_id: string;
  origin_denom: string;
  origin_chain_id: string;
  symbol: string;
  decimals: number;
  recommended_symbol?: string;
}

interface SkipAssetsResponse {
  chain_to_assets_map: Record<string, { assets: SkipAsset[] }>;
}

export interface SkipTransfer {
  port: string;
  channel: string;
  from_chain_id: string;
  to_chain_id: string;
  denom_in: string;
  denom_out: string;
  bridge_id?: string;
}

interface SkipOperation {
  swap?: unknown;
  transfer?: SkipTransfer;
}

interface SkipRouteResponse {
  amount_in: string;
  amount_out: string;
  operations: SkipOperation[];
  chain_ids: string[];
  does_swap: boolean;
  estimated_route_duration_seconds?: number;
}

export interface SkipIbcRouteResult {
  sourceChannel: string;
  port: string;
}

// --- HTTP client ---

export const skipFetch = async <T>(
  path: string,
  body?: unknown,
): Promise<T> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (SKIP_API_KEY) {
    headers.authorization = SKIP_API_KEY;
  }

  let response: Response;
  try {
    response = await fetch(`${SKIP_API_URL}${path}`, {
      method: body ? "POST" : "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Skip API unreachable: ${reason}`, { cause: err });
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errBody = (await response.json()) as { message?: string };
      if (errBody.message) detail = errBody.message;
    } catch {
      // use statusText
    }
    throw new Error(`Skip API error (${response.status}): ${detail}`);
  }

  return (await response.json()) as T;
};

// --- Assets cache ---

const CACHE_TTL_MS = 5 * 60 * 1000;

interface AssetsCacheEntry {
  assets: SkipAsset[];
  cachedAt: number;
}

const assetsCache = new Map<string, AssetsCacheEntry>();
const pendingRequests = new Map<string, Promise<SkipAsset[]>>();

/** Exposed for testing: reset the internal asset cache. */
export const _resetCache = (): void => {
  assetsCache.clear();
  pendingRequests.clear();
};

/** Fetch assets for a chain from Skip API with 5-minute TTL cache. */
export const getSkipAssets = async (chainId: string): Promise<SkipAsset[]> => {
  const now = Date.now();
  const cached = assetsCache.get(chainId);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.assets;
  }

  const existing = pendingRequests.get(chainId);
  if (existing) return existing;

  const request = skipFetch<SkipAssetsResponse>(
    `/v2/fungible/assets?chain_id=${chainId}`,
  )
    .then((data) => {
      const entry = data.chain_to_assets_map[chainId];
      const assets = entry?.assets ?? [];
      if (assets.length === 0) {
        throw new Error(`Skip API returned no assets for chain ${chainId}`);
      }
      assetsCache.set(chainId, { assets, cachedAt: Date.now() });
      return assets;
    })
    .finally(() => {
      pendingRequests.delete(chainId);
    });

  pendingRequests.set(chainId, request);
  return request;
};

// --- Dest denom resolution ---

/**
 * Resolve the destination asset denom for an IBC transfer.
 *
 * Algorithm:
 * 1. Find source asset in source chain's Skip assets → get origin_denom, origin_chain_id
 * 2. If destChainId === origin_chain_id → return origin_denom (token going home)
 * 3. Otherwise, search dest chain's assets for matching origin_denom + origin_chain_id
 */
export const resolveDestDenom = async (
  sourceChainId: string,
  sourceDenom: string,
  destChainId: string,
): Promise<string> => {
  const sourceAssets = await getSkipAssets(sourceChainId);
  const sourceAsset = sourceAssets.find((a) => a.denom === sourceDenom);
  if (!sourceAsset) {
    throw new Error(
      `Token '${sourceDenom}' not found on ${sourceChainId}. Provide sourceChannel explicitly.`,
    );
  }

  const { origin_denom, origin_chain_id } = sourceAsset;

  // Case A: IBC token returning to its origin chain
  if (destChainId === origin_chain_id) {
    return origin_denom;
  }

  // Cases B & C: find the corresponding denom on the dest chain
  const destAssets = await getSkipAssets(destChainId);
  const destAsset = destAssets.find(
    (a) =>
      a.origin_denom === origin_denom && a.origin_chain_id === origin_chain_id,
  );
  if (!destAsset) {
    throw new Error(
      `No IBC path found for '${sourceAsset.symbol}' (${origin_denom}) to ${destChainId}. Provide sourceChannel explicitly.`,
    );
  }

  return destAsset.denom;
};

// --- Channel resolution ---

/**
 * Resolve the IBC source channel for a transfer using Skip Route API.
 *
 * @throws if Skip API fails, no direct transfer route exists, or route requires a swap/multi-hop
 */
export const resolveIbcChannelViaSkip = async (
  sourceChainId: string,
  sourceDenom: string,
  destChainId: string,
): Promise<SkipIbcRouteResult> => {
  const destDenom = await resolveDestDenom(
    sourceChainId,
    sourceDenom,
    destChainId,
  );

  const route = await skipFetch<SkipRouteResponse>("/v2/fungible/route", {
    source_asset_denom: sourceDenom,
    source_asset_chain_id: sourceChainId,
    dest_asset_denom: destDenom,
    dest_asset_chain_id: destChainId,
    amount_in: "1",
    allow_multi_tx: false,
    bridges: ["IBC"],
    smart_relay: true,
  });

  if (route.does_swap) {
    throw new Error(
      "No direct IBC transfer route found (swap required). Provide sourceChannel explicitly.",
    );
  }

  if (!route.operations || route.operations.length === 0) {
    throw new Error(
      "Skip API returned empty operations. Provide sourceChannel explicitly.",
    );
  }

  if (route.operations.length > 1) {
    throw new Error(
      "Multi-hop IBC route detected. Provide sourceChannel explicitly.",
    );
  }

  const transfer = route.operations[0].transfer;
  if (!transfer) {
    throw new Error(
      "Skip API returned non-transfer operation. Provide sourceChannel explicitly.",
    );
  }

  return {
    sourceChannel: transfer.channel,
    port: transfer.port,
  };
};
