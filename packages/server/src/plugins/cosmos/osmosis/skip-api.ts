/**
 * Skip Routes API client for Osmosis swap routing.
 * Direct HTTP client — no SDK dependency.
 */

import { SKIP_API_KEY, SKIP_API_URL } from "./constants.js";
import { MAX_RETRIES, skipThrottle } from "./skip-throttle.js";

// --- Types ---

export interface SkipRouteRequest {
  source_asset_denom: string;
  source_asset_chain_id: string;
  dest_asset_denom: string;
  dest_asset_chain_id: string;
  amount_in: string;
}

export interface SkipOperation {
  swap?: {
    swap_in: { swap_venue: { name: string }; swap_operations: unknown[] };
    estimated_affiliate_fee?: string;
  };
  transfer?: {
    port: string;
    channel: string;
    from_chain_id: string;
    to_chain_id: string;
    denom_in: string;
    denom_out: string;
  };
}

export interface SkipRouteResponse {
  amount_in: string;
  amount_out: string;
  operations: SkipOperation[];
  chain_ids: string[];
  swap_price_impact_percent?: string;
  estimated_route_duration_seconds?: number;
  does_swap: boolean;
  usd_amount_in?: string;
  usd_amount_out?: string;
}

export interface SkipMsgsDirectRequest extends SkipRouteRequest {
  chain_ids_to_addresses: Record<string, string>;
  slippage_tolerance_percent: string;
}

export interface SkipMsgsDirectResponse {
  msgs: Array<{
    multi_chain_msg: {
      chain_id: string;
      msg: string;
      msg_type_url: string;
    };
  }>;
  route: SkipRouteResponse;
}

export interface SkipAsset {
  denom: string;
  chain_id: string;
  origin_denom: string;
  origin_chain_id: string;
  symbol: string;
  decimals: number;
  recommended_symbol?: string;
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

  await skipThrottle.acquire();

  for (let attempt = 0; ; attempt++) {
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

    // 429 rate limit — re-acquire throttle (respects cooldown) before retry
    if (response.status === 429) {
      skipThrottle.markRateLimited();
      if (attempt >= MAX_RETRIES) {
        throw new Error(
          `Skip API rate limited (429): retry exhausted after ${attempt + 1} attempts`,
        );
      }
      await skipThrottle.acquire();
      continue;
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
  }
};

// --- Route cache ---

const ROUTE_CACHE_TTL_MS = 30_000;
const ROUTE_CACHE_MAX_ENTRIES = 50;

interface RouteCacheEntry {
  data: SkipRouteResponse;
  cachedAt: number;
}

const routeCache = new Map<string, RouteCacheEntry>();
const routePending = new Map<string, Promise<SkipRouteResponse>>();

const getRouteCacheKey = (req: SkipRouteRequest): string =>
  `${req.source_asset_denom}:${req.dest_asset_denom}:${req.amount_in}`;

/** Exposed for testing: reset the route cache. */
export const _resetRouteCache = (): void => {
  routeCache.clear();
  routePending.clear();
};

// --- API functions ---

export const getSkipRoute = async (
  req: SkipRouteRequest,
): Promise<SkipRouteResponse> => {
  const cacheKey = getRouteCacheKey(req);
  const now = Date.now();

  const cached = routeCache.get(cacheKey);
  if (cached && now - cached.cachedAt < ROUTE_CACHE_TTL_MS) {
    return cached.data;
  }

  const inflight = routePending.get(cacheKey);
  if (inflight) return inflight;

  const promise = skipFetch<SkipRouteResponse>("/v2/fungible/route", {
    ...req,
    // Osmosis single-chain flags — no cross-chain bridge risk
    allow_multi_tx: true, // allow split/sequential swaps for complex multi-hop routes
    allow_unsafe: true, // include lower-TVL pools for optimal routing
    allow_swaps: true, // required for same-chain swap discovery
    smart_relay: true,
  })
    .then((result) => {
      if (!result.amount_out || !result.operations) {
        throw new Error(
          "Skip API /route returned unexpected structure: missing amount_out or operations",
        );
      }

      // Evict expired entries, then enforce max size
      for (const [key, entry] of routeCache) {
        if (now - entry.cachedAt >= ROUTE_CACHE_TTL_MS) {
          routeCache.delete(key);
        }
      }
      if (routeCache.size >= ROUTE_CACHE_MAX_ENTRIES) {
        const oldestKey = routeCache.keys().next().value as string;
        routeCache.delete(oldestKey);
      }

      routeCache.set(cacheKey, { data: result, cachedAt: Date.now() });
      return result;
    })
    .finally(() => {
      routePending.delete(cacheKey);
    });

  routePending.set(cacheKey, promise);
  return promise;
};

export const getSkipMsgsDirect = async (
  req: SkipMsgsDirectRequest,
): Promise<SkipMsgsDirectResponse> => {
  const result = await skipFetch<SkipMsgsDirectResponse>(
    "/v2/fungible/msgs_direct",
    {
      ...req,
      allow_multi_tx: true,
      allow_unsafe: true,
      allow_swaps: true,
      smart_relay: true,
    },
  );

  if (!Array.isArray(result.msgs)) {
    throw new Error(
      "Skip API /msgs_direct returned unexpected structure: missing msgs array",
    );
  }
  for (let i = 0; i < result.msgs.length; i++) {
    const m = result.msgs[i].multi_chain_msg;
    if (!m?.msg || !m?.msg_type_url) {
      throw new Error(
        `Skip API /msgs_direct returned malformed message at index ${i}: missing multi_chain_msg.msg or msg_type_url`,
      );
    }
  }
  return result;
};

/**
 * Convert a Skip multi_chain_msg to an EncodeObject compatible with signAndBroadcastMsgs.
 * - Parses the JSON `msg` string
 * - Removes `@type` from the parsed value
 * - Encodes `msg` fields to Uint8Array for CosmWasm MsgExecuteContract compatibility
 * - Returns `{ typeUrl: msg_type_url, value: parsedObject }`
 */
export const skipMsgToEncodeObject = (msg: {
  msg: string;
  msg_type_url: string;
}): { typeUrl: string; value: unknown } => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(msg.msg) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to parse Skip API message (type: ${msg.msg_type_url}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const { "@type": _, ...value } = parsed;

  // CosmWasm MsgExecuteContract: `msg` field must be bytes (Uint8Array)
  if (
    msg.msg_type_url === "/cosmwasm.wasm.v1.MsgExecuteContract" &&
    value.msg
  ) {
    if (
      typeof value.msg === "object" &&
      value.msg !== null &&
      !Array.isArray(value.msg)
    ) {
      value.msg = new TextEncoder().encode(JSON.stringify(value.msg));
    } else if (typeof value.msg === "string") {
      try {
        value.msg = Uint8Array.from(atob(value.msg), (c) => c.charCodeAt(0));
      } catch (err) {
        throw new Error(
          `Failed to decode base64 msg in MsgExecuteContract (type: ${msg.msg_type_url}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      throw new Error(
        `Unexpected msg field type '${typeof value.msg}' in MsgExecuteContract (type: ${msg.msg_type_url})`,
      );
    }
  }

  return {
    typeUrl: msg.msg_type_url,
    value,
  };
};
