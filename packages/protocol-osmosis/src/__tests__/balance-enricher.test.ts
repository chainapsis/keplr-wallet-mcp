import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkipAsset } from "../skip-api.js";
import { _resetCache } from "../skip-assets.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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
    denom: "ibc/JUNO_NETA_IBC_HASH",
    chain_id: "osmosis-1",
    origin_denom: "cw20:juno1...",
    origin_chain_id: "juno-1",
    symbol: "NETA",
    decimals: 6,
    recommended_symbol: "NETA",
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
  mockFetch.mockResolvedValue(mockSkipResponse());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Dynamic import to avoid hoisting issues with mocks
const loadEnricher = async () => {
  const mod = await import("../balance-enricher.js");
  return mod.enrichOsmosisBalances;
};

describe("enrichOsmosisBalances", () => {
  it("should resolve factory denom (allBTC) with 8 decimals", async () => {
    const enrichOsmosisBalances = await loadEnricher();
    const allBtcDenom =
      "factory/osmo1z6r6qdknhgsc0zeracktgpcxf43j6sekq07nw8sxduc9lg0qjjlqfu25e3/alloyed/allBTC";

    const balances = [
      {
        denom: allBtcDenom,
        amount: "100000000", // 1.0 allBTC (8 decimals)
        displayAmount: "100000000", // unresolved: formatBalances defaults to raw
        displayDenom: allBtcDenom, // unresolved: displayDenom === denom
      },
    ];

    const result = await enrichOsmosisBalances(balances, "osmosis-1");

    expect(result[0].displayDenom).toBe("allBTC");
    expect(result[0].displayAmount).toBe("1");
    expect(result[0].denom).toBe(allBtcDenom);
    expect(result[0].amount).toBe("100000000");
  });

  it("should resolve CW20-origin IBC denom (NETA)", async () => {
    const enrichOsmosisBalances = await loadEnricher();

    const balances = [
      {
        denom: "ibc/JUNO_NETA_IBC_HASH",
        amount: "5000000",
        displayAmount: "5000000",
        displayDenom: "ibc/JUNO_NETA_IBC_HASH",
      },
    ];

    const result = await enrichOsmosisBalances(balances, "osmosis-1");

    expect(result[0].displayDenom).toBe("NETA");
    expect(result[0].displayAmount).toBe("5");
  });

  it("should not modify already-resolved tokens (OSMO, ATOM)", async () => {
    const enrichOsmosisBalances = await loadEnricher();

    const balances = [
      {
        denom: "uosmo",
        amount: "1000000",
        displayAmount: "1.000000",
        displayDenom: "OSMO", // already resolved
      },
      {
        denom:
          "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
        amount: "2000000",
        displayAmount: "2.000000",
        displayDenom: "ATOM", // already resolved
      },
    ];

    const result = await enrichOsmosisBalances(balances, "osmosis-1");

    expect(result[0].displayDenom).toBe("OSMO");
    expect(result[0].displayAmount).toBe("1.000000");
    expect(result[1].displayDenom).toBe("ATOM");
    expect(result[1].displayAmount).toBe("2.000000");
  });

  it("should return original balances on Skip API failure", async () => {
    const enrichOsmosisBalances = await loadEnricher();
    mockFetch.mockRejectedValue(new Error("Network error"));
    _resetCache();

    const allBtcDenom =
      "factory/osmo1z6r6qdknhgsc0zeracktgpcxf43j6sekq07nw8sxduc9lg0qjjlqfu25e3/alloyed/allBTC";
    const balances = [
      {
        denom: allBtcDenom,
        amount: "100000000",
        displayAmount: "100000000",
        displayDenom: allBtcDenom,
      },
    ];

    await expect(
      enrichOsmosisBalances(balances, "osmosis-1"),
    ).rejects.toThrow();
  });

  it("should resolve matched tokens and leave unmatched ones unchanged", async () => {
    const enrichOsmosisBalances = await loadEnricher();

    // Skip API returns only allBTC, not the unknown IBC token
    const partialAssets: SkipAsset[] = [SAMPLE_ASSETS[2]]; // only allBTC
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        chain_to_assets_map: {
          "osmosis-1": { assets: partialAssets },
        },
      }),
    });
    _resetCache();

    const unknownIbcDenom = "ibc/UNKNOWN_HASH_NOT_IN_SKIP";
    const allBtcDenom =
      "factory/osmo1z6r6qdknhgsc0zeracktgpcxf43j6sekq07nw8sxduc9lg0qjjlqfu25e3/alloyed/allBTC";

    const balances = [
      {
        denom: allBtcDenom,
        amount: "100000000",
        displayAmount: "100000000",
        displayDenom: allBtcDenom, // unresolved
      },
      {
        denom: unknownIbcDenom,
        amount: "999",
        displayAmount: "999",
        displayDenom: unknownIbcDenom, // unresolved, no match in Skip
      },
    ];

    const result = await enrichOsmosisBalances(balances, "osmosis-1");

    // allBTC resolved
    expect(result[0].displayDenom).toBe("allBTC");
    expect(result[0].displayAmount).toBe("1");

    // Unknown IBC denom stays unchanged
    expect(result[1].displayDenom).toBe(unknownIbcDenom);
    expect(result[1].displayAmount).toBe("999");
  });

  it("should fall back to symbol when recommended_symbol is undefined", async () => {
    const enrichOsmosisBalances = await loadEnricher();

    const assetWithoutRecommended: SkipAsset[] = [
      {
        denom: "gamm/pool/1",
        chain_id: "osmosis-1",
        origin_denom: "gamm/pool/1",
        origin_chain_id: "osmosis-1",
        symbol: "GAMM-1",
        decimals: 18,
        // recommended_symbol intentionally omitted
      },
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        chain_to_assets_map: {
          "osmosis-1": { assets: assetWithoutRecommended },
        },
      }),
    });
    _resetCache();

    const balances = [
      {
        denom: "gamm/pool/1",
        amount: "1000000000000000000",
        displayAmount: "1000000000000000000",
        displayDenom: "gamm/pool/1", // unresolved
      },
    ];

    const result = await enrichOsmosisBalances(balances, "osmosis-1");

    expect(result[0].displayDenom).toBe("GAMM-1"); // fallback to symbol
    expect(result[0].displayAmount).toBe("1");
  });

  it("should skip enrichment when all tokens are already resolved", async () => {
    const enrichOsmosisBalances = await loadEnricher();

    const balances = [
      {
        denom: "uosmo",
        amount: "1000000",
        displayAmount: "1.000000",
        displayDenom: "OSMO",
      },
    ];

    const result = await enrichOsmosisBalances(balances, "osmosis-1");

    // Should return without calling Skip API
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual(balances);
  });
});
