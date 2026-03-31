import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockCosmosClient,
  createMockMcpServer,
  createMockStore,
  type MockMcpServer,
  type MockStore,
  parseToolResponse,
} from "../helpers/mocks.js";

// Mock Cosmos chains (with coinGeckoId on currencies, matching real ChainInfo)
vi.mock("../../chains/cosmos.js", () => ({
  resolveChainDenom: vi.fn().mockImplementation(
    (
      chain: {
        currencies?: Array<{
          coinDenom: string;
          coinMinimalDenom: string;
          coinDecimals?: number;
          coinGeckoId?: string;
        }>;
        feeCurrencies?: Array<{
          coinDenom: string;
          coinMinimalDenom: string;
          coinDecimals?: number;
          coinGeckoId?: string;
        }>;
      },
      denom: string,
    ) => {
      for (const c of chain.currencies ?? []) {
        if (c.coinMinimalDenom === denom) {
          return {
            displayDenom: c.coinDenom,
            decimals: c.coinDecimals,
            coinGeckoId: c.coinGeckoId,
          };
        }
      }
      for (const fc of chain.feeCurrencies ?? []) {
        if (fc.coinMinimalDenom === denom) {
          return {
            displayDenom: fc.coinDenom,
            decimals: fc.coinDecimals,
            coinGeckoId: fc.coinGeckoId,
          };
        }
      }
      return null;
    },
  ),
  listChains: vi.fn().mockReturnValue([
    {
      chainId: "cosmoshub-4",
      chainName: "Cosmos Hub",
      stakeCurrency: {
        coinDenom: "ATOM",
        coinMinimalDenom: "uatom",
        coinDecimals: 6,
        coinGeckoId: "cosmos",
      },
      currencies: [
        {
          coinDenom: "ATOM",
          coinMinimalDenom: "uatom",
          coinGeckoId: "cosmos",
        },
      ],
      bech32Config: { bech32PrefixAccAddr: "cosmos" },
    },
    {
      chainId: "osmosis-1",
      chainName: "Osmosis",
      stakeCurrency: {
        coinDenom: "OSMO",
        coinMinimalDenom: "uosmo",
        coinDecimals: 6,
        coinGeckoId: "osmosis",
      },
      currencies: [
        {
          coinDenom: "OSMO",
          coinMinimalDenom: "uosmo",
          coinGeckoId: "osmosis",
        },
        {
          coinDenom: "ION",
          coinMinimalDenom: "uion",
          coinGeckoId: "ion",
        },
      ],
      bech32Config: { bech32PrefixAccAddr: "osmo" },
    },
  ]),
}));

// Mock IBC resolver (default: null = unresolved)
const mockResolveIbcDenom = vi.fn().mockResolvedValue(null);

vi.mock("../../utils/ibc-resolver.js", () => ({
  resolveIbcDenom: (...args: unknown[]) => mockResolveIbcDenom(...args),
}));

// Mock price service
const mockGetPrices = vi.fn().mockResolvedValue(
  new Map([
    ["cosmos", { usd: 11.5, usd_24h_change: 2.1 }],
    ["osmosis", { usd: 1.2, usd_24h_change: -0.5 }],
    ["ion", { usd: 0.8, usd_24h_change: 0.3 }],
  ]),
);

vi.mock("../../services/price.js", () => ({
  getPriceService: vi.fn().mockReturnValue({
    getPrice: vi.fn().mockResolvedValue({ usd: 10, usd_24h_change: 1.5 }),
    getPrices: (...args: unknown[]) => mockGetPrices(...args),
    clearCache: vi.fn(),
  }),
  resolveCoingeckoId: vi.fn().mockImplementation((denom: string) => {
    const map: Record<string, string> = {
      ATOM: "cosmos",
      OSMO: "osmosis",
    };
    return map[denom.toUpperCase()];
  }),
}));

describe("Unified Portfolio Plugin", () => {
  let mockServer: MockMcpServer;
  let mockStore: MockStore;
  let mockCosmosClient: ReturnType<typeof createMockCosmosClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    mockCosmosClient = createMockCosmosClient({
      getAddress: vi.fn().mockResolvedValue("cosmos1testaddr"),
      getBalancesViaLcd: vi.fn().mockResolvedValue([
        {
          denom: "uatom",
          amount: "5000000",
          displayAmount: "5.000000",
          displayDenom: "ATOM",
        },
      ]),
      getDelegationsViaLcd: vi.fn().mockResolvedValue([]),
      getRewardsViaLcd: vi.fn().mockResolvedValue([]),
    });
    mockStore = createMockStore({
      getClientFor: vi.fn().mockImplementation(async (type: string) => {
        if (type === "cosmos") return mockCosmosClient;
        throw new Error(`No adapter for "${type}"`);
      }),
    });

    const { default: plugin } = await import(
      "../../plugins/unified-portfolio.js"
    );
    plugin.register(mockServer as any, mockStore as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should register get-portfolio tool", () => {
    const tool = mockServer.getTool("get-portfolio");
    expect(tool).toBeDefined();
    expect(tool!.config.description).toContain("unified portfolio");
  });

  it("should return Cosmos portfolio with USD values", async () => {
    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      summary: {
        totalValueUsd: number | null;
        cosmosChains: number;
        chainsSuccessful: number;
      };
      totals: Array<{
        symbol: string;
        totalAmount: string;
        priceUsd: number | null;
        valueUsd: number | null;
      }>;
      cosmos: Array<{ chainId: string; balances: unknown[] }>;
      priceNote: string;
      suggestedActions: Array<{ tool: string }>;
    }>(result);

    // Should have Cosmos chains
    expect(parsed.summary.cosmosChains).toBe(2); // cosmoshub-4 + osmosis-1
    expect(parsed.cosmos.length).toBe(2);

    // Should have USD values
    expect(parsed.summary.totalValueUsd).toBeGreaterThan(0);

    // Should have totals
    expect(parsed.totals.length).toBeGreaterThan(0);
    const atomTotal = parsed.totals.find((t) => t.symbol === "ATOM");
    expect(atomTotal).toBeDefined();
    expect(atomTotal!.priceUsd).toBe(11.5);

    // Should have price note
    expect(parsed.priceNote).toContain("CoinGecko");

    // Should have suggested actions
    expect(parsed.suggestedActions.length).toBeGreaterThan(0);
  });

  it("should handle includePrices: false - no USD values", async () => {
    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      summary: { totalValueUsd: number | null };
      totals: Array<{ valueUsd: number | null }>;
      priceNote: string;
    }>(result);

    expect(parsed.summary.totalValueUsd).toBeNull();
    expect(parsed.priceNote).toBe("Prices not requested");
    for (const total of parsed.totals) {
      expect(total.valueUsd).toBeNull();
    }
  });

  it("should handle includeStaking: false", async () => {
    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: false,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      cosmos: Array<{
        staking: unknown | null;
      }>;
    }>(result);

    for (const chain of parsed.cosmos) {
      expect(chain.staking).toBeNull();
    }
    // getDelegations and getRewards should not be called
    expect(mockCosmosClient.getDelegationsViaLcd).not.toHaveBeenCalled();
    expect(mockCosmosClient.getRewardsViaLcd).not.toHaveBeenCalled();
  });

  it("should filter by specific chain IDs", async () => {
    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      chains: ["cosmoshub-4"],
      includeStaking: false,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      summary: { cosmosChains: number };
      cosmos: Array<{ chainId: string }>;
    }>(result);

    expect(parsed.summary.cosmosChains).toBe(1);
    expect(parsed.cosmos[0].chainId).toBe("cosmoshub-4");
  });

  it("should filter by chain names (case-insensitive)", async () => {
    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      chains: ["Osmosis"],
      includeStaking: false,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      cosmos: Array<{ chainId: string }>;
    }>(result);

    expect(parsed.cosmos.length).toBe(1);
    expect(parsed.cosmos[0].chainId).toBe("osmosis-1");
  });

  it("should return setup_required when no wallet configured", async () => {
    mockStore.getClientFor = vi
      .fn()
      .mockRejectedValue(
        new Error("No mnemonic configured. Use create-account to get started."),
      );

    mockServer = createMockMcpServer();
    const { default: plugin } = await import(
      "../../plugins/unified-portfolio.js"
    );
    plugin.register(mockServer as any, mockStore as any);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      status: string;
      setupGuide: { options: Array<{ tool: string }> };
    }>(result);

    expect(parsed.status).toBe("setup_required");
    expect(parsed.setupGuide).toBeDefined();
    expect(parsed.setupGuide.options.length).toBeGreaterThan(0);
  });

  it("should calculate correct totalValueUsd", async () => {
    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      summary: { totalValueUsd: number };
      totals: Array<{ symbol: string; valueUsd: number | null }>;
    }>(result);

    expect(parsed.summary.totalValueUsd).toBeGreaterThan(0);

    const atomTotal = parsed.totals.find((t) => t.symbol === "ATOM");
    expect(atomTotal).toBeDefined();
    expect(atomTotal!.valueUsd).toBeGreaterThan(0);
  });

  it("should include proper suggestedActions", async () => {
    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      suggestedActions: Array<{
        tool: string;
        reason: string;
        priority: number;
      }>;
    }>(result);

    expect(parsed.suggestedActions).toBeDefined();
    expect(parsed.suggestedActions.length).toBeGreaterThan(0);

    // Should suggest staking since there are balances but no delegations
    const delegateAction = parsed.suggestedActions.find(
      (a) => a.tool === "delegate",
    );
    expect(delegateAction).toBeDefined();
  });

  it("should handle partial failures gracefully", async () => {
    // Make cosmos getBalances fail for one chain by simulating
    // a per-chain error via the cosmos client
    let callCount = 0;
    mockCosmosClient.getBalancesViaLcd = vi
      .fn()
      .mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("RPC timeout");
        }
        return [
          {
            denom: "uatom",
            amount: "5000000",
            displayAmount: "5.000000",
            displayDenom: "ATOM",
          },
        ];
      });

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: false,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      summary: { chainsSuccessful: number; chainsFailed: number };
      cosmos: unknown[];
      errors: Array<{ chainId: string; error: string }>;
    }>(result);

    // One cosmos chain succeeded, one failed
    expect(parsed.cosmos.length).toBe(1);
    expect(parsed.errors).toBeDefined();
    expect(parsed.errors.length).toBe(1);
    expect(parsed.errors[0].error).toContain("RPC timeout");
  });

  it("should log staking query failures to stderr with chain ID", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockCosmosClient.getDelegationsViaLcd = vi
      .fn()
      .mockRejectedValue(new Error("staking not supported"));
    mockCosmosClient.getRewardsViaLcd = vi
      .fn()
      .mockRejectedValue(new Error("staking not supported"));

    const tool = mockServer.getTool("get-portfolio")!;
    await tool.handler({ includeStaking: true, includePrices: false });

    const stakingWarnings = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("[portfolio]"),
    );
    expect(stakingWarnings.length).toBeGreaterThan(0);

    // Should include chain ID and error message
    const firstWarning = stakingWarnings[0][0] as string;
    expect(firstWarning).toMatch(/\[portfolio\] staking query failed for/);
    expect(firstWarning).toContain("staking not supported");

    warnSpy.mockRestore();
  });

  it("should return staking not_supported status for ICS consumer chains", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockCosmosClient.getDelegationsViaLcd = vi
      .fn()
      .mockRejectedValue(new Error("unknown query path"));
    mockCosmosClient.getRewardsViaLcd = vi
      .fn()
      .mockRejectedValue(new Error("unknown query path"));

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      cosmos: Array<{
        chainId: string;
        staking: {
          status?: string;
          reason?: string;
          delegations: unknown[];
          rewards: unknown[];
        } | null;
      }>;
    }>(result);

    // staking should be an explicit not_supported object, not null
    for (const chain of parsed.cosmos) {
      expect(chain.staking).not.toBeNull();
      expect(chain.staking!.status).toBe("not_supported");
      expect(chain.staking!.reason).toContain("not available");
      expect(chain.staking!.delegations).toEqual([]);
      expect(chain.staking!.rewards).toEqual([]);
    }

    warnSpy.mockRestore();
  });

  it("should not suggest delegate for chains with not_supported staking", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Make staking return not_supported
    mockCosmosClient.getDelegationsViaLcd = vi
      .fn()
      .mockRejectedValue(new Error("unknown query path"));
    mockCosmosClient.getRewardsViaLcd = vi
      .fn()
      .mockRejectedValue(new Error("unknown query path"));

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      suggestedActions: Array<{ tool: string }>;
    }>(result);

    // Should NOT suggest delegate when all chains have not_supported staking
    const delegateAction = parsed.suggestedActions.find(
      (a) => a.tool === "delegate",
    );
    expect(delegateAction).toBeUndefined();

    warnSpy.mockRestore();
  });

  it("should still return staking null for non-module errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockCosmosClient.getDelegationsViaLcd = vi
      .fn()
      .mockRejectedValue(new Error("connection refused"));
    mockCosmosClient.getRewardsViaLcd = vi
      .fn()
      .mockRejectedValue(new Error("connection refused"));

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      cosmos: Array<{
        staking: { status?: string } | null;
      }>;
    }>(result);

    // Generic errors should still result in null (not not_supported)
    for (const chain of parsed.cosmos) {
      expect(chain.staking).toBeNull();
    }

    warnSpy.mockRestore();
  });

  // ── Fix #3/#7: Staking value in totalValueUsd + breakdown ─────────

  it("should include staking value in totalValueUsd", async () => {
    // Setup: 5 ATOM liquid, 10 ATOM delegated, rewards of 500000 uatom
    mockCosmosClient.getDelegationsViaLcd = vi.fn().mockResolvedValue([
      {
        validatorAddress: "cosmosvaloper1abc",
        amount: "10000000",
        displayAmount: "10.000000",
        denom: "uatom",
      },
    ]);
    mockCosmosClient.getRewardsViaLcd = vi.fn().mockResolvedValue([
      {
        validatorAddress: "cosmosvaloper1abc",
        rewards: [{ denom: "uatom", amount: "500000" }],
      },
    ]);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      summary: {
        totalValueUsd: number;
        liquidValueUsd: number | null;
        stakedValueUsd: number | null;
        rewardsValueUsd: number | null;
      };
      cosmos: Array<{
        staking: {
          delegations: Array<{
            displayAmount: string;
            displayDenom: string;
            valueUsd: number | null;
          }>;
          rewards: Array<{
            displayAmount: string;
            displayDenom: string;
            valueUsd: number | null;
          }>;
          totalStakedValueUsd: number | null;
          totalRewardsValueUsd: number | null;
        } | null;
      }>;
    }>(result);

    // Liquid: 5 ATOM * 11.5 * 2 chains = 115
    // Staked: 10 ATOM * 11.5 * 2 chains = 230
    // Rewards: 0.5 ATOM * 11.5 * 2 chains = 11.5
    // totalValueUsd should include all three
    expect(parsed.summary.totalValueUsd).toBeGreaterThan(0);
    expect(parsed.summary.liquidValueUsd).toBeGreaterThan(0);
    expect(parsed.summary.stakedValueUsd).toBeGreaterThan(0);
    expect(parsed.summary.rewardsValueUsd).toBeGreaterThan(0);

    // totalValueUsd = liquid + staked + rewards
    expect(parsed.summary.totalValueUsd).toBe(
      (parsed.summary.liquidValueUsd ?? 0) +
        (parsed.summary.stakedValueUsd ?? 0) +
        (parsed.summary.rewardsValueUsd ?? 0),
    );

    // Verify staking data is enriched with prices
    const chain = parsed.cosmos[0];
    expect(chain.staking).not.toBeNull();
    expect(chain.staking!.delegations[0].valueUsd).toBeGreaterThan(0);
    expect(chain.staking!.delegations[0].displayDenom).toBe("ATOM");
    expect(chain.staking!.totalStakedValueUsd).toBeGreaterThan(0);

    // Verify rewards converted from minimal denom
    expect(chain.staking!.rewards[0].displayAmount).toBe("0.500000");
    expect(chain.staking!.rewards[0].valueUsd).toBeGreaterThan(0);
    expect(chain.staking!.totalRewardsValueUsd).toBeGreaterThan(0);
  });

  it("should not include breakdown fields when includePrices is false", async () => {
    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      summary: {
        totalValueUsd: number | null;
        liquidValueUsd?: number | null;
        stakedValueUsd?: number | null;
        rewardsValueUsd?: number | null;
      };
    }>(result);

    expect(parsed.summary.totalValueUsd).toBeNull();
    // Breakdown fields should not be present when prices not requested
    expect(parsed.summary.liquidValueUsd).toBeUndefined();
    expect(parsed.summary.stakedValueUsd).toBeUndefined();
    expect(parsed.summary.rewardsValueUsd).toBeUndefined();
  });

  // ── Fix #4: Totals sorted by valueUsd descending ──────────────────

  it("should sort totals by valueUsd descending", async () => {
    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      totals: Array<{
        symbol: string;
        valueUsd: number | null;
      }>;
    }>(result);

    // Verify totals are sorted by valueUsd descending
    const pricedTotals = parsed.totals.filter((t) => t.valueUsd != null);
    for (let i = 1; i < pricedTotals.length; i++) {
      expect(pricedTotals[i - 1].valueUsd!).toBeGreaterThanOrEqual(
        pricedTotals[i].valueUsd!,
      );
    }
  });

  // ── Fix #5: Empty portfolio UX ─────────────────────────────────────

  it("should show empty_portfolio status when all balances are zero", async () => {
    // Zero balances
    mockCosmosClient.getBalancesViaLcd = vi.fn().mockResolvedValue([
      {
        denom: "uatom",
        amount: "0",
        displayAmount: "0.000000",
        displayDenom: "ATOM",
      },
    ]);
    mockStore.getClientFor = vi
      .fn()
      .mockImplementation(async (type: string) => {
        if (type === "cosmos") return mockCosmosClient;
        throw new Error(`No adapter for "${type}"`);
      });

    mockServer = createMockMcpServer();
    const { default: plugin } = await import(
      "../../plugins/unified-portfolio.js"
    );
    plugin.register(mockServer as any, mockStore as any);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      status: string;
      message: string;
      suggestedActions: Array<{ tool: string }>;
    }>(result);

    expect(parsed.status).toBe("empty_portfolio");
    expect(parsed.message).toContain("empty");

    // Should suggest getting cosmos address to fund wallet
    const addressActions = parsed.suggestedActions.filter(
      (a) => a.tool === "get-cosmos-address",
    );
    expect(addressActions.length).toBe(1);
  });

  it("should NOT show empty_portfolio when there are delegations", async () => {
    // Zero liquid balance but has delegations
    mockCosmosClient.getBalancesViaLcd = vi.fn().mockResolvedValue([
      {
        denom: "uatom",
        amount: "0",
        displayAmount: "0.000000",
        displayDenom: "ATOM",
      },
    ]);
    mockCosmosClient.getDelegationsViaLcd = vi.fn().mockResolvedValue([
      {
        validatorAddress: "cosmosvaloper1abc",
        amount: "10000000",
        displayAmount: "10.000000",
        denom: "uatom",
      },
    ]);
    mockStore.getClientFor = vi
      .fn()
      .mockImplementation(async (type: string) => {
        if (type === "cosmos") return mockCosmosClient;
        throw new Error(`No adapter for "${type}"`);
      });

    mockServer = createMockMcpServer();
    const { default: plugin } = await import(
      "../../plugins/unified-portfolio.js"
    );
    plugin.register(mockServer as any, mockStore as any);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      status?: string;
      suggestedActions: Array<{ tool: string }>;
    }>(result);

    // Should NOT be empty since staking exists
    expect(parsed.status).toBeUndefined();
    // Should not suggest get-address actions
    expect(
      parsed.suggestedActions.find((a) => a.tool === "get-cosmos-address"),
    ).toBeUndefined();
  });

  // ── Cross-package: DecCoin reward format ────────────────────────────

  it("should handle rewards in DecCoin format with decimal amounts", async () => {
    // MnemonicCosmosClient returns raw DecCoin amounts with decimals
    // (e.g., "500000.789012"). The portfolio tool must handle both formats.
    mockCosmosClient.getRewardsViaLcd = vi.fn().mockResolvedValue([
      {
        validatorAddress: "cosmosvaloper1abc",
        rewards: [{ denom: "uatom", amount: "500000.789012" }],
      },
    ]);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      cosmos: Array<{
        staking: {
          rewards: Array<{ displayAmount: string; valueUsd: number | null }>;
        } | null;
      }>;
    }>(result);

    // DecCoin fractional part truncated → 500000 / 10^6 = 0.500000
    const reward = parsed.cosmos[0].staking!.rewards[0];
    expect(reward.displayAmount).toBe("0.500000");
    expect(reward.valueUsd).toBeGreaterThan(0);
    expect(Number.isNaN(reward.valueUsd)).toBe(false);
  });

  // ── Fix: stToken reward decimals (per-token resolution) ────────────

  it("should use per-token decimals for stToken rewards instead of chain default", async () => {
    // Rewards include stTokens with atto-prefix (18 decimals)
    // alongside native uatom (6 decimals). Each denom should use its own decimals.
    mockCosmosClient.getRewardsViaLcd = vi.fn().mockResolvedValue([
      {
        validatorAddress: "cosmosvaloper1abc",
        rewards: [
          { denom: "uatom", amount: "1500000" },
          { denom: "staevmos", amount: "35495903019883" },
          { denom: "staISLM", amount: "220930965718858" },
          { denom: "stuatom", amount: "42" },
        ],
      },
    ]);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      cosmos: Array<{
        staking: {
          rewards: Array<{
            displayAmount: string;
            displayDenom: string;
            valueUsd: number | null;
          }>;
          totalRewardsValueUsd: number | null;
        } | null;
      }>;
    }>(result);

    const rewards = parsed.cosmos[0].staking!.rewards;

    // Native uatom: 1500000 / 10^6 = 1.500000, displayed as "ATOM"
    const atomReward = rewards.find((r) => r.displayDenom === "ATOM");
    expect(atomReward).toBeDefined();
    expect(atomReward!.displayAmount).toBe("1.500000");

    // staevmos: 35495903019883 / 10^18 = 0.000035..., displayed as "staevmos"
    const staevmosReward = rewards.find((r) => r.displayDenom === "staevmos");
    expect(staevmosReward).toBeDefined();
    expect(parseFloat(staevmosReward!.displayAmount)).toBeLessThan(1);

    // staISLM: 220930965718858 / 10^18 = 0.000220..., displayed as "staISLM"
    const staISLMReward = rewards.find((r) => r.displayDenom === "staISLM");
    expect(staISLMReward).toBeDefined();
    expect(parseFloat(staISLMReward!.displayAmount)).toBeLessThan(1);

    // stuatom: 42 / 10^6 = 0.000042, displayed as "stuatom" (not "ATOM")
    const stuatomReward = rewards.find((r) => r.displayDenom === "stuatom");
    expect(stuatomReward).toBeDefined();
    expect(stuatomReward!.displayAmount).toBe("0.000042");

    // No phantom million-dollar rewards — stTokens have no CoinGecko mapping
    const totalRewards = parsed.cosmos[0].staking!.totalRewardsValueUsd;
    expect(totalRewards === null || totalRewards < 100).toBe(true);
  });

  // ── Fix: IBC reward denom resolution via chain config ────────────

  it("should resolve IBC reward denoms using chain config instead of raw hash", async () => {
    // Override chain config to include an IBC currency with decimals on cosmoshub-4
    const { listChains } = await import("../../chains/cosmos.js");
    (listChains as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        chainId: "cosmoshub-4",
        chainName: "Cosmos Hub",
        stakeCurrency: {
          coinDenom: "ATOM",
          coinMinimalDenom: "uatom",
          coinDecimals: 6,
          coinGeckoId: "cosmos",
        },
        currencies: [
          {
            coinDenom: "ATOM",
            coinMinimalDenom: "uatom",
            coinDecimals: 6,
            coinGeckoId: "cosmos",
          },
          {
            coinDenom: "USDC",
            coinMinimalDenom:
              "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
            coinDecimals: 6,
            coinGeckoId: "usd-coin",
          },
        ],
        bech32Config: { bech32PrefixAccAddr: "cosmos" },
      },
      {
        chainId: "osmosis-1",
        chainName: "Osmosis",
        stakeCurrency: {
          coinDenom: "OSMO",
          coinMinimalDenom: "uosmo",
          coinDecimals: 6,
          coinGeckoId: "osmosis",
        },
        currencies: [
          {
            coinDenom: "OSMO",
            coinMinimalDenom: "uosmo",
            coinGeckoId: "osmosis",
          },
          {
            coinDenom: "ION",
            coinMinimalDenom: "uion",
            coinGeckoId: "ion",
          },
        ],
        bech32Config: { bech32PrefixAccAddr: "osmo" },
      },
    ]);

    mockCosmosClient.getRewardsViaLcd = vi.fn().mockResolvedValue([
      {
        validatorAddress: "cosmosvaloper1abc",
        rewards: [
          { denom: "uatom", amount: "1000000" },
          {
            denom:
              "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
            amount: "500000",
          },
          { denom: "ibc/UNKNOWN_HASH_NOT_IN_CONFIG", amount: "100000" },
        ],
      },
    ]);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      cosmos: Array<{
        staking: {
          rewards: Array<{
            displayAmount: string;
            displayDenom: string;
            valueUsd: number | null;
          }>;
        } | null;
      }>;
    }>(result);

    const rewards = parsed.cosmos[0].staking!.rewards;

    // Native uatom: displayed as "ATOM"
    const atomReward = rewards.find((r) => r.displayDenom === "ATOM");
    expect(atomReward).toBeDefined();
    expect(atomReward!.displayAmount).toBe("1.000000");

    // Registered IBC USDC: resolved via chain config to "USDC" with correct decimals
    const usdcReward = rewards.find((r) => r.displayDenom === "USDC");
    expect(usdcReward).toBeDefined();
    expect(usdcReward!.displayAmount).toBe("0.500000");

    // Unregistered IBC denom: falls back to raw hash (not labeled as "ATOM")
    const unknownReward = rewards.find((r) =>
      r.displayDenom.startsWith("ibc/UNKNOWN"),
    );
    expect(unknownReward).toBeDefined();
    expect(unknownReward!.displayDenom).not.toBe("ATOM");
  });

  // ── Fix: IBC reward denom resolution via resolveIbcDenom ───────────

  it("should resolve unregistered IBC reward denoms via resolveIbcDenom", async () => {
    mockResolveIbcDenom.mockResolvedValue({
      displayDenom: "USDT",
      decimals: 6,
      coinGeckoId: "tether",
    });

    mockCosmosClient.getRewardsViaLcd = vi.fn().mockResolvedValue([
      {
        validatorAddress: "cosmosvaloper1abc",
        rewards: [{ denom: "ibc/UNREGISTERED_USDT_HASH", amount: "2000000" }],
      },
    ]);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      cosmos: Array<{
        staking: {
          rewards: Array<{
            displayAmount: string;
            displayDenom: string;
          }>;
        } | null;
      }>;
    }>(result);

    const rewards = parsed.cosmos[0].staking!.rewards;
    const usdtReward = rewards.find((r) => r.displayDenom === "USDT");
    expect(usdtReward).toBeDefined();
    expect(usdtReward!.displayAmount).toBe("2.000000");

    expect(mockResolveIbcDenom).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: "cosmoshub-4" }),
      "ibc/UNREGISTERED_USDT_HASH",
    );
  });

  it("should fall back to raw hash when resolveIbcDenom returns null", async () => {
    mockResolveIbcDenom.mockResolvedValue(null);

    mockCosmosClient.getRewardsViaLcd = vi.fn().mockResolvedValue([
      {
        validatorAddress: "cosmosvaloper1abc",
        rewards: [{ denom: "ibc/TOTALLY_UNKNOWN", amount: "300000" }],
      },
    ]);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: false,
    });
    const parsed = parseToolResponse<{
      cosmos: Array<{
        staking: {
          rewards: Array<{
            displayAmount: string;
            displayDenom: string;
          }>;
        } | null;
      }>;
    }>(result);

    const rewards = parsed.cosmos[0].staking!.rewards;
    const unknownReward = rewards.find((r) =>
      r.displayDenom.startsWith("ibc/TOTALLY"),
    );
    expect(unknownReward).toBeDefined();
    expect(unknownReward!.displayAmount).toBe("0.300000");
  });

  // ── Edge case: NaN safety in financial calculations ────────────────

  it("should not produce NaN when displayAmount is non-numeric", async () => {
    // Simulate a buggy adapter returning non-numeric displayAmount.
    // The portfolio must still produce valid numeric totals (not NaN).
    mockCosmosClient.getBalancesViaLcd = vi.fn().mockResolvedValue([
      {
        denom: "uatom",
        amount: "5000000",
        displayAmount: "invalid",
        displayDenom: "ATOM",
      },
    ]);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: false,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      summary: { totalValueUsd: number | null };
      cosmos: Array<{
        chainValueUsd: number | null;
        balances: Array<{ valueUsd: number | null }>;
      }>;
    }>(result);

    // "invalid" should be treated as 0, not NaN
    for (const chain of parsed.cosmos) {
      if (chain.chainValueUsd != null) {
        expect(Number.isNaN(chain.chainValueUsd)).toBe(false);
      }
      for (const b of chain.balances) {
        if (b.valueUsd != null) {
          expect(Number.isNaN(b.valueUsd)).toBe(false);
        }
      }
    }
    if (parsed.summary.totalValueUsd != null) {
      expect(Number.isNaN(parsed.summary.totalValueUsd)).toBe(false);
    }
  });

  // ── Chain-provided coinGeckoId usage ────────────────────────────────

  it("should use chain-provided coinGeckoId for tokens not in hardcoded map", async () => {
    // ION is NOT in DENOM_TO_COINGECKO but IS in chain.currencies[].coinGeckoId.
    // This verifies chain config is used as primary price lookup source.
    mockCosmosClient.getBalancesViaLcd = vi.fn().mockResolvedValue([
      {
        denom: "uion",
        amount: "2000000",
        displayAmount: "2.000000",
        displayDenom: "ION",
      },
    ]);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: false,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      totals: Array<{
        symbol: string;
        priceUsd: number | null;
        valueUsd: number | null;
      }>;
    }>(result);

    // ION should be priced via chain-provided coinGeckoId "ion"
    const ionTotal = parsed.totals.find((t) => t.symbol === "ION");
    expect(ionTotal).toBeDefined();
    expect(ionTotal!.priceUsd).toBe(0.8);
    expect(ionTotal!.valueUsd).toBeGreaterThan(0);
  });

  // ── IBC denom resolution ──────────────────────────────────────────────

  it("should resolve IBC token displayDenom to human-readable symbol for price lookup", async () => {
    // Simulate a balance that already went through formatBalances()
    // which resolves IBC denoms using chain config.
    // The IBC ATOM denom on Osmosis should resolve to displayDenom "ATOM".
    mockCosmosClient.getBalancesViaLcd = vi.fn().mockResolvedValue([
      {
        denom:
          "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
        amount: "5000000",
        displayAmount: "5.000000",
        displayDenom: "ATOM",
      },
    ]);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: false,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      totals: Array<{
        symbol: string;
        priceUsd: number | null;
        valueUsd: number | null;
      }>;
    }>(result);

    // ATOM should be priced correctly even though the raw denom is an IBC hash
    const atomTotal = parsed.totals.find((t) => t.symbol === "ATOM");
    expect(atomTotal).toBeDefined();
    expect(atomTotal!.priceUsd).toBe(11.5);
    expect(atomTotal!.valueUsd).toBeGreaterThan(0);
  });

  it("should use IBC minimalDenom fallback key for price lookup when displayDenom is raw hash", async () => {
    // Edge case: if formatBalances fails to resolve and displayDenom is still an IBC hash,
    // buildChainGeckoIds() should still find the geckoId via the minimalDenom key.
    // This tests the defensive fallback added to buildChainGeckoIds().
    mockCosmosClient.getBalancesViaLcd = vi.fn().mockResolvedValue([
      {
        denom:
          "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
        amount: "5000000",
        displayAmount: "5.000000",
        // Still raw hash — simulates a case where chain config lookup missed
        displayDenom:
          "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
      },
    ]);

    // Need the mock chain to have this IBC denom with coinGeckoId in currencies
    const { listChains } = await import("../../chains/cosmos.js");
    (listChains as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        chainId: "osmosis-1",
        chainName: "Osmosis",
        stakeCurrency: {
          coinDenom: "OSMO",
          coinMinimalDenom: "uosmo",
          coinDecimals: 6,
          coinGeckoId: "osmosis",
        },
        currencies: [
          {
            coinDenom: "OSMO",
            coinMinimalDenom: "uosmo",
            coinGeckoId: "osmosis",
          },
          {
            coinDenom: "ATOM",
            coinMinimalDenom:
              "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
            coinGeckoId: "cosmos",
          },
        ],
        bech32Config: { bech32PrefixAccAddr: "osmo" },
      },
    ]);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: false,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      cosmos: Array<{
        chainId: string;
        balances: Array<{
          displayDenom: string;
          priceUsd: number | null;
          valueUsd: number | null;
        }>;
      }>;
    }>(result);

    // Find the Osmosis chain balances
    const osmosis = parsed.cosmos.find((c) => c.chainId === "osmosis-1");
    expect(osmosis).toBeDefined();
    const ibcBalance = osmosis!.balances[0];
    // The fallback geckoId mapping via coinMinimalDenom should enable pricing
    expect(ibcBalance.priceUsd).toBe(11.5);
    expect(ibcBalance.valueUsd).toBeGreaterThan(0);
  });

  // ── Ecosystem-level non-setup errors should surface in errors array ─

  it("should capture non-setup ecosystem rejection in errors array", async () => {
    // Cosmos adapter throws a non-setup error (e.g., connection pool exhausted)
    mockStore.getClientFor = vi
      .fn()
      .mockRejectedValue(new Error("Connection pool exhausted"));

    mockServer = createMockMcpServer();
    const { default: plugin } = await import(
      "../../plugins/unified-portfolio.js"
    );
    plugin.register(mockServer as any, mockStore as any);

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: false,
      includePrices: true,
    });
    const parsed = parseToolResponse<{
      summary: { cosmosChains: number };
      errors: Array<{ chainId: string; error: string }>;
    }>(result);

    // Cosmos error should be captured (not silently lost)
    expect(parsed.errors).toBeDefined();
    expect(parsed.errors.length).toBe(1);
    expect(parsed.errors[0].chainId).toBe("cosmos");
    expect(parsed.errors[0].error).toContain("Connection pool exhausted");
  });

  // ── Fix #6: classifyError in error handler ─────────────────────────

  it("should use classifyError pattern for non-setup errors", async () => {
    // Make getPrices throw to trigger the catch block in the handler
    // (Promise.allSettled absorbs getClientFor errors, so we need an error
    // that occurs after the parallel queries, during enrichWithPrices)
    mockGetPrices.mockRejectedValueOnce(new Error("Network timeout"));

    const tool = mockServer.getTool("get-portfolio")!;
    const result = await tool.handler({
      includeStaking: true,
      includePrices: true,
    });

    const parsed = parseToolResponse<{
      isError: boolean;
      category: string;
      recoverable: boolean;
      suggestion: string;
      tool: string;
    }>(result);

    expect(parsed.isError).toBe(true);
    expect(parsed.category).toBe("timeout");
    expect(parsed.recoverable).toBe(true);
    expect(parsed.suggestion).toBeDefined();
    expect(parsed.tool).toBe("get-portfolio");
  });
});
