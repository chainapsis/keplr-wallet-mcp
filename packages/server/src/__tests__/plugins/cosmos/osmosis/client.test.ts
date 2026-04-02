import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OsmosisClient,
  toDisplayAmount,
  toMinimalDenom,
} from "../../../../plugins/cosmos/osmosis/client.js";

// Mock skip-api and skip-assets
vi.mock("../../../../plugins/cosmos/osmosis/skip-api.js", () => ({
  getSkipRoute: vi.fn(),
  getSkipMsgsDirect: vi.fn(),
  skipMsgToEncodeObject: vi.fn(),
}));

vi.mock("../../../../plugins/cosmos/osmosis/skip-assets.js", () => ({
  resolveOsmosisDenom: vi.fn(),
}));

import {
  getSkipMsgsDirect,
  getSkipRoute,
  skipMsgToEncodeObject,
} from "../../../../plugins/cosmos/osmosis/skip-api.js";
import { resolveOsmosisDenom } from "../../../../plugins/cosmos/osmosis/skip-assets.js";

const mockResolve = vi.mocked(resolveOsmosisDenom);
const mockRoute = vi.mocked(getSkipRoute);
const mockMsgsDirect = vi.mocked(getSkipMsgsDirect);
const mockMsgConvert = vi.mocked(skipMsgToEncodeObject);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toMinimalDenom", () => {
  it("converts integer amount with 6 decimals", () => {
    expect(toMinimalDenom("10", 6)).toBe("10000000");
  });

  it("converts fractional amount with 6 decimals", () => {
    expect(toMinimalDenom("1.5", 6)).toBe("1500000");
  });

  it("converts integer amount with 18 decimals", () => {
    expect(toMinimalDenom("1", 18)).toBe("1000000000000000000");
  });

  it("converts fractional amount with 18 decimals without precision loss", () => {
    expect(toMinimalDenom("1.123456789012345678", 18)).toBe(
      "1123456789012345678",
    );
  });

  it("truncates excess fractional digits", () => {
    expect(toMinimalDenom("1.1234567", 6)).toBe("1123456");
  });

  it("handles 0 decimals", () => {
    expect(toMinimalDenom("42", 0)).toBe("42");
  });

  it("handles amount with no whole part", () => {
    expect(toMinimalDenom("0.001", 6)).toBe("1000");
  });

  it("throws on empty string", () => {
    expect(() => toMinimalDenom("", 6)).toThrow("Invalid amount");
  });

  it("throws on negative amount", () => {
    expect(() => toMinimalDenom("-1", 6)).toThrow("Invalid amount");
  });

  it("throws on non-numeric string", () => {
    expect(() => toMinimalDenom("abc", 6)).toThrow("Invalid amount");
  });

  it("throws on multiple decimal points", () => {
    expect(() => toMinimalDenom("1.2.3", 6)).toThrow("Invalid amount");
  });

  it("throws on negative decimals", () => {
    expect(() => toMinimalDenom("10", -1)).toThrow("Invalid decimals");
  });
});

describe("toDisplayAmount", () => {
  it("converts minimal denom to display with 6 decimals", () => {
    expect(toDisplayAmount("10000000", 6)).toBe("10");
  });

  it("converts with trailing fractional digits", () => {
    expect(toDisplayAmount("900000", 6)).toBe("0.9");
  });

  it("converts 18-decimal amount without precision loss", () => {
    expect(toDisplayAmount("1123456789012345678", 18)).toBe(
      "1.123456789012345678",
    );
  });

  it("handles zero", () => {
    expect(toDisplayAmount("0", 6)).toBe("0");
  });

  it("handles 0 decimals", () => {
    expect(toDisplayAmount("42", 0)).toBe("42");
  });

  it("strips trailing zeros from fractional part", () => {
    expect(toDisplayAmount("1500000", 6)).toBe("1.5");
  });

  it("throws on empty string", () => {
    expect(() => toDisplayAmount("", 6)).toThrow("Invalid minimal amount");
  });

  it("throws on non-integer string", () => {
    expect(() => toDisplayAmount("1.5", 6)).toThrow("Invalid minimal amount");
  });

  it("throws on negative amount", () => {
    expect(() => toDisplayAmount("-100", 6)).toThrow("Invalid minimal amount");
  });

  it("throws on non-numeric string", () => {
    expect(() => toDisplayAmount("abc", 6)).toThrow("Invalid minimal amount");
  });

  it("throws on negative decimals", () => {
    expect(() => toDisplayAmount("1000000", -1)).toThrow("Invalid decimals");
  });
});

describe("OsmosisClient.getQuote", () => {
  const client = new OsmosisClient();

  beforeEach(() => {
    mockResolve
      .mockResolvedValueOnce({ denom: "uosmo", symbol: "OSMO", decimals: 6 })
      .mockResolvedValueOnce({
        denom:
          "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
        symbol: "ATOM",
        decimals: 6,
      });
  });

  it("should return QuoteResult with correct fields", async () => {
    mockRoute.mockResolvedValue({
      amount_in: "10000000",
      amount_out: "900000",
      operations: [
        {
          swap: {
            swap_in: {
              swap_venue: { name: "osmosis-poolmanager" },
              swap_operations: [],
            },
          },
        },
      ],
      chain_ids: ["osmosis-1"],
      swap_price_impact_percent: "0.12",
      does_swap: true,
      usd_amount_in: "10.00",
      usd_amount_out: "9.80",
    });

    const result = await client.getQuote({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    expect(result.chainId).toBe("osmosis-1");
    expect(result.tokenIn.symbol).toBe("OSMO");
    expect(result.tokenIn.amount).toBe("10000000");
    expect(result.tokenIn.displayAmount).toBe("10");
    expect(result.tokenOut.symbol).toBe("ATOM");
    expect(result.tokenOut.amount).toBe("900000");
    expect(result.amountOutMin).toBeDefined();
    expect(result.priceImpact).toBe("0.12%");
    expect(result.priceImpactPercent).toBe(0.12);
    expect(result.route).toContain("OSMO");
    expect(result.route).toContain("ATOM");
    expect(result.usdAmountIn).toBe("10.00");
    expect(result.usdAmountOut).toBe("9.80");
  });

  it("should apply slippage (50 bps = 0.5%)", async () => {
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
    expect(result.slippageBps).toBe(50);
  });

  it("should convert amount with 6 decimals", async () => {
    mockRoute.mockResolvedValue({
      amount_in: "10000000",
      amount_out: "900000",
      operations: [],
      chain_ids: ["osmosis-1"],
      does_swap: true,
    });

    await client.getQuote({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    expect(mockRoute).toHaveBeenCalledWith(
      expect.objectContaining({ amount_in: "10000000" }),
    );
  });

  it("should convert amount with 18 decimals (INJ)", async () => {
    mockResolve.mockReset();
    mockResolve
      .mockResolvedValueOnce({
        denom:
          "ibc/64BA6E31FE887D66C6F8F31C7B1A80C7CA179239677B4088BB55F5EA07DBE273",
        symbol: "INJ",
        decimals: 18,
      })
      .mockResolvedValueOnce({ denom: "uosmo", symbol: "OSMO", decimals: 6 });

    mockRoute.mockResolvedValue({
      amount_in: "1000000000000000000",
      amount_out: "10000000",
      operations: [],
      chain_ids: ["osmosis-1"],
      does_swap: true,
    });

    await client.getQuote({
      tokenIn: "INJ",
      tokenOut: "OSMO",
      amountIn: "1",
    });

    expect(mockRoute).toHaveBeenCalledWith(
      expect.objectContaining({ amount_in: "1000000000000000000" }),
    );
  });

  it("should map priceImpact from route response", async () => {
    mockRoute.mockResolvedValue({
      amount_in: "10000000",
      amount_out: "900000",
      operations: [],
      chain_ids: ["osmosis-1"],
      swap_price_impact_percent: "2.5",
      does_swap: true,
    });

    const result = await client.getQuote({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    expect(result.priceImpact).toBe("2.5%");
    expect(result.priceImpactPercent).toBe(2.5);
  });

  it("should return 'unknown' priceImpact when field is absent", async () => {
    mockRoute.mockResolvedValue({
      amount_in: "10000000",
      amount_out: "900000",
      operations: [],
      chain_ids: ["osmosis-1"],
      does_swap: true,
    });

    const result = await client.getQuote({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    expect(result.priceImpact).toBe("unknown");
    expect(result.priceImpactPercent).toBe(0);
  });

  it("should handle NaN priceImpact gracefully", async () => {
    mockRoute.mockResolvedValue({
      amount_in: "10000000",
      amount_out: "900000",
      operations: [],
      chain_ids: ["osmosis-1"],
      swap_price_impact_percent: "N/A",
      does_swap: true,
    });

    const result = await client.getQuote({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    expect(result.priceImpact).toBe("unknown");
    expect(result.priceImpactPercent).toBe(0);
  });

  it("should build route array with multi-hop info", async () => {
    mockRoute.mockResolvedValue({
      amount_in: "10000000",
      amount_out: "900000",
      operations: [
        {
          swap: {
            swap_in: {
              swap_venue: { name: "osmosis-poolmanager" },
              swap_operations: [],
            },
          },
        },
        {
          swap: {
            swap_in: {
              swap_venue: { name: "osmosis-cl" },
              swap_operations: [],
            },
          },
        },
      ],
      chain_ids: ["osmosis-1"],
      does_swap: true,
    });

    const result = await client.getQuote({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    expect(result.route).toEqual([
      "OSMO",
      "osmosis-poolmanager",
      "osmosis-cl",
      "ATOM",
    ]);
  });
});

describe("OsmosisClient.buildSwapMessages", () => {
  const client = new OsmosisClient();

  beforeEach(() => {
    mockResolve
      .mockResolvedValueOnce({ denom: "uosmo", symbol: "OSMO", decimals: 6 })
      .mockResolvedValueOnce({
        denom:
          "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
        symbol: "ATOM",
        decimals: 6,
      });
  });

  it("should return single msg for single-hop", async () => {
    mockMsgsDirect.mockResolvedValue({
      msgs: [
        {
          multi_chain_msg: {
            chain_id: "osmosis-1",
            msg: '{"@type":"/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn"}',
            msg_type_url: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
          },
        },
      ],
      route: {
        amount_in: "10000000",
        amount_out: "900000",
        operations: [],
        chain_ids: ["osmosis-1"],
        does_swap: true,
      },
    });
    mockMsgConvert.mockReturnValue({
      typeUrl: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
      value: { sender: "osmo1abc" },
    });

    const msgs = await client.buildSwapMessages({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
      sender: "osmo1abc",
    });

    expect(msgs).toHaveLength(1);
    expect(msgs[0].typeUrl).toBe(
      "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
    );
  });

  it("should return multiple msgs for multi-hop", async () => {
    mockMsgsDirect.mockResolvedValue({
      msgs: [
        {
          multi_chain_msg: {
            chain_id: "osmosis-1",
            msg: '{"@type":"/msg1"}',
            msg_type_url: "/msg1",
          },
        },
        {
          multi_chain_msg: {
            chain_id: "osmosis-1",
            msg: '{"@type":"/msg2"}',
            msg_type_url: "/msg2",
          },
        },
      ],
      route: {
        amount_in: "10000000",
        amount_out: "900000",
        operations: [],
        chain_ids: ["osmosis-1"],
        does_swap: true,
      },
    });
    mockMsgConvert
      .mockReturnValueOnce({ typeUrl: "/msg1", value: {} })
      .mockReturnValueOnce({ typeUrl: "/msg2", value: {} });

    const msgs = await client.buildSwapMessages({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
      sender: "osmo1abc",
    });

    expect(msgs).toHaveLength(2);
  });

  it("should produce { typeUrl, value } format for each msg", async () => {
    mockMsgsDirect.mockResolvedValue({
      msgs: [
        {
          multi_chain_msg: {
            chain_id: "osmosis-1",
            msg: '{"@type":"/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn","sender":"osmo1abc"}',
            msg_type_url: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
          },
        },
      ],
      route: {
        amount_in: "10000000",
        amount_out: "900000",
        operations: [],
        chain_ids: ["osmosis-1"],
        does_swap: true,
      },
    });
    mockMsgConvert.mockReturnValue({
      typeUrl: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
      value: { sender: "osmo1abc" },
    });

    const msgs = await client.buildSwapMessages({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
      sender: "osmo1abc",
    });

    expect(msgs[0]).toHaveProperty("typeUrl");
    expect(msgs[0]).toHaveProperty("value");
    expect(msgs[0].value).not.toHaveProperty("@type");
  });

  it("should pass slippage as percent string (50 bps → '0.5')", async () => {
    mockMsgsDirect.mockResolvedValue({
      msgs: [],
      route: {
        amount_in: "10000000",
        amount_out: "900000",
        operations: [],
        chain_ids: ["osmosis-1"],
        does_swap: true,
      },
    });

    await client.buildSwapMessages({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
      sender: "osmo1abc",
      slippageBps: 50,
    });

    expect(mockMsgsDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        slippage_tolerance_percent: "0.5",
      }),
    );
  });
});
