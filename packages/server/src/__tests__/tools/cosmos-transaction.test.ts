/**
 * Unit tests for Cosmos transaction tools.
 *
 * Tests cover:
 * - send-tokens: Token transfer with preview and warnings
 * - delegate: Staking delegation
 * - undelegate: Unstaking with unbonding warning
 * - claim-rewards: Reward claiming
 * - Transaction preview generation
 * - Warning generation (insufficient balance, large amounts)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockCosmosClient,
  createMockMcpServer,
  createMockStore,
  type MockCosmosClient,
  type MockMcpServer,
  type MockStore,
  parseToolResponse,
} from "../helpers/mocks.js";

// Mock chain config for tests
const mockChainConfig = {
  chainId: "cosmoshub-4",
  chainName: "Cosmos Hub",
  rpc: "https://rpc.cosmos.network",
  rest: "https://lcd.cosmos.network",
  stakeCurrency: {
    coinDenom: "ATOM",
    coinMinimalDenom: "uatom",
    coinDecimals: 6,
    coinGeckoId: "cosmos",
  },
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: "cosmos",
    bech32PrefixAccPub: "cosmospub",
    bech32PrefixValAddr: "cosmosvaloper",
    bech32PrefixValPub: "cosmosvaloperpub",
    bech32PrefixConsAddr: "cosmosvalcons",
    bech32PrefixConsPub: "cosmosvalconspub",
  },
  currencies: [
    {
      coinDenom: "ATOM",
      coinMinimalDenom: "uatom",
      coinDecimals: 6,
      coinGeckoId: "cosmos",
    },
  ],
  feeCurrencies: [
    {
      coinDenom: "ATOM",
      coinMinimalDenom: "uatom",
      coinDecimals: 6,
      coinGeckoId: "cosmos",
      gasPriceStep: {
        low: 0.01,
        average: 0.025,
        high: 0.04,
      },
    },
  ],
  features: ["ibc-transfer", "ibc-go"],
};

// Mock the chains module
vi.mock("../../chains/cosmos.js", () => ({
  getChainConfig: vi.fn().mockImplementation((chainId: string) => {
    if (chainId === "cosmoshub-4") {
      return mockChainConfig;
    }
    if (chainId === "phoenix-1") {
      return {
        chainId: "phoenix-1",
        chainName: "Terra",
        bech32Config: { bech32PrefixAccAddr: "terra" },
      };
    }
    return undefined;
  }),
  findChainByName: vi.fn().mockImplementation((name: string) => {
    if (name.toLowerCase() === "cosmos") {
      return mockChainConfig;
    }
    if (name.toLowerCase() === "osmo") {
      return {
        chainId: "osmosis-1",
        chainName: "Osmosis",
        bech32Config: { bech32PrefixAccAddr: "osmo" },
      };
    }
    return undefined;
  }),
  findChainByBech32Prefix: vi.fn().mockImplementation((prefix: string) => {
    if (prefix.toLowerCase() === "osmo") {
      return {
        chainId: "osmosis-1",
        chainName: "Osmosis",
        bech32Config: { bech32PrefixAccAddr: "osmo" },
      };
    }
    if (prefix.toLowerCase() === "cosmos") {
      return mockChainConfig;
    }
    return undefined;
  }),
  findAllChainsByName: vi.fn().mockImplementation((name: string) => {
    if (name.toLowerCase() === "cosmos") {
      return [mockChainConfig];
    }
    return [];
  }),
  getStakeMinimalDenom: vi.fn().mockImplementation((chain: unknown) => {
    return (
      (chain as { stakeCurrency?: { coinMinimalDenom?: string } })
        ?.stakeCurrency?.coinMinimalDenom ?? "uatom"
    );
  }),
  getStakeDecimals: vi.fn().mockImplementation((chain: unknown) => {
    return (
      (chain as { stakeCurrency?: { coinDecimals?: number } })?.stakeCurrency
        ?.coinDecimals ?? 6
    );
  }),
  getStakeDenom: vi.fn().mockImplementation((chain: unknown) => {
    return (
      (chain as { stakeCurrency?: { coinDenom?: string } })?.stakeCurrency
        ?.coinDenom ?? "ATOM"
    );
  }),
  getGasPrice: vi.fn().mockImplementation((chain: unknown) => {
    const fee = (
      chain as {
        feeCurrencies?: Array<{
          gasPriceStep?: { average?: number };
          coinMinimalDenom?: string;
        }>;
      }
    )?.feeCurrencies?.[0];
    const price = fee?.gasPriceStep?.average ?? 0.025;
    return `${price}${fee?.coinMinimalDenom ?? "uatom"}`;
  }),
  getBech32Prefix: vi.fn().mockImplementation((chain: unknown) => {
    return (
      (chain as { bech32Config?: { bech32PrefixAccAddr?: string } })
        ?.bech32Config?.bech32PrefixAccAddr ?? "cosmos"
    );
  }),
}));

// Mock the pending-action module
vi.mock("../../pending-action.js", () => ({
  storePending: vi.fn().mockReturnValue("mock-confirmation-token-123"),
}));

// Mock the store module for getTtlInfo
vi.mock("../../store.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../store.js")>();
  return {
    ...original,
    getTtlInfo: vi.fn().mockReturnValue({
      expiresIn: "5m 0s",
      expiresAt: Date.now() + 5 * 60 * 1000,
      ttlWarning:
        "The confirmation token will expire. Request the transaction again if it expires.",
    }),
  };
});

// Mock the format utils
vi.mock("../../utils/format.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../utils/format.js")>();
  return {
    ...original,
    formatCurrencyAmount: vi.fn().mockImplementation((amount, opts) => {
      const decimals = opts?.decimals ?? 6;
      const symbol = opts?.symbol ?? "";
      const value = Number(amount) / 10 ** decimals;
      return `${value} ${symbol}`.trim();
    }),
    parseGasPrice: vi.fn().mockReturnValue({
      amount: 0.025,
      denom: "uatom",
    }),
  };
});

// Mock the currency types
vi.mock("../../types/currency.js", () => ({
  getTokenDecimals: vi.fn().mockReturnValue(6),
}));

// Mock the skip-ibc module
const mockResolveIbcChannel = vi.fn();
vi.mock("../../utils/skip-ibc.js", () => ({
  resolveIbcChannelViaSkip: (...args: unknown[]) =>
    mockResolveIbcChannel(...args),
}));

describe("Cosmos Transaction Tools", () => {
  let mockServer: MockMcpServer;
  let mockStore: MockStore;
  let mockClient: MockCosmosClient;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockServer = createMockMcpServer();
    mockClient = createMockCosmosClient({
      getAddress: vi
        .fn()
        .mockResolvedValue("cosmos1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du"),
      getBalances: vi.fn().mockResolvedValue([
        { denom: "uatom", amount: "10000000" }, // 10 ATOM
      ]),
      simulateFee: vi.fn().mockResolvedValue({
        feeAmount: "5000",
        feeDenom: "uatom",
        gasEstimate: "200000",
      }),
    });
    mockStore = createMockStore({
      getClientFor: vi.fn().mockResolvedValue(mockClient),
    });

    // Import and register the transaction plugin
    const { default: transactionPlugin } = await import(
      "../../plugins/cosmos/transaction.js"
    );
    transactionPlugin.register(mockServer as any, mockStore as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("send-tokens", () => {
    it("should return pending_confirmation with preview", async () => {
      const tool = mockServer.getTool("send-tokens");
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1000000", // 1 ATOM
      });

      const parsed = parseToolResponse<{
        status: string;
        summary: string;
        chain: string;
        preview: {
          from: string;
          to: string;
          amount: { value: string; denom: string; formatted: string };
          estimatedFee: { value: string; denom: string };
          balanceBefore: { value: string };
          balanceAfter: { value: string };
        };
        confirmationToken: string;
        expiresIn: string;
        instruction: string;
      }>(result);

      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.summary).toContain("Send");
      // Summary now uses human-readable format: "1 ATOM" instead of "1000000 uatom"
      expect(parsed.summary).toContain("1 ATOM");
      expect(parsed.summary).toContain(
        "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
      );
      expect(parsed.chain).toBe("cosmoshub-4");

      // Check preview
      expect(parsed.preview.from).toBe(
        "cosmos1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du",
      );
      expect(parsed.preview.to).toBe(
        "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
      );
      expect(parsed.preview.amount.value).toBe("1000000");
      expect(parsed.preview.amount.denom).toBe("uatom");

      // Check confirmation token and expiry
      expect(parsed.confirmationToken).toBe("mock-confirmation-token-123");
      expect(parsed.expiresIn).toBeDefined();
      expect(parsed.instruction).toContain("confirm-action");
    });

    it("should include INSUFFICIENT_FOR_FEE warning when balance is low", async () => {
      const tool = mockServer.getTool("send-tokens");

      // Set low balance
      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "100000" }, // 0.1 ATOM (not enough for 1 ATOM + fees)
      ]);

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1000000", // 1 ATOM (more than balance)
      });

      const parsed = parseToolResponse<{
        preview: {
          warnings: Array<{
            level: string;
            code: string;
            message: string;
          }>;
        };
      }>(result);

      expect(parsed.preview.warnings).toBeDefined();
      const insufficientWarning = parsed.preview.warnings.find(
        (w) => w.code === "INSUFFICIENT_FOR_FEE",
      );
      expect(insufficientWarning).toBeDefined();
      expect(insufficientWarning!.level).toBe("critical");
    });

    it("should include LARGE_AMOUNT warning when using >90% of balance", async () => {
      const tool = mockServer.getTool("send-tokens");

      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "1000000" }, // 1 ATOM
      ]);

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "950000", // 0.95 ATOM (95% of balance)
      });

      const parsed = parseToolResponse<{
        preview: {
          warnings?: Array<{ code: string; level: string }>;
        };
      }>(result);

      // May include LARGE_AMOUNT warning
      if (parsed.preview.warnings) {
        const largeAmountWarning = parsed.preview.warnings.find(
          (w) => w.code === "LARGE_AMOUNT",
        );
        if (largeAmountWarning) {
          expect(largeAmountWarning.level).toBe("warning");
        }
      }
    });

    it("should use default denom when not specified", async () => {
      const tool = mockServer.getTool("send-tokens");

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1000000",
        // No denom specified
      });

      const parsed = parseToolResponse<{
        preview: {
          amount: { denom: string };
        };
      }>(result);

      // Should default to chain's minimalDenom (uatom)
      expect(parsed.preview.amount.denom).toBe("uatom");
    });

    it("should use custom denom when specified", async () => {
      const tool = mockServer.getTool("send-tokens");

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1000000",
        denom:
          "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2", // USDC via IBC
      });

      const parsed = parseToolResponse<{
        preview: {
          amount: { denom: string };
        };
      }>(result);

      expect(parsed.preview.amount.denom).toBe(
        "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
      );
    });
  });

  describe("delegate", () => {
    it("should return pending_confirmation for delegation", async () => {
      const tool = mockServer.getTool("delegate");
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        validatorAddress: "cosmosvaloper1abc...",
        amount: "1000000",
      });

      const parsed = parseToolResponse<{
        status: string;
        summary: string;
        preview: {
          from: string;
          to: string;
          amount: { value: string };
        };
        confirmationToken: string;
      }>(result);

      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.summary).toContain("Delegate");
      expect(parsed.summary).toContain("cosmosvaloper1abc...");
      expect(parsed.preview.to).toBe("cosmosvaloper1abc...");
      expect(parsed.confirmationToken).toBeDefined();
    });

    it("should include balance warnings for delegation", async () => {
      const tool = mockServer.getTool("delegate");

      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "500000" }, // 0.5 ATOM
      ]);

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        validatorAddress: "cosmosvaloper1abc...",
        amount: "1000000", // 1 ATOM (more than balance)
      });

      const parsed = parseToolResponse<{
        preview: {
          warnings?: Array<{ code: string }>;
        };
      }>(result);

      // Should have insufficient balance warning
      expect(parsed.preview.warnings).toBeDefined();
      expect(
        parsed.preview.warnings!.some((w) => w.code === "INSUFFICIENT_FOR_FEE"),
      ).toBe(true);
    });
  });

  describe("undelegate", () => {
    it("should include UNSTAKING_PERIOD warning", async () => {
      const tool = mockServer.getTool("undelegate");
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        validatorAddress: "cosmosvaloper1abc...",
        amount: "1000000",
      });

      const parsed = parseToolResponse<{
        status: string;
        summary: string;
        preview: {
          warnings?: Array<{ code: string; message: string }>;
        };
      }>(result);

      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.summary).toContain("Undelegate");

      // Should include unbonding period warning
      expect(parsed.preview.warnings).toBeDefined();
      const unstakingWarning = parsed.preview.warnings!.find(
        (w) => w.code === "UNSTAKING_PERIOD",
      );
      expect(unstakingWarning).toBeDefined();
      expect(unstakingWarning!.message).toContain("21 days");
    });
  });

  describe("claim-rewards", () => {
    it("should return pending_confirmation for reward claiming", async () => {
      const tool = mockServer.getTool("claim-rewards");
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        validatorAddress: "cosmosvaloper1abc...",
      });

      const parsed = parseToolResponse<{
        status: string;
        summary: string;
        preview: {
          from: string;
          to: string;
          estimatedFee: { value: string };
        };
        confirmationToken: string;
      }>(result);

      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.summary).toContain("Claim");
      expect(parsed.summary).toContain("cosmosvaloper1abc...");

      // Claim rewards doesn't have an amount, but should have estimated fee
      expect(parsed.preview.estimatedFee).toBeDefined();
      expect(parsed.confirmationToken).toBeDefined();
    });
  });

  describe("ibc-transfer", () => {
    it("should return pending_confirmation for IBC transfer", async () => {
      const tool = mockServer.getTool("ibc-transfer");
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        amount: "1000000",
        denom: "uatom",
        sourceChannel: "channel-0",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const parsed = parseToolResponse<{
        status: string;
        summary: string;
        preview: {
          to: string;
          amount: { value: string; denom: string };
        };
        confirmationToken: string;
      }>(result);

      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.summary).toContain("IBC transfer");
      expect(parsed.summary).toContain("channel-0");
      expect(parsed.preview.to).toBe(
        "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
      );
      expect(parsed.preview.amount.denom).toBe("uatom");
    });

    it("should reject non-existent IBC channel", async () => {
      const tool = mockServer.getTool("ibc-transfer");
      mockClient.verifyIbcChannel.mockResolvedValueOnce({
        exists: false,
        state: "NOT_FOUND",
      });

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        amount: "1000000",
        denom: "uatom",
        sourceChannel: "channel-99999",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("does not exist");
      expect(text).toContain("channel-99999");
    });

    it("should reject closed IBC channel", async () => {
      const tool = mockServer.getTool("ibc-transfer");
      mockClient.verifyIbcChannel.mockResolvedValueOnce({
        exists: true,
        state: "STATE_CLOSED",
      });

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        amount: "1000000",
        denom: "uatom",
        sourceChannel: "channel-141",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("not open");
      expect(text).toContain("STATE_CLOSED");
    });

    it("should reject destination chain IBC hash as denom", async () => {
      const tool = mockServer.getTool("ibc-transfer");

      // Agent passes destination chain IBC hash instead of source chain denom
      const destIbcHash =
        "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        amount: "1000000",
        denom: destIbcHash,
        sourceChannel: "channel-0",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("not found on source chain");
      expect(text).toContain("uatom");
    });

    it("should reject denom when source chain has no balances", async () => {
      const tool = mockServer.getTool("ibc-transfer");
      mockClient.getBalances.mockResolvedValueOnce([]);

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        amount: "1000000",
        denom: "uatom",
        sourceChannel: "channel-0",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("not found on source chain");
      expect(text).toContain("(no balances)");
    });

    it("should succeed with factory denom", async () => {
      const tool = mockServer.getTool("ibc-transfer");
      const factoryDenom =
        "factory/osmo1z6r6qdknhgsc0zeracktgpcxf43j6sekq07nw8sxduc9lg0qjjlqfu25e3/alloyed/allBTC";
      mockClient.getBalances.mockResolvedValueOnce([
        { denom: factoryDenom, amount: "100000000" },
      ]);

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        amount: "100000000",
        denom: factoryDenom,
        sourceChannel: "channel-0",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const parsed = parseToolResponse<{
        status: string;
        preview: {
          amount: { denom: string };
        };
      }>(result);

      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.preview.amount.denom).toBe(factoryDenom);
    });

    it("should succeed with correct native denom", async () => {
      const tool = mockServer.getTool("ibc-transfer");

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        amount: "1000000",
        denom: "uatom",
        sourceChannel: "channel-0",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const parsed = parseToolResponse<{
        status: string;
        preview: {
          amount: { denom: string };
        };
      }>(result);

      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.preview.amount.denom).toBe("uatom");
    });

    it("should auto-resolve sourceChannel via Skip API when omitted", async () => {
      const tool = mockServer.getTool("ibc-transfer");
      mockResolveIbcChannel.mockResolvedValueOnce({
        sourceChannel: "channel-141",
        port: "transfer",
      });

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        amount: "1000000",
        denom: "uatom",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const parsed = parseToolResponse<{
        status: string;
        summary: string;
      }>(result);

      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.summary).toContain("channel-141");
      expect(mockResolveIbcChannel).toHaveBeenCalledWith(
        "cosmoshub-4",
        "uatom",
        "osmosis-1",
      );
      expect(mockClient.verifyIbcChannel).not.toHaveBeenCalled();
    });

    it("should return error when Skip API fails and sourceChannel omitted", async () => {
      const tool = mockServer.getTool("ibc-transfer");
      mockResolveIbcChannel.mockRejectedValueOnce(
        new Error("Skip API unreachable: Network failure"),
      );

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        amount: "1000000",
        denom: "uatom",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("Failed to auto-resolve IBC channel");
    });

    it("should return error when dest chain cannot be determined from address prefix", async () => {
      const tool = mockServer.getTool("ibc-transfer");

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "juno1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr549pth",
        amount: "1000000",
        denom: "uatom",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("Cannot determine destination chain");
    });

    it("should return error when bech32 prefix is ambiguous", async () => {
      const tool = mockServer.getTool("ibc-transfer");
      const mockFindChain = vi.mocked(
        (await import("../../chains/cosmos.js")).findChainByBech32Prefix,
      );
      mockFindChain.mockImplementationOnce(() => {
        throw new Error(
          "Multiple chains share bech32 prefix 'terra': Terra Classic (columbus-5), Terra (phoenix-1). Specify destChain or sourceChannel explicitly.",
        );
      });

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "terra1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcryru6wt",
        amount: "1000000",
        denom: "uatom",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("Multiple chains share bech32 prefix");
    });

    it("should use destChain parameter to bypass bech32 resolution", async () => {
      const tool = mockServer.getTool("ibc-transfer");
      mockResolveIbcChannel.mockResolvedValueOnce({
        sourceChannel: "channel-209",
        port: "transfer",
      });

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "terra1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcryru6wt",
        amount: "1000000",
        denom: "uatom",
        destChain: "phoenix-1",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const parsed = parseToolResponse<{
        status: string;
        summary: string;
      }>(result);

      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.summary).toContain("channel-209");
      expect(mockResolveIbcChannel).toHaveBeenCalledWith(
        "cosmoshub-4",
        "uatom",
        "phoenix-1",
      );
    });
  });

  describe("vote-governance", () => {
    it("should return pending_confirmation for governance vote", async () => {
      const tool = mockServer.getTool("vote-governance");
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        proposalId: "123",
        option: "yes",
      });

      const parsed = parseToolResponse<{
        status: string;
        summary: string;
        confirmationToken: string;
      }>(result);

      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.summary).toContain('Vote "yes"');
      expect(parsed.summary).toContain("proposal #123");
      expect(parsed.confirmationToken).toBeDefined();
    });

    it("should support all vote options", async () => {
      const tool = mockServer.getTool("vote-governance");

      const voteOptions = ["yes", "no", "abstain", "no_with_veto"];

      for (const option of voteOptions) {
        const result = await tool!.handler({
          chain: "cosmoshub-4",
          proposalId: "123",
          option,
        });

        const parsed = parseToolResponse<{ summary: string }>(result);
        expect(parsed.summary).toContain(`Vote "${option}"`);
      }
    });
  });

  describe("Fee Estimation Fallback", () => {
    it("should use default fee when simulation fails", async () => {
      const tool = mockServer.getTool("send-tokens");

      // Make simulateFee fail
      mockClient.simulateFee.mockRejectedValueOnce(
        new Error("Account not found"),
      );

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1000000",
      });

      const parsed = parseToolResponse<{
        preview: {
          estimatedFee: { value: string; denom: string };
        };
      }>(result);

      // Should still have an estimated fee (fallback)
      expect(parsed.preview.estimatedFee).toBeDefined();
      expect(parsed.preview.estimatedFee.denom).toBe("uatom");
    });
  });

  describe("Error Handling", () => {
    it("should return error response for unknown chains", async () => {
      const tool = mockServer.getTool("send-tokens");

      const { getChainConfig, findAllChainsByName } = await import(
        "../../chains/cosmos.js"
      );
      vi.mocked(getChainConfig).mockReturnValueOnce(undefined);
      vi.mocked(findAllChainsByName).mockReturnValueOnce([]);

      const result = (await tool!.handler({
        chain: "unknown-chain",
        recipientAddress: "cosmos1...",
        amount: "1000000",
      })) as { content: { type: string; text: string }[]; isError?: boolean };

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text as string);
      expect(response.isError).toBe(true);
      expect(response.message).toContain("Unknown chain");
    });

    it("should return setup_required response when no wallet configured", async () => {
      const tool = mockServer.getTool("delegate");

      mockStore.getClientFor.mockRejectedValueOnce(
        new Error("No mnemonic configured"),
      );

      const result = (await tool!.handler({
        chain: "cosmoshub-4",
        validatorAddress: "cosmosvaloper1...",
        amount: "1000000",
      })) as { content: { type: string; text: string }[]; isError?: boolean };

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text as string);
      expect(response.status).toBe("setup_required");
      expect(response.setupGuide).toBeDefined();
      expect(response.setupGuide.options).toBeDefined();
    });
  });

  describe("Elicitation Flow", () => {
    it("should always return pending_confirmation even when elicitation is supported", async () => {
      // Elicitation is deferred to confirm-action, so send-tokens
      // always returns a confirmation token regardless of client capabilities.
      const elicitServer = createMockMcpServer({ elicitationSupported: true });

      // Re-register tools with the new server
      const transactionPlugin = (
        await import("../../plugins/cosmos/transaction.js")
      ).default;
      await transactionPlugin.register(
        elicitServer as unknown as Parameters<
          typeof transactionPlugin.register
        >[0],
        mockStore as unknown as Parameters<
          typeof transactionPlugin.register
        >[1],
      );

      const tool = elicitServer.getTool("send-tokens");
      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1 ATOM",
      });

      const parsed = parseToolResponse<{
        status: string;
        confirmationToken?: string;
      }>(result);

      // Should return pending_confirmation (elicitation happens at confirm-action)
      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.confirmationToken).toBeDefined();
    });

    it("should fall back to token flow when user does not confirm via elicitation", async () => {
      // Create a new mock server with elicitation support
      const elicitServer = createMockMcpServer({ elicitationSupported: true });
      elicitServer.server.elicitInput.mockResolvedValue({
        action: "accept",
        content: { confirmed: false }, // User unchecked the confirmation box or auto-submitted
      });

      // Re-register tools with the new server
      const transactionPlugin = (
        await import("../../plugins/cosmos/transaction.js")
      ).default;
      await transactionPlugin.register(
        elicitServer as unknown as Parameters<
          typeof transactionPlugin.register
        >[0],
        mockStore as unknown as Parameters<
          typeof transactionPlugin.register
        >[1],
      );

      const tool = elicitServer.getTool("send-tokens");
      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1 ATOM",
      });

      const parsed = parseToolResponse<{
        status: string;
        confirmationToken?: string;
      }>(result);

      // Should fall back to confirmation token flow (not cancelled)
      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.confirmationToken).toBeDefined();
    });

    it("should pass resolved minimal denom to sendTokens", async () => {
      const { storePending } = await import("../../pending-action.js");
      const storePendingMock = vi.mocked(storePending);

      const tool = mockServer.getTool("send-tokens");
      await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1 ATOM",
      });

      // Extract the execute closure stored by storePending and invoke it
      const executeClosure = storePendingMock.mock.calls.at(-1)?.[2] as
        | (() => Promise<unknown>)
        | undefined;
      expect(executeClosure).toBeDefined();
      await executeClosure!();

      // Verify sendTokens was called with resolved minimal denom "uatom", not display denom "ATOM"
      expect(mockClient.sendTokens).toHaveBeenCalledWith(
        expect.anything(),
        "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        "1000000",
        "uatom",
        expect.anything(),
      );
    });

    it("should pass resolved minimal denom to ibcTransfer", async () => {
      const { storePending } = await import("../../pending-action.js");
      const storePendingMock = vi.mocked(storePending);

      const tool = mockServer.getTool("ibc-transfer");
      await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        amount: "1 ATOM",
        sourceChannel: "channel-0",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      // Extract the execute closure stored by storePending and invoke it
      const executeClosure = storePendingMock.mock.calls.at(-1)?.[2] as
        | (() => Promise<unknown>)
        | undefined;
      expect(executeClosure).toBeDefined();
      await executeClosure!();

      // Verify ibcTransfer was called with resolved minimal denom "uatom"
      expect(mockClient.ibcTransfer).toHaveBeenCalledWith(
        expect.anything(),
        "osmo1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr2u426e",
        "1000000",
        "uatom",
        "transfer",
        "channel-0",
        10,
      );
    });

    it("should fall back to confirmation token when elicitation is not supported", async () => {
      // Use the default mock server (elicitation not supported)
      const tool = mockServer.getTool("send-tokens");
      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1 ATOM",
      });

      const parsed = parseToolResponse<{
        status: string;
        confirmationToken?: string;
      }>(result);

      // Should return pending_confirmation with token
      expect(parsed.status).toBe("pending_confirmation");
      expect(parsed.confirmationToken).toBeDefined();
    });
  });

  describe("Gas Token Exhaustion Guard", () => {
    it("should warn when send-tokens would exhaust gas token (sendDenom === feeDenom)", async () => {
      const tool = mockServer.getTool("send-tokens");

      // Balance: 1 ATOM. Sending 0.99 ATOM. Fee: 5000 uatom.
      // Remaining: 1000000 - 990000 - 5000 = 5000 uatom
      // Reserve needed: 5000 * 3 = 15000 uatom. 5000 < 15000 → warning
      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "1000000" },
      ]);

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "990000",
      });

      const parsed = parseToolResponse<{
        preview: {
          warnings?: Array<{ code: string; level: string; message: string }>;
        };
        suggestedActions?: Array<{
          tool: string;
          reason: string;
          params?: Record<string, unknown>;
        }>;
      }>(result);

      const exhaustionWarning = parsed.preview.warnings?.find(
        (w) => w.code === "GAS_TOKEN_EXHAUSTION",
      );
      expect(exhaustionWarning).toBeDefined();
      expect(exhaustionWarning!.level).toBe("warning");
      expect(exhaustionWarning!.message).toContain("future transactions");
    });

    it("should emit critical warning when remaining balance would be negative", async () => {
      const tool = mockServer.getTool("send-tokens");

      // Balance: 1 ATOM. Sending 0.999 ATOM. Fee: 5000 uatom.
      // Remaining: 1000000 - 999000 - 5000 = -4000 → critical
      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "1000000" },
      ]);

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "999000",
      });

      const parsed = parseToolResponse<{
        preview: {
          warnings?: Array<{ code: string; level: string; message: string }>;
        };
      }>(result);

      const exhaustionWarning = parsed.preview.warnings?.find(
        (w) => w.code === "GAS_TOKEN_EXHAUSTION",
      );
      expect(exhaustionWarning).toBeDefined();
      expect(exhaustionWarning!.level).toBe("critical");
      expect(exhaustionWarning!.message).toContain("zero");
    });

    it("should not warn when sufficient gas reserve remains", async () => {
      const tool = mockServer.getTool("send-tokens");

      // Balance: 10 ATOM. Sending 1 ATOM. Fee: 5000 uatom.
      // Remaining: 10000000 - 1000000 - 5000 = 8995000 >> 15000 → no warning
      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1000000",
      });

      const parsed = parseToolResponse<{
        preview: {
          warnings?: Array<{ code: string }>;
        };
      }>(result);

      const exhaustionWarning = parsed.preview.warnings?.find(
        (w) => w.code === "GAS_TOKEN_EXHAUSTION",
      );
      expect(exhaustionWarning).toBeUndefined();
    });

    it("should include suggestedActions with reduced safe amount", async () => {
      const tool = mockServer.getTool("send-tokens");

      // Balance: 1 ATOM. Sending 0.99 ATOM.
      // Safe amount = 1000000 - 5000 - 15000 = 980000
      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "1000000" },
      ]);

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "990000",
      });

      const parsed = parseToolResponse<{
        suggestedActions?: Array<{
          tool: string;
          reason: string;
          params?: Record<string, unknown>;
        }>;
      }>(result);

      expect(parsed.suggestedActions).toBeDefined();
      const reduceAction = parsed.suggestedActions?.find((a) =>
        a.reason.includes("Reduce amount"),
      );
      expect(reduceAction).toBeDefined();
      expect(reduceAction!.params?.amount).toBe("980000");
    });

    it("should warn for ibc-transfer that would exhaust gas token", async () => {
      const tool = mockServer.getTool("ibc-transfer");

      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "1000000" },
      ]);
      mockClient.verifyIbcChannel.mockResolvedValueOnce({
        exists: true,
        state: "STATE_OPEN",
      });

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "990000",
        denom: "uatom",
        sourceChannel: "channel-0",
        sourcePort: "transfer",
        timeoutMinutes: 10,
      });

      const parsed = parseToolResponse<{
        preview: {
          warnings?: Array<{ code: string }>;
        };
      }>(result);

      const exhaustionWarning = parsed.preview.warnings?.find(
        (w) => w.code === "GAS_TOKEN_EXHAUSTION",
      );
      expect(exhaustionWarning).toBeDefined();
    });

    it("should not warn when sendDenom differs from feeDenom and fee token is healthy", async () => {
      const tool = mockServer.getTool("send-tokens");

      // Sending IBC token, fee paid in uatom (10 ATOM — plenty)
      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "10000000" },
        { denom: "ibc/1234", amount: "5000000" },
      ]);

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "5000000",
        denom: "ibc/1234",
      });

      const parsed = parseToolResponse<{
        preview: {
          warnings?: Array<{ code: string }>;
        };
      }>(result);

      const exhaustionWarning = parsed.preview.warnings?.find(
        (w) => w.code === "GAS_TOKEN_EXHAUSTION",
      );
      expect(exhaustionWarning).toBeUndefined();
    });

    it("should coexist with INSUFFICIENT_FOR_FEE warning", async () => {
      const tool = mockServer.getTool("send-tokens");

      // Balance: 0.1 ATOM. Sending 1 ATOM → insufficient + exhaustion
      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "100000" },
      ]);

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        recipientAddress: "cosmos1qgpqyqszqgpqyqszqgpqyqszqgpqyqszrh8mx2",
        amount: "1000000",
      });

      const parsed = parseToolResponse<{
        preview: {
          warnings?: Array<{ code: string; level: string }>;
        };
      }>(result);

      const insufficientWarning = parsed.preview.warnings?.find(
        (w) => w.code === "INSUFFICIENT_FOR_FEE",
      );
      expect(insufficientWarning).toBeDefined();
      expect(insufficientWarning!.level).toBe("critical");

      const exhaustionWarning = parsed.preview.warnings?.find(
        (w) => w.code === "GAS_TOKEN_EXHAUSTION",
      );
      expect(exhaustionWarning).toBeDefined();
    });
  });
});
