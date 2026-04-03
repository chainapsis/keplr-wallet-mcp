import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteResult } from "../../../../../plugins/cosmos/osmosis/client.js";
import { registerSwapTool } from "../../../../../plugins/cosmos/osmosis/tools/swap.js";

// Mock SDK
vi.mock("../../../../../sdk.js", () => ({
  classifyError: vi.fn((err: Error) => ({
    category: "UNKNOWN",
    message: err.message,
    recoverable: false,
  })),
  formatClassifiedError: vi.fn((classified: Record<string, unknown>) => ({
    isError: true,
    ...classified,
  })),
  isSetupRequiredError: vi.fn(
    (msg: string) =>
      msg.includes("No mnemonic") || msg.includes("setup_required"),
  ),
  createSetupRequiredResponse: vi.fn((ctx: { attemptedAction: string }) => ({
    status: "setup_required",
    attemptedAction: ctx.attemptedAction,
  })),
  elicitTxConfirmation: vi.fn().mockResolvedValue(null),
  getAuthManager: vi.fn(),
  getChainConfig: vi.fn().mockReturnValue({
    chainId: "osmosis-1",
    chainName: "Osmosis",
  }),
  pickTip: vi.fn().mockReturnValue("Tip: check tx status"),
}));

// Mock store module
vi.mock("../../../../../store.js", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getTtlInfo: vi.fn().mockReturnValue({
      expiresIn: "5 minutes",
      expiresAt: "2026-01-01T00:05:00Z",
      ttlWarning: "Token expires in 5 minutes",
    }),
  };
});

// Mock client
vi.mock("../../../../../plugins/cosmos/osmosis/client.js", () => ({
  getOsmosisClient: vi.fn(),
}));

import { getOsmosisClient } from "../../../../../plugins/cosmos/osmosis/client.js";

const mockGetOsmosisClient = vi.mocked(getOsmosisClient);

// --- Test helpers ---

type ToolHandler = (
  params: Record<string, unknown>,
  extra: unknown,
) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}>;

interface MockMcpServer {
  registerTool: ReturnType<typeof vi.fn>;
  server: Record<string, unknown>;
  getToolHandler: (name: string) => ToolHandler | undefined;
}

const createMockServer = (): MockMcpServer => {
  const tools = new Map<string, ToolHandler>();
  return {
    registerTool: vi.fn(
      (_name: string, _config: unknown, handler: ToolHandler) => {
        tools.set(_name, handler);
      },
    ),
    server: {},
    getToolHandler: (name: string) => tools.get(name),
  };
};

const createMockStore = () => ({
  getClientFor: vi.fn(),
  storePending: vi.fn().mockReturnValue("mock-confirmation-token"),
});

const parseResponse = <T>(result: {
  content: Array<{ type: "text"; text: string }>;
}): T => JSON.parse(result.content[0].text) as T;

const MOCK_QUOTE: QuoteResult = {
  chainId: "osmosis-1",
  tokenIn: {
    denom: "uosmo",
    symbol: "OSMO",
    decimals: 6,
    amount: "10000000",
    displayAmount: "10",
  },
  tokenOut: {
    denom:
      "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
    symbol: "ATOM",
    decimals: 6,
    amount: "900000",
    displayAmount: "0.9",
  },
  amountOutMin: "895500",
  amountOutMinDisplay: "0.8955",
  priceImpact: "0.12%",
  priceImpactPercent: 0.12,
  route: ["OSMO", "osmosis-poolmanager", "ATOM"],
  slippageBps: 50,
};

const MOCK_SWAP_MSGS = [
  {
    typeUrl: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
    value: { sender: "osmo1abc" },
  },
];

describe("osmosis-swap tool", () => {
  let server: MockMcpServer;
  let store: ReturnType<typeof createMockStore>;
  let swapHandler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMockServer();
    store = createMockStore();

    registerSwapTool(
      server as unknown as Parameters<typeof registerSwapTool>[0],
      store as unknown as Parameters<typeof registerSwapTool>[1],
    );

    swapHandler = server.getToolHandler("osmosis-swap")!;

    mockGetOsmosisClient.mockReturnValue({
      getQuote: vi.fn().mockResolvedValue(MOCK_QUOTE),
      buildSwapMessages: vi.fn().mockResolvedValue(MOCK_SWAP_MSGS),
    } as unknown as ReturnType<typeof getOsmosisClient>);
  });

  it("should return pending_confirmation with token when elicitation is not supported", async () => {
    store.getClientFor.mockResolvedValue({
      getAddress: vi.fn().mockResolvedValue("osmo1abc"),
      simulateFee: vi.fn().mockResolvedValue({
        feeAmount: "5000",
        feeDenom: "uosmo",
        gasEstimate: "200000",
      }),
      disconnect: vi.fn(),
    });

    const result = await swapHandler(
      { tokenIn: "OSMO", tokenOut: "ATOM", amountIn: "10" },
      {},
    );

    const parsed = parseResponse<{
      status: string;
      confirmationToken: string;
      swap: { tokenIn: { symbol: string } };
    }>(result);
    expect(parsed.status).toBe("pending_confirmation");
    expect(parsed.confirmationToken).toBe("mock-confirmation-token");
    expect(parsed.swap.tokenIn.symbol).toBe("OSMO");
  });

  it("should use fallback fee when simulateFee is not available", async () => {
    store.getClientFor.mockResolvedValue({
      getAddress: vi.fn().mockResolvedValue("osmo1abc"),
      // no simulateFee method
      disconnect: vi.fn(),
    });

    const result = await swapHandler(
      { tokenIn: "OSMO", tokenOut: "ATOM", amountIn: "10" },
      {},
    );

    const parsed = parseResponse<{
      status: string;
    }>(result);
    expect(parsed.status).toBe("pending_confirmation");
    expect(store.storePending).toHaveBeenCalled();
  });

  it("should use fallback fee when simulateFee throws", async () => {
    store.getClientFor.mockResolvedValue({
      getAddress: vi.fn().mockResolvedValue("osmo1abc"),
      simulateFee: vi.fn().mockRejectedValue(new Error("simulation failed")),
      disconnect: vi.fn(),
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await swapHandler(
      { tokenIn: "OSMO", tokenOut: "ATOM", amountIn: "10" },
      {},
    );

    const parsed = parseResponse<{ status: string }>(result);
    expect(parsed.status).toBe("pending_confirmation");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("simulation failed"),
    );
    warnSpy.mockRestore();
  });

  it("should return setup_required response for wallet errors", async () => {
    store.getClientFor.mockRejectedValue(
      new Error("No mnemonic configured. Use create-account to get started."),
    );

    const result = await swapHandler(
      { tokenIn: "OSMO", tokenOut: "ATOM", amountIn: "10" },
      {},
    );

    const parsed = parseResponse<{ status: string }>(result);
    expect(parsed.status).toBe("setup_required");
  });

  it("should return classified error for general failures", async () => {
    store.getClientFor.mockResolvedValue({
      getAddress: vi.fn().mockResolvedValue("osmo1abc"),
      disconnect: vi.fn(),
    });
    mockGetOsmosisClient.mockReturnValue({
      getQuote: vi
        .fn()
        .mockRejectedValue(new Error("Skip API unreachable: fetch failed")),
      buildSwapMessages: vi.fn(),
    } as unknown as ReturnType<typeof getOsmosisClient>);

    const result = await swapHandler(
      { tokenIn: "OSMO", tokenOut: "ATOM", amountIn: "10" },
      {},
    );

    expect(result.isError).toBe(true);
    const parsed = parseResponse<{ message: string; tool: string }>(result);
    expect(parsed.tool).toBe("osmosis-swap");
  });
});
