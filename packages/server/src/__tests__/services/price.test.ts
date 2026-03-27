import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  DENOM_TO_COINGECKO,
  getPriceService,
  type PriceService,
  resetPriceService,
  resolveCoingeckoId,
} from "../../services/price.js";

/**
 * Helper to create a mock Response with `.text()` support.
 * `safeParseJson` reads the body via `response.text()` then `JSON.parse()`,
 * so mocks must provide `.text()` returning the stringified data.
 */
const mockJsonResponse = (
  data: unknown,
  opts: { ok?: boolean; status?: number; statusText?: string } = {},
) => ({
  ok: opts.ok ?? true,
  status: opts.status ?? 200,
  statusText: opts.statusText ?? "OK",
  text: () => Promise.resolve(JSON.stringify(data)),
  json: () => Promise.resolve(data),
});

describe("PriceService", () => {
  let priceService: PriceService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetPriceService();
    priceService = getPriceService(1000); // 1s TTL for tests
  });

  afterEach(() => {
    resetPriceService();
  });

  describe("getPrice", () => {
    it("should return price for a valid coinGeckoId", async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ cosmos: { usd: 11.5, usd_24h_change: 2.1 } }),
      );

      const result = await priceService.getPrice("cosmos");

      expect(result).toEqual({ usd: 11.5, usd_24h_change: 2.1 });
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toContain("ids=cosmos");
    });

    it("should return null on network error (does not throw)", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await priceService.getPrice("cosmos");

      expect(result).toBeNull();
    });

    it("should return null on 429 rate limit after retries", async () => {
      vi.useFakeTimers();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      const promise = priceService.getPrice("cosmos");
      // Advance through all throttle waits + backoff delays
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(5_000);
      }
      const result = await promise;

      expect(result).toBeNull();
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);

      vi.useRealTimers();
    });

    it("should return null on non-200 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await priceService.getPrice("cosmos");

      expect(result).toBeNull();
    });

    it("should use cache for repeated calls within TTL", async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ cosmos: { usd: 11.5, usd_24h_change: 2.1 } }),
      );

      const result1 = await priceService.getPrice("cosmos");
      const result2 = await priceService.getPrice("cosmos");

      expect(result1).toEqual({ usd: 11.5, usd_24h_change: 2.1 });
      expect(result2).toEqual({ usd: 11.5, usd_24h_change: 2.1 });
      expect(mockFetch).toHaveBeenCalledOnce(); // Only one API call
    });

    it("should refetch after cache expires", async () => {
      // Use a very short TTL
      resetPriceService();
      priceService = getPriceService(50); // 50ms TTL

      mockFetch
        .mockResolvedValueOnce(
          mockJsonResponse({ cosmos: { usd: 11.0, usd_24h_change: 1.0 } }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({ cosmos: { usd: 12.0, usd_24h_change: 2.0 } }),
        );

      const result1 = await priceService.getPrice("cosmos");
      expect(result1).toEqual({ usd: 11.0, usd_24h_change: 1.0 });

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      const result2 = await priceService.getPrice("cosmos");
      expect(result2).toEqual({ usd: 12.0, usd_24h_change: 2.0 });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should return null for unknown token (not in API response)", async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({}), // Empty response
      );

      const result = await priceService.getPrice("unknown-token-xyz");

      expect(result).toBeNull();
    });
  });

  describe("getPrices", () => {
    it("should batch uncached IDs in a single API call", async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          cosmos: { usd: 11.5, usd_24h_change: 2.1 },
          ethereum: { usd: 3000, usd_24h_change: 1.0 },
          osmosis: { usd: 1.2, usd_24h_change: -0.5 },
        }),
      );

      const result = await priceService.getPrices([
        "cosmos",
        "ethereum",
        "osmosis",
      ]);

      expect(result.size).toBe(3);
      expect(result.get("cosmos")).toEqual({
        usd: 11.5,
        usd_24h_change: 2.1,
      });
      expect(result.get("ethereum")).toEqual({
        usd: 3000,
        usd_24h_change: 1.0,
      });
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toContain(
        "ids=cosmos,ethereum,osmosis",
      );
    });

    it("should return mix of cached and freshly fetched", async () => {
      // First call: cache cosmos
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ cosmos: { usd: 11.5, usd_24h_change: 2.1 } }),
      );
      await priceService.getPrice("cosmos");

      // Second call: cosmos cached, ethereum needs fetch
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ ethereum: { usd: 3000, usd_24h_change: 1.0 } }),
      );

      const result = await priceService.getPrices(["cosmos", "ethereum"]);

      expect(result.size).toBe(2);
      expect(result.get("cosmos")).toEqual({
        usd: 11.5,
        usd_24h_change: 2.1,
      });
      expect(result.get("ethereum")).toEqual({
        usd: 3000,
        usd_24h_change: 1.0,
      });
      // Second call should only fetch ethereum
      expect(mockFetch.mock.calls[1][0]).toContain("ids=ethereum");
      expect(mockFetch.mock.calls[1][0]).not.toContain("cosmos");
    });

    it("should return empty map for empty input", async () => {
      const result = await priceService.getPrices([]);

      expect(result.size).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("clearCache", () => {
    it("should force refetch on next call", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockJsonResponse({ cosmos: { usd: 11.0, usd_24h_change: 1.0 } }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({ cosmos: { usd: 12.0, usd_24h_change: 2.0 } }),
        );

      await priceService.getPrice("cosmos");
      priceService.clearCache();
      const result = await priceService.getPrice("cosmos");

      expect(result).toEqual({ usd: 12.0, usd_24h_change: 2.0 });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("retry with exponential backoff", () => {
    it("should retry on 429 and succeed on subsequent attempt", async () => {
      vi.useFakeTimers();

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
        })
        .mockResolvedValueOnce(
          mockJsonResponse({ cosmos: { usd: 11.5, usd_24h_change: 2.1 } }),
        );

      const promise = priceService.getPrice("cosmos");
      // Advance through throttle + backoff
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(3_000);
      }
      const result = await promise;

      expect(result).toEqual({ usd: 11.5, usd_24h_change: 2.1 });
      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("should set rateLimited flag after all retries exhausted", async () => {
      vi.useFakeTimers();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      expect(priceService.isRateLimited()).toBe(false);

      const promise = priceService.getPrice("cosmos");
      // Advance enough for retries (throttle + backoff ~15s total) but not past cooldown (60s)
      for (let i = 0; i < 8; i++) {
        await vi.advanceTimersByTimeAsync(2_500);
      }
      await promise;

      expect(priceService.isRateLimited()).toBe(true);

      vi.useRealTimers();
    });

    it("should not set rateLimited flag when retry succeeds", async () => {
      vi.useFakeTimers();

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
        })
        .mockResolvedValueOnce(
          mockJsonResponse({ cosmos: { usd: 11.5, usd_24h_change: 2.1 } }),
        );

      const promise = priceService.getPrice("cosmos");
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(3_000);
      }
      await promise;

      expect(priceService.isRateLimited()).toBe(false);

      vi.useRealTimers();
    });
  });

  describe("isRateLimited", () => {
    it("should return false initially", () => {
      expect(priceService.isRateLimited()).toBe(false);
    });
  });
});

describe("resolveCoingeckoId", () => {
  it("should map known Cosmos tokens correctly", () => {
    expect(resolveCoingeckoId("ATOM")).toBe("cosmos");
    expect(resolveCoingeckoId("OSMO")).toBe("osmosis");
    expect(resolveCoingeckoId("TIA")).toBe("celestia");
  });

  it("should map known EVM tokens correctly", () => {
    expect(resolveCoingeckoId("ETH")).toBe("ethereum");
    expect(resolveCoingeckoId("POL")).toBe("matic-network");
    expect(resolveCoingeckoId("BNB")).toBe("binancecoin");
  });

  it("should be case-insensitive", () => {
    expect(resolveCoingeckoId("atom")).toBe("cosmos");
    expect(resolveCoingeckoId("Eth")).toBe("ethereum");
  });

  it("should return undefined for unknown tokens", () => {
    expect(resolveCoingeckoId("UNKNOWN")).toBeUndefined();
    expect(resolveCoingeckoId("XYZ")).toBeUndefined();
  });
});

describe("DENOM_TO_COINGECKO", () => {
  it("should include major Cosmos tokens", () => {
    expect(DENOM_TO_COINGECKO.ATOM).toBe("cosmos");
    expect(DENOM_TO_COINGECKO.OSMO).toBe("osmosis");
    expect(DENOM_TO_COINGECKO.INJ).toBe("injective-protocol");
  });

  it("should include major EVM tokens", () => {
    expect(DENOM_TO_COINGECKO.ETH).toBe("ethereum");
    expect(DENOM_TO_COINGECKO.AVAX).toBe("avalanche-2");
  });

  it("should include stablecoins", () => {
    expect(DENOM_TO_COINGECKO.USDC).toBe("usd-coin");
    expect(DENOM_TO_COINGECKO.USDT).toBe("tether");
    expect(DENOM_TO_COINGECKO.DAI).toBe("dai");
  });
});
