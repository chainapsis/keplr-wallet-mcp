import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkipAsset } from "../../../../plugins/cosmos/osmosis/skip-api.js";
import {
  _resetCache,
  getSkipOsmosisAssets,
  isStructuralDenom,
  resolveOsmosisDenom,
} from "../../../../plugins/cosmos/osmosis/skip-assets.js";
import { skipThrottle } from "../../../../plugins/cosmos/osmosis/skip-throttle.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Sample assets matching real Skip API structure
const SAMPLE_ASSETS: SkipAsset[] = [
  {
    denom: "uosmo",
    chain_id: "osmosis-1",
    origin_denom: "uosmo",
    origin_chain_id: "osmosis-1",
    symbol: "OSMO",
    decimals: 6,
    recommended_symbol: "OSMO",
  },
  {
    denom:
      "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
    chain_id: "osmosis-1",
    origin_denom: "uatom",
    origin_chain_id: "cosmoshub-4",
    symbol: "ATOM",
    decimals: 6,
    recommended_symbol: "ATOM",
  },
  {
    denom:
      "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
    chain_id: "osmosis-1",
    origin_denom: "uusdc",
    origin_chain_id: "noble-1",
    symbol: "USDC",
    decimals: 6,
    recommended_symbol: "USDC",
  },
  {
    denom: "factory/osmo1f5vfcph2dvfeqcqkherf2l23aw7nkuv7daecgu5/umilkTIA",
    chain_id: "osmosis-1",
    origin_denom:
      "factory/osmo1f5vfcph2dvfeqcqkherf2l23aw7nkuv7daecgu5/umilkTIA",
    origin_chain_id: "osmosis-1",
    symbol: "milkTIA",
    decimals: 6,
    recommended_symbol: "milkTIA",
  },
  {
    denom:
      "factory/osmo1z6r6qdknhgsc0zeracktgpcxf43j6sekq07nw8sxduc9lg0qjjlqfu25e3/alloyed/allBTC",
    chain_id: "osmosis-1",
    origin_denom:
      "factory/osmo1z6r6qdknhgsc0zeracktgpcxf43j6sekq07nw8sxduc9lg0qjjlqfu25e3/alloyed/allBTC",
    origin_chain_id: "osmosis-1",
    symbol: "BTC",
    decimals: 8,
    recommended_symbol: "allBTC",
  },
  {
    denom: "gamm/pool/1",
    chain_id: "osmosis-1",
    origin_denom: "gamm/pool/1",
    origin_chain_id: "osmosis-1",
    symbol: "GAMM-1",
    decimals: 18,
  },
  {
    denom: "cl/pool/1",
    chain_id: "osmosis-1",
    origin_denom: "cl/pool/1",
    origin_chain_id: "osmosis-1",
    symbol: "CL-1",
    decimals: 18,
  },
];

const mockSkipResponse = () => ({
  ok: true,
  json: async () => ({
    chain_to_assets_map: {
      "osmosis-1": { assets: SAMPLE_ASSETS },
    },
  }),
});

beforeEach(() => {
  mockFetch.mockReset();
  _resetCache();
  skipThrottle._reset();
  mockFetch.mockResolvedValue(mockSkipResponse());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isStructuralDenom", () => {
  it("should detect IBC denom", () => {
    expect(isStructuralDenom("ibc/27394F...")).toBe(true);
  });

  it("should detect factory denom", () => {
    expect(isStructuralDenom("factory/osmo1.../umilkTIA")).toBe(true);
  });

  it("should detect gamm LP denom", () => {
    expect(isStructuralDenom("gamm/pool/1")).toBe(true);
  });

  it("should detect cl LP denom", () => {
    expect(isStructuralDenom("cl/pool/1")).toBe(true);
  });

  it("should detect unknown structural denom", () => {
    expect(isStructuralDenom("some/unknown/denom")).toBe(true);
  });

  it("should not detect native denom", () => {
    expect(isStructuralDenom("uosmo")).toBe(false);
  });

  it("should not detect symbol", () => {
    expect(isStructuralDenom("OSMO")).toBe(false);
  });
});

describe("resolveOsmosisDenom", () => {
  it("should resolve IBC denom (ATOM)", async () => {
    const result = await resolveOsmosisDenom(
      "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
    );
    expect(result).toEqual({
      denom:
        "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
      symbol: "ATOM",
      decimals: 6,
    });
  });

  it("should resolve factory denom (milkTIA)", async () => {
    const result = await resolveOsmosisDenom(
      "factory/osmo1f5vfcph2dvfeqcqkherf2l23aw7nkuv7daecgu5/umilkTIA",
    );
    expect(result).toEqual({
      denom: "factory/osmo1f5vfcph2dvfeqcqkherf2l23aw7nkuv7daecgu5/umilkTIA",
      symbol: "milkTIA",
      decimals: 6,
    });
  });

  it("should resolve gamm LP denom", async () => {
    const result = await resolveOsmosisDenom("gamm/pool/1");
    expect(result).toEqual({
      denom: "gamm/pool/1",
      symbol: "GAMM-1",
      decimals: 18,
    });
  });

  it("should resolve cl LP denom", async () => {
    const result = await resolveOsmosisDenom("cl/pool/1");
    expect(result).toEqual({
      denom: "cl/pool/1",
      symbol: "CL-1",
      decimals: 18,
    });
  });

  it("should passthrough unknown structural denom with fallback", async () => {
    const result = await resolveOsmosisDenom("some/unknown/denom");
    expect(result.denom).toBe("some/unknown/denom");
    expect(result.decimals).toBe(6); // getTokenDecimals default
    expect(result.symbol).toBe("some/unkno...");
  });

  it("should resolve native exact match (uosmo)", async () => {
    const result = await resolveOsmosisDenom("uosmo");
    expect(result).toEqual({
      denom: "uosmo",
      symbol: "OSMO",
      decimals: 6,
    });
  });

  it('should resolve symbol "OSMO"', async () => {
    const result = await resolveOsmosisDenom("OSMO");
    expect(result).toEqual({
      denom: "uosmo",
      symbol: "OSMO",
      decimals: 6,
    });
  });

  it('should resolve symbol "osmo" (lowercase)', async () => {
    const result = await resolveOsmosisDenom("osmo");
    expect(result).toEqual({
      denom: "uosmo",
      symbol: "OSMO",
      decimals: 6,
    });
  });

  it('should resolve symbol "milkTIA" to factory denom', async () => {
    const result = await resolveOsmosisDenom("milkTIA");
    expect(result.denom).toBe(
      "factory/osmo1f5vfcph2dvfeqcqkherf2l23aw7nkuv7daecgu5/umilkTIA",
    );
    expect(result.symbol).toBe("milkTIA");
    expect(result.decimals).toBe(6);
  });

  it('should resolve recommended_symbol "allBTC"', async () => {
    const result = await resolveOsmosisDenom("allBTC");
    expect(result.denom).toContain("factory/");
    expect(result.symbol).toBe("allBTC");
    expect(result.decimals).toBe(8);
  });

  it('should resolve "usdc" as symbol (not raw denom passthrough)', async () => {
    const result = await resolveOsmosisDenom("usdc");
    expect(result.denom).toContain("ibc/");
    expect(result.symbol).toBe("USDC");
    expect(result.decimals).toBe(6);
  });

  it("should throw for non-existent token", async () => {
    await expect(resolveOsmosisDenom("NONEXISTENT")).rejects.toThrow(
      "Token 'NONEXISTENT' not found on Osmosis",
    );
  });
});

describe("getSkipOsmosisAssets caching", () => {
  it("should not re-fetch within TTL", async () => {
    await getSkipOsmosisAssets();
    await getSkipOsmosisAssets();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should throw when Skip API returns empty asset list", async () => {
    _resetCache();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        chain_to_assets_map: { "osmosis-1": { assets: [] } },
      }),
    });

    await expect(getSkipOsmosisAssets()).rejects.toThrow(
      "Skip API returned no assets for chain",
    );
  });

  it("should dedup concurrent inflight requests (single fetch)", async () => {
    _resetCache();

    let resolveResponse!: (value: unknown) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
    );

    const p1 = getSkipOsmosisAssets();
    const p2 = getSkipOsmosisAssets();

    resolveResponse(mockSkipResponse());

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
  });

  it("should re-fetch after TTL expires", async () => {
    vi.useFakeTimers();
    try {
      await getSkipOsmosisAssets();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance past 5-minute TTL
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      mockFetch.mockResolvedValue(mockSkipResponse());

      await getSkipOsmosisAssets();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
