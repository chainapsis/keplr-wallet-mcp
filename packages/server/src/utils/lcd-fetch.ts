/**
 * Shared LCD (REST) fetch wrapper with resolver headers and rate-limit throttle.
 *
 * Used by the CosmosClient to centralize resolver + throttle logic.
 */

import type { ChainInfo } from "@keplr-wallet/types";
import { getRpcResolver } from "../rpc/resolver.js";
import { rpcThrottle } from "./rpc-throttle.js";

export class LcdParseError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly bodySnippet: string,
    cause?: unknown,
  ) {
    super(
      `Non-JSON response from LCD (${path}, status ${status}): ${bodySnippet}`,
      { cause },
    );
    this.name = "LcdParseError";
  }
}

export const lcdFetch = async (
  chain: ChainInfo,
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const resolved = getRpcResolver().resolveLcdEndpoint(
    chain.chainId,
    chain.rest,
  );
  const headers = resolved.headers
    ? { ...resolved.headers, ...init?.headers }
    : init?.headers;

  let host: string | undefined;
  try {
    host = new URL(resolved.url).host;
  } catch {
    // Malformed URL — skip throttle, let fetch handle the error
  }

  if (host) {
    await rpcThrottle.acquire(host);
  }

  const url = `${resolved.url}${path}`;
  const response = await fetch(url, { ...init, headers });

  // On 429, mark rate-limited and retry once after cooldown
  if (host && response.status === 429) {
    rpcThrottle.markRateLimited(host);
    await rpcThrottle.acquire(host);
    try {
      const retryResponse = await fetch(url, { ...init, headers });
      if (retryResponse.status === 429) {
        rpcThrottle.markRateLimited(host);
      }
      return retryResponse;
    } catch {
      return response;
    }
  }

  return response;
};

/**
 * Safely parse a Response body as JSON. Throws LcdParseError on parse failure
 * instead of the generic SyntaxError from response.json().
 */
export const safeParseJson = async <T>(
  response: Response,
  context: string,
): Promise<T> => {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new LcdParseError(
      context,
      response.status,
      text.slice(0, 200),
      cause,
    );
  }
};
