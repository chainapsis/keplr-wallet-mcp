import { beforeEach, describe, expect, it, vi } from "vitest";
import { OsmosisClient } from "../../../../plugins/cosmos/osmosis/client.js";

// Mock skip-api and skip-assets (same as client.test.ts)
vi.mock("../../../../plugins/cosmos/osmosis/skip-api.js", () => ({
  getSkipRoute: vi.fn(),
  getSkipMsgsDirect: vi.fn(),
  skipMsgToEncodeObject: vi.fn(),
}));

vi.mock("../../../../plugins/cosmos/osmosis/skip-assets.js", () => ({
  resolveOsmosisDenom: vi.fn(),
}));

import { getSkipRoute } from "../../../../plugins/cosmos/osmosis/skip-api.js";
import { resolveOsmosisDenom } from "../../../../plugins/cosmos/osmosis/skip-assets.js";

const mockResolve = vi.mocked(resolveOsmosisDenom);
const mockRoute = vi.mocked(getSkipRoute);

describe("minAmountOut runtime validation (via OsmosisClient.getQuote)", () => {
  const client = new OsmosisClient();

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve
      .mockResolvedValueOnce({ denom: "uosmo", symbol: "OSMO", decimals: 6 })
      .mockResolvedValueOnce({
        denom:
          "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
        symbol: "ATOM",
        decimals: 6,
      });
  });

  it("should throw when output amount is zero", async () => {
    mockRoute.mockResolvedValue({
      amount_in: "10000000",
      amount_out: "0",
      operations: [],
      chain_ids: ["osmosis-1"],
      does_swap: true,
    });

    await expect(
      client.getQuote({
        tokenIn: "OSMO",
        tokenOut: "ATOM",
        amountIn: "10",
        slippageBps: 50,
      }),
    ).rejects.toThrow("Invalid swap: minimum output is 0");
  });

  it("should throw when slippage makes minimum output zero", async () => {
    mockRoute.mockResolvedValue({
      amount_in: "10000000",
      amount_out: "1",
      operations: [],
      chain_ids: ["osmosis-1"],
      does_swap: true,
    });

    await expect(
      client.getQuote({
        tokenIn: "OSMO",
        tokenOut: "ATOM",
        amountIn: "10",
        slippageBps: 500, // 5% of 1 = 0 after integer division
      }),
    ).rejects.toThrow("Invalid swap: minimum output is 0");
  });

  it("should pass with normal slippage and sufficient output", async () => {
    mockRoute.mockResolvedValue({
      amount_in: "10000000",
      amount_out: "1000000",
      operations: [],
      chain_ids: ["osmosis-1"],
      does_swap: true,
    });

    const result = await client.getQuote({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
      slippageBps: 50,
    });

    // 1000000 * (10000 - 50) / 10000 = 995000
    expect(result.amountOutMin).toBe("995000");
  });
});
