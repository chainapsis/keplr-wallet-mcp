import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteResult } from "../../client.js";
import { registerQuoteTool } from "../../tools/quote.js";

// Mock SDK
vi.mock("@keplr-wallet/keplr-wallet-mcp/sdk", () => ({
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
}));

// Mock client
vi.mock("../../client.js", () => ({
  getOsmosisClient: vi.fn(),
}));

// Mock skip-assets
vi.mock("../../skip-assets.js", () => ({
  getSkipOsmosisAssets: vi.fn().mockResolvedValue([]),
}));

import { getOsmosisClient } from "../../client.js";

const mockGetOsmosisClient = vi.mocked(getOsmosisClient);

// --- Test helpers ---

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}>;

interface MockMcpServer {
  registerTool: ReturnType<typeof vi.fn>;
  registerResource: ReturnType<typeof vi.fn>;
  registerPrompt: ReturnType<typeof vi.fn>;
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
    registerResource: vi.fn(),
    registerPrompt: vi.fn(),
    getToolHandler: (name: string) => tools.get(name),
  };
};

const createMockStore = () => ({
  getClientFor: vi.fn(),
  storePending: vi.fn().mockReturnValue("mock-token"),
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

describe("osmosis-quote tool", () => {
  let server: MockMcpServer;
  let store: ReturnType<typeof createMockStore>;
  let quoteHandler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMockServer();
    store = createMockStore();

    registerQuoteTool(
      server as unknown as Parameters<typeof registerQuoteTool>[0],
      store as unknown as Parameters<typeof registerQuoteTool>[1],
    );

    quoteHandler = server.getToolHandler("osmosis-quote")!;

    mockGetOsmosisClient.mockReturnValue({
      getQuote: vi.fn().mockResolvedValue(MOCK_QUOTE),
    } as unknown as ReturnType<typeof getOsmosisClient>);
  });

  it("should return quote with balance context when wallet is connected", async () => {
    store.getClientFor.mockResolvedValue({
      getBalances: vi
        .fn()
        .mockResolvedValue([{ denom: "uosmo", amount: "50000000" }]),
      disconnect: vi.fn(),
    });

    const result = await quoteHandler({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    const parsed = parseResponse<Record<string, unknown>>(result);
    expect(parsed.balanceContext).toEqual({
      currentBalance: "50000000",
      requiredAmount: "10000000",
      sufficient: true,
    });
  });

  it("should suggest IBC transfer when balance is insufficient", async () => {
    store.getClientFor.mockResolvedValue({
      getBalances: vi
        .fn()
        .mockResolvedValue([{ denom: "uosmo", amount: "1000" }]),
      disconnect: vi.fn(),
    });

    const result = await quoteHandler({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    const parsed = parseResponse<{
      suggestedActions: Array<{ tool: string }>;
      balanceContext: { sufficient: boolean };
    }>(result);
    expect(parsed.balanceContext.sufficient).toBe(false);
    expect(parsed.suggestedActions[0].tool).toBe("get-balances");
    expect(parsed.suggestedActions[1].tool).toBe("ibc-transfer");
  });

  it("should return quote without balance context when wallet is not configured", async () => {
    store.getClientFor.mockRejectedValue(new Error("No mnemonic configured"));

    const result = await quoteHandler({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    const parsed = parseResponse<Record<string, unknown>>(result);
    expect(parsed.quote).toBeDefined();
    expect(parsed.balanceContext).toBeUndefined();
  });

  it("should return setup_required response for wallet errors", async () => {
    mockGetOsmosisClient.mockReturnValue({
      getQuote: vi.fn().mockRejectedValue(new Error("No mnemonic configured")),
    } as unknown as ReturnType<typeof getOsmosisClient>);

    const result = await quoteHandler({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    const parsed = parseResponse<{ status: string }>(result);
    expect(parsed.status).toBe("setup_required");
  });

  it("should return classified error for general failures", async () => {
    mockGetOsmosisClient.mockReturnValue({
      getQuote: vi
        .fn()
        .mockRejectedValue(new Error("Skip API unreachable: fetch failed")),
    } as unknown as ReturnType<typeof getOsmosisClient>);

    const result = await quoteHandler({
      tokenIn: "OSMO",
      tokenOut: "ATOM",
      amountIn: "10",
    });

    expect(result.isError).toBe(true);
    const parsed = parseResponse<{ message: string; tool: string }>(result);
    expect(parsed.tool).toBe("osmosis-quote");
    expect(parsed.message).toContain("Skip API unreachable");
  });
});
