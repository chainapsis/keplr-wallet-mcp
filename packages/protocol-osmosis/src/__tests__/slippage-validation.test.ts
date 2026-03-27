import { beforeEach, describe, expect, it, vi } from "vitest";
import { OsmosisClient } from "../client.js";
import { SLIPPAGE_BPS_SCHEMA } from "../constants.js";

// Mock skip-api and skip-assets (same as client.test.ts)
vi.mock("../skip-api.js", () => ({
  getSkipRoute: vi.fn(),
  getSkipMsgsDirect: vi.fn(),
  skipMsgToEncodeObject: vi.fn(),
}));

vi.mock("../skip-assets.js", () => ({
  resolveOsmosisDenom: vi.fn(),
}));

import { getSkipRoute } from "../skip-api.js";
import { resolveOsmosisDenom } from "../skip-assets.js";

const mockResolve = vi.mocked(resolveOsmosisDenom);
const mockRoute = vi.mocked(getSkipRoute);

const slippageBpsSchema = SLIPPAGE_BPS_SCHEMA;

describe("slippageBps schema validation", () => {
  it("should reject slippageBps=10000 (100%)", () => {
    const result = slippageBpsSchema.safeParse(10000);
    expect(result.success).toBe(false);
  });

  it("should reject slippageBps=-100 (negative)", () => {
    const result = slippageBpsSchema.safeParse(-100);
    expect(result.success).toBe(false);
  });

  it("should reject slippageBps=0", () => {
    const result = slippageBpsSchema.safeParse(0);
    expect(result.success).toBe(false);
  });

  it("should accept slippageBps=50 (0.5%, default)", () => {
    const result = slippageBpsSchema.safeParse(50);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(50);
  });

  it("should accept slippageBps=1 (0.01%, minimum)", () => {
    const result = slippageBpsSchema.safeParse(1);
    expect(result.success).toBe(true);
  });

  it("should accept slippageBps=500 (5%, maximum)", () => {
    const result = slippageBpsSchema.safeParse(500);
    expect(result.success).toBe(true);
  });

  it("should reject slippageBps=501 (above max)", () => {
    const result = slippageBpsSchema.safeParse(501);
    expect(result.success).toBe(false);
  });

  it("should reject float values (e.g., 50.5)", () => {
    const result = slippageBpsSchema.safeParse(50.5);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("invalid_type");
    }
  });

  it("should default to 50 when undefined", () => {
    const result = slippageBpsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(50);
  });
});

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
