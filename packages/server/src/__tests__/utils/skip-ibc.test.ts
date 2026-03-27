/**
 * Skip IBC Channel Resolution Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  _resetCache,
  getSkipAssets,
  resolveDestDenom,
  resolveIbcChannelViaSkip,
  type SkipAsset,
  type SkipTransfer,
  skipFetch,
} from "../../utils/skip-ibc.js";

// --- Helpers ---

const mockJsonResponse = (data: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: () => Promise.resolve(data),
  }) as Response;

const makeAsset = (
  overrides: Partial<SkipAsset> & { denom: string },
): SkipAsset => ({
  chain_id: "osmosis-1",
  origin_denom: overrides.denom,
  origin_chain_id: "osmosis-1",
  symbol: "TOKEN",
  decimals: 6,
  ...overrides,
});

const osmosisUsdc = makeAsset({
  denom: "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
  chain_id: "osmosis-1",
  origin_denom: "uusdc",
  origin_chain_id: "noble-1",
  symbol: "USDC",
});

const nobleUsdc = makeAsset({
  denom: "uusdc",
  chain_id: "noble-1",
  origin_denom: "uusdc",
  origin_chain_id: "noble-1",
  symbol: "USDC",
});

const hubAtom = makeAsset({
  denom: "uatom",
  chain_id: "cosmoshub-4",
  origin_denom: "uatom",
  origin_chain_id: "cosmoshub-4",
  symbol: "ATOM",
});

const osmosisAtom = makeAsset({
  denom: "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
  chain_id: "osmosis-1",
  origin_denom: "uatom",
  origin_chain_id: "cosmoshub-4",
  symbol: "ATOM",
});

const hubUsdc = makeAsset({
  denom: "ibc/F663521BF1836B00F5F177680F74BFB9A8B5654A694D0D2BC249E03CF2509013",
  chain_id: "cosmoshub-4",
  origin_denom: "uusdc",
  origin_chain_id: "noble-1",
  symbol: "USDC",
});

const mockAssetsResponse = (chainId: string, assets: SkipAsset[]) => ({
  chain_to_assets_map: { [chainId]: { assets } },
});

interface MockRouteResponse {
  amount_in: string;
  amount_out: string;
  operations: Array<{ swap?: unknown; transfer?: SkipTransfer }>;
  chain_ids: string[];
  does_swap: boolean;
}

const mockRouteResponse = (transfer: {
  port: string;
  channel: string;
  from_chain_id: string;
  to_chain_id: string;
}): MockRouteResponse => ({
  amount_in: "1",
  amount_out: "1",
  operations: [
    {
      transfer: {
        ...transfer,
        denom_in: "denom_in",
        denom_out: "denom_out",
        bridge_id: "IBC",
      },
    },
  ],
  chain_ids: [transfer.from_chain_id, transfer.to_chain_id],
  does_swap: false,
});

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  _resetCache();
});

afterEach(() => {
  _resetCache();
});

describe("skipFetch", () => {
  it("makes GET request when no body provided", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ data: "test" }));

    const result = await skipFetch("/v2/test");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.skip.build/v2/test",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual({ data: "test" });
  });

  it("makes POST request when body provided", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ data: "test" }));

    await skipFetch("/v2/test", { key: "value" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.skip.build/v2/test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ key: "value" }),
      }),
    );
  });

  it("throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    await expect(skipFetch("/v2/test")).rejects.toThrow(
      "Skip API unreachable: Network failure",
    );
  });

  it("throws on non-ok response with error message", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ message: "rate limited" }, false, 429),
    );

    await expect(skipFetch("/v2/test")).rejects.toThrow(
      "Skip API error (429): rate limited",
    );
  });
});

describe("getSkipAssets", () => {
  it("fetches and caches assets for a chain", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(
        mockAssetsResponse("osmosis-1", [osmosisUsdc, osmosisAtom]),
      ),
    );

    const first = await getSkipAssets("osmosis-1");
    const second = await getSkipAssets("osmosis-1");

    expect(first).toHaveLength(2);
    expect(second).toBe(first); // same reference = cache hit
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(mockAssetsResponse("noble-1", [nobleUsdc])),
    );

    const [a, b] = await Promise.all([
      getSkipAssets("noble-1"),
      getSkipAssets("noble-1"),
    ]);

    expect(a).toEqual(b);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws when Skip returns no assets", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(mockAssetsResponse("unknown-1", [])),
    );

    await expect(getSkipAssets("unknown-1")).rejects.toThrow(
      "Skip API returned no assets for chain unknown-1",
    );
  });

  it("refetches after cache TTL expires", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(mockAssetsResponse("osmosis-1", [osmosisUsdc])),
    );

    await getSkipAssets("osmosis-1");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance time past TTL
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);

    await getSkipAssets("osmosis-1");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

describe("resolveDestDenom", () => {
  it("Case A: IBC token returning to origin chain", async () => {
    // USDC on Osmosis → Noble (origin)
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(mockAssetsResponse("osmosis-1", [osmosisUsdc])),
    );

    const result = await resolveDestDenom(
      "osmosis-1",
      osmosisUsdc.denom,
      "noble-1",
    );

    expect(result).toBe("uusdc");
  });

  it("Case B: native token to another chain", async () => {
    // ATOM on Hub → Osmosis
    mockFetch
      .mockResolvedValueOnce(
        mockJsonResponse(mockAssetsResponse("cosmoshub-4", [hubAtom])),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(
          mockAssetsResponse("osmosis-1", [osmosisUsdc, osmosisAtom]),
        ),
      );

    const result = await resolveDestDenom("cosmoshub-4", "uatom", "osmosis-1");

    expect(result).toBe(osmosisAtom.denom);
  });

  it("Case C: IBC token to non-origin chain", async () => {
    // USDC on Osmosis → Cosmos Hub (not origin Noble)
    mockFetch
      .mockResolvedValueOnce(
        mockJsonResponse(mockAssetsResponse("osmosis-1", [osmosisUsdc])),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(mockAssetsResponse("cosmoshub-4", [hubAtom, hubUsdc])),
      );

    const result = await resolveDestDenom(
      "osmosis-1",
      osmosisUsdc.denom,
      "cosmoshub-4",
    );

    expect(result).toBe(hubUsdc.denom);
  });

  it("throws when source denom not found in Skip assets", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(mockAssetsResponse("osmosis-1", [osmosisUsdc])),
    );

    await expect(
      resolveDestDenom("osmosis-1", "unknown_denom", "noble-1"),
    ).rejects.toThrow("Token 'unknown_denom' not found on osmosis-1");
  });

  it("throws when dest denom not found", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockJsonResponse(mockAssetsResponse("cosmoshub-4", [hubAtom])),
      )
      .mockResolvedValueOnce(
        // dest chain has no matching asset
        mockJsonResponse(mockAssetsResponse("unknown-1", [])),
      );

    await expect(
      resolveDestDenom("cosmoshub-4", "uatom", "unknown-1"),
    ).rejects.toThrow("Skip API returned no assets for chain unknown-1");
  });
});

describe("resolveIbcChannelViaSkip", () => {
  const setupMocks = (
    sourceAssets: SkipAsset[],
    destAssets: SkipAsset[] | null,
    routeOverrides?: Partial<MockRouteResponse>,
  ) => {
    // getSkipAssets for source chain
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(
        mockAssetsResponse(sourceAssets[0]?.chain_id ?? "chain", sourceAssets),
      ),
    );
    // getSkipAssets for dest chain (if needed, i.e., not returning to origin)
    if (destAssets) {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse(
          mockAssetsResponse(destAssets[0]?.chain_id ?? "chain", destAssets),
        ),
      );
    }
    // Route API
    const route = {
      ...mockRouteResponse({
        port: "transfer",
        channel: "channel-750",
        from_chain_id: "osmosis-1",
        to_chain_id: "noble-1",
      }),
      ...routeOverrides,
    };
    mockFetch.mockResolvedValueOnce(mockJsonResponse(route));
  };

  it("resolves IBC channel for Osmosis → Noble USDC transfer", async () => {
    // Case A: origin return — only source assets needed, no dest fetch
    setupMocks([osmosisUsdc], null);

    const result = await resolveIbcChannelViaSkip(
      "osmosis-1",
      osmosisUsdc.denom,
      "noble-1",
    );

    expect(result).toEqual({
      sourceChannel: "channel-750",
      port: "transfer",
    });
  });

  it("resolves IBC channel for Hub → Osmosis ATOM transfer", async () => {
    // Case B: native to another chain
    mockFetch
      .mockResolvedValueOnce(
        mockJsonResponse(mockAssetsResponse("cosmoshub-4", [hubAtom])),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(mockAssetsResponse("osmosis-1", [osmosisAtom])),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(
          mockRouteResponse({
            port: "transfer",
            channel: "channel-141",
            from_chain_id: "cosmoshub-4",
            to_chain_id: "osmosis-1",
          }),
        ),
      );

    const result = await resolveIbcChannelViaSkip(
      "cosmoshub-4",
      "uatom",
      "osmosis-1",
    );

    expect(result).toEqual({
      sourceChannel: "channel-141",
      port: "transfer",
    });
  });

  it("throws when route requires a swap", async () => {
    setupMocks([osmosisUsdc], null, { does_swap: true });

    await expect(
      resolveIbcChannelViaSkip("osmosis-1", osmosisUsdc.denom, "noble-1"),
    ).rejects.toThrow("swap required");
  });

  it("throws when route has multiple operations (multi-hop)", async () => {
    setupMocks([osmosisUsdc], null, {
      operations: [
        {
          transfer: {
            port: "transfer",
            channel: "channel-1",
            from_chain_id: "osmosis-1",
            to_chain_id: "noble-1",
            denom_in: "d1",
            denom_out: "d2",
          },
        },
        {
          transfer: {
            port: "transfer",
            channel: "channel-2",
            from_chain_id: "noble-1",
            to_chain_id: "cosmoshub-4",
            denom_in: "d2",
            denom_out: "d3",
          },
        },
      ],
    });

    await expect(
      resolveIbcChannelViaSkip("osmosis-1", osmosisUsdc.denom, "noble-1"),
    ).rejects.toThrow("Multi-hop");
  });

  it("throws when route returns empty operations", async () => {
    setupMocks([osmosisUsdc], null, { operations: [] });

    await expect(
      resolveIbcChannelViaSkip("osmosis-1", osmosisUsdc.denom, "noble-1"),
    ).rejects.toThrow("empty operations");
  });

  it("throws when operation is a swap, not a transfer", async () => {
    setupMocks([osmosisUsdc], null, {
      operations: [{ swap: { some: "data" } }],
    });

    await expect(
      resolveIbcChannelViaSkip("osmosis-1", osmosisUsdc.denom, "noble-1"),
    ).rejects.toThrow("non-transfer operation");
  });

  it("propagates Skip API fetch errors", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    await expect(
      resolveIbcChannelViaSkip("osmosis-1", osmosisUsdc.denom, "noble-1"),
    ).rejects.toThrow("Skip API unreachable");
  });
});
