/**
 * Unit tests for Cosmos query tools.
 *
 * Tests cover:
 * - list-cosmos-chains: Chain listing
 * - get-cosmos-address: Address retrieval
 * - get-balances: Balance queries with suggestedActions
 * - get-staking-info: Staking info with suggestedActions
 * - setup_required handling
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

import {
  createChainsMock,
  mockCosmosChain,
  mockOsmosisChain,
} from "../helpers/chain-mocks.js";

vi.mock("../../chains/cosmos.js", () =>
  createChainsMock({
    "cosmoshub-4": mockCosmosChain,
    "osmosis-1": mockOsmosisChain,
  }),
);

// Mock the accounts module
vi.mock("../../accounts.js", () => ({
  getActiveMnemonic: vi.fn().mockResolvedValue("test mnemonic"),
}));

describe("Cosmos Query Tools", () => {
  let mockServer: MockMcpServer;
  let mockStore: MockStore;
  let mockClient: MockCosmosClient;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockServer = createMockMcpServer();
    mockClient = createMockCosmosClient();
    mockStore = createMockStore({
      getClientFor: vi.fn().mockResolvedValue(mockClient),
    });

    // Import and register the query plugin
    const { default: queryPlugin } = await import(
      "../../plugins/cosmos/query.js"
    );
    queryPlugin.register(mockServer as any, mockStore as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list-cosmos-chains", () => {
    it("should return list of supported chains", async () => {
      const tool = mockServer.getTool("list-cosmos-chains");
      expect(tool).toBeDefined();

      const result = await tool!.handler({});
      const parsed = parseToolResponse<{
        count: number;
        chains: Array<{
          chainId: string;
          name: string;
          denom: string;
          bech32Prefix: string;
        }>;
        suggestedActions: Array<{
          tool: string;
          reason: string;
          priority: number;
        }>;
      }>(result);

      expect(parsed.count).toBe(2);
      expect(parsed.chains).toHaveLength(2);
      expect(parsed.chains[0]).toMatchObject({
        chainId: "cosmoshub-4",
        name: "Cosmos Hub",
        denom: "ATOM",
      });
      expect(parsed.chains[1]).toMatchObject({
        chainId: "osmosis-1",
        name: "Osmosis",
        denom: "OSMO",
      });
      expect(parsed.suggestedActions).toBeDefined();
      expect(parsed.suggestedActions.length).toBeGreaterThan(0);
    });
  });

  describe("get-cosmos-address", () => {
    it("should return address for a chain", async () => {
      const tool = mockServer.getTool("get-cosmos-address");
      expect(tool).toBeDefined();

      mockClient.getAddress.mockResolvedValueOnce("cosmos1abc123...");

      const result = await tool!.handler({ chain: "cosmoshub-4" });
      const parsed = parseToolResponse<{
        chainId: string;
        chainName: string;
        address: string;
        bech32Prefix: string;
      }>(result);

      expect(parsed.chainId).toBe("cosmoshub-4");
      expect(parsed.chainName).toBe("Cosmos Hub");
      expect(parsed.address).toBe("cosmos1abc123...");
      expect(parsed.bech32Prefix).toBe("cosmos");
    });

    it("should return setup_required when no wallet configured", async () => {
      const tool = mockServer.getTool("get-cosmos-address");
      mockStore.getClientFor.mockRejectedValueOnce(
        new Error("No mnemonic configured. Use create-account to get started."),
      );

      const result = await tool!.handler({ chain: "cosmoshub-4" });
      const parsed = parseToolResponse<{
        status: string;
        message: string;
        setupGuide: { options: Array<{ tool: string }> };
      }>(result);

      expect(parsed.status).toBe("setup_required");
      expect(parsed.setupGuide).toBeDefined();
      expect(parsed.setupGuide.options).toHaveLength(2);
    });
  });

  describe("get-balances", () => {
    it("should return balances with suggestedActions when balance exists", async () => {
      const tool = mockServer.getTool("get-balances");
      expect(tool).toBeDefined();

      mockClient.getAddress.mockResolvedValueOnce("cosmos1abc123...");
      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "5000000" },
      ]);

      const result = await tool!.handler({ chain: "cosmoshub-4" });
      const parsed = parseToolResponse<{
        address: string;
        chainId: string;
        balances: Array<{ denom: string; amount: string }>;
        suggestedActions: Array<{
          tool: string;
          reason: string;
          priority: number;
        }>;
      }>(result);

      expect(parsed.address).toBe("cosmos1abc123...");
      expect(parsed.chainId).toBe("cosmoshub-4");
      expect(parsed.balances).toHaveLength(1);
      expect(parsed.balances[0].amount).toBe("5000000");

      // Should suggest staking and sending when balance exists
      expect(parsed.suggestedActions).toBeDefined();
      expect(parsed.suggestedActions.length).toBeGreaterThan(0);

      const stakingAction = parsed.suggestedActions.find(
        (a) => a.tool === "get-staking-info",
      );
      expect(stakingAction).toBeDefined();

      const delegateAction = parsed.suggestedActions.find(
        (a) => a.tool === "delegate",
      );
      expect(delegateAction).toBeDefined();

      const sendAction = parsed.suggestedActions.find(
        (a) => a.tool === "send-tokens",
      );
      expect(sendAction).toBeDefined();
    });

    it("should suggest get-cosmos-address when balance is zero", async () => {
      const tool = mockServer.getTool("get-balances");

      mockClient.getAddress.mockResolvedValueOnce("cosmos1abc123...");
      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uatom", amount: "0" },
      ]);

      const result = await tool!.handler({ chain: "cosmoshub-4" });
      const parsed = parseToolResponse<{
        balances: Array<{ denom: string; amount: string }>;
        suggestedActions: Array<{ tool: string; reason: string }>;
      }>(result);

      expect(parsed.balances[0].amount).toBe("0");

      // Should suggest getting address to receive tokens
      const addressAction = parsed.suggestedActions.find(
        (a) => a.tool === "get-cosmos-address",
      );
      expect(addressAction).toBeDefined();
      expect(addressAction!.reason).toContain("receive tokens");
    });

    it("should suggest osmosis-swap on Osmosis chain", async () => {
      const tool = mockServer.getTool("get-balances");

      // Update mock for Osmosis chain
      const { getChainConfig } = await import("../../chains/cosmos.js");
      vi.mocked(getChainConfig).mockReturnValueOnce({
        chainId: "osmosis-1",
        chainName: "Osmosis",
        denom: "OSMO",
        minimalDenom: "uosmo",
        decimals: 6,
        bech32Prefix: "osmo",
        gasPrice: "0.025uosmo",
      } as any);

      mockClient.getAddress.mockResolvedValueOnce("osmo1abc123...");
      mockClient.getBalances.mockResolvedValueOnce([
        { denom: "uosmo", amount: "10000000" },
      ]);

      const result = await tool!.handler({ chain: "osmosis-1" });
      const parsed = parseToolResponse<{
        chainId: string;
        suggestedActions: Array<{ tool: string }>;
      }>(result);

      expect(parsed.chainId).toBe("osmosis-1");

      // Should suggest osmosis-swap on Osmosis
      const swapAction = parsed.suggestedActions.find(
        (a) => a.tool === "osmosis-swap",
      );
      expect(swapAction).toBeDefined();
    });

    it("should return setup_required when no wallet configured", async () => {
      const tool = mockServer.getTool("get-balances");
      mockStore.getClientFor.mockRejectedValueOnce(
        new Error("No mnemonic configured. Use import-account to restore."),
      );

      const result = await tool!.handler({ chain: "cosmoshub-4" });
      const parsed = parseToolResponse<{
        status: string;
        setupGuide: { options: Array<{ tool: string }> };
      }>(result);

      expect(parsed.status).toBe("setup_required");
      expect(parsed.setupGuide.options.map((o) => o.tool)).toContain(
        "create-account",
      );
    });
  });

  describe("get-staking-info", () => {
    it("should return staking info with suggestedActions", async () => {
      const tool = mockServer.getTool("get-staking-info");
      expect(tool).toBeDefined();

      mockClient.getAddress.mockResolvedValueOnce("cosmos1abc123...");
      mockClient.getDelegations.mockResolvedValueOnce([
        {
          validatorAddress: "cosmosvaloper1xyz...",
          balance: { denom: "uatom", amount: "1000000" },
        },
      ]);
      mockClient.getRewards.mockResolvedValueOnce([
        {
          validatorAddress: "cosmosvaloper1xyz...",
          rewards: [{ denom: "uatom", amount: "50000.5" }],
        },
      ]);

      const result = await tool!.handler({ chain: "cosmoshub-4" });
      const parsed = parseToolResponse<{
        address: string;
        chainId: string;
        delegations: Array<{
          validatorAddress: string;
          balance: { denom: string; amount: string };
        }>;
        rewards: Array<{
          validatorAddress: string;
          rewards: Array<{ denom: string; amount: string }>;
        }>;
        suggestedActions: Array<{ tool: string; reason: string }>;
      }>(result);

      expect(parsed.address).toBe("cosmos1abc123...");
      expect(parsed.delegations).toHaveLength(1);
      expect(parsed.rewards).toHaveLength(1);

      // Should suggest claiming rewards when rewards exist
      const claimAction = parsed.suggestedActions.find(
        (a) => a.tool === "claim-rewards",
      );
      expect(claimAction).toBeDefined();
      expect(claimAction!.reason).toContain("pending staking rewards");

      // Should suggest undelegating when delegations exist
      const undelegateAction = parsed.suggestedActions.find(
        (a) => a.tool === "undelegate",
      );
      expect(undelegateAction).toBeDefined();
    });

    it("should suggest delegating when no delegations", async () => {
      const tool = mockServer.getTool("get-staking-info");

      mockClient.getAddress.mockResolvedValueOnce("cosmos1abc123...");
      mockClient.getDelegations.mockResolvedValueOnce([]);
      mockClient.getRewards.mockResolvedValueOnce([]);

      const result = await tool!.handler({ chain: "cosmoshub-4" });
      const parsed = parseToolResponse<{
        delegations: Array<unknown>;
        suggestedActions: Array<{ tool: string; reason: string }>;
      }>(result);

      expect(parsed.delegations).toHaveLength(0);

      // Should suggest starting to stake
      const delegateAction = parsed.suggestedActions.find(
        (a) => a.tool === "delegate",
      );
      expect(delegateAction).toBeDefined();
      expect(delegateAction!.reason).toContain("Start staking");
    });

    it("should not suggest claim when rewards are zero", async () => {
      const tool = mockServer.getTool("get-staking-info");

      mockClient.getAddress.mockResolvedValueOnce("cosmos1abc123...");
      mockClient.getDelegations.mockResolvedValueOnce([
        {
          validatorAddress: "cosmosvaloper1xyz...",
          balance: { denom: "uatom", amount: "1000000" },
        },
      ]);
      mockClient.getRewards.mockResolvedValueOnce([
        {
          validatorAddress: "cosmosvaloper1xyz...",
          rewards: [{ denom: "uatom", amount: "0" }],
        },
      ]);

      const result = await tool!.handler({ chain: "cosmoshub-4" });
      const parsed = parseToolResponse<{
        suggestedActions: Array<{ tool: string }>;
      }>(result);

      // Should NOT suggest claiming when rewards are zero
      const claimAction = parsed.suggestedActions.find(
        (a) => a.tool === "claim-rewards",
      );
      expect(claimAction).toBeUndefined();
    });

    it("should return setup_required when no wallet configured", async () => {
      const tool = mockServer.getTool("get-staking-info");
      mockStore.getClientFor.mockRejectedValueOnce(
        new Error(
          "No mnemonic configured. Use create-account or import-account to set up a wallet.",
        ),
      );

      const result = await tool!.handler({ chain: "cosmoshub-4" });
      const parsed = parseToolResponse<{
        status: string;
        setupGuide: object;
      }>(result);

      expect(parsed.status).toBe("setup_required");
      expect(parsed.setupGuide).toBeDefined();
    });

    it("should return not_supported for chains without native staking module", async () => {
      const tool = mockServer.getTool("get-staking-info");
      mockClient.getDelegations.mockRejectedValueOnce(
        new Error("unknown query path"),
      );
      mockClient.getRewards.mockRejectedValueOnce(
        new Error("unknown query path"),
      );

      const result = await tool!.handler({ chain: "cosmoshub-4" });
      const parsed = parseToolResponse<{
        status: string;
        chainId: string;
        reason: string;
        delegations: unknown[];
        rewards: unknown[];
        suggestedActions: Array<{ tool: string }>;
      }>(result);

      expect(parsed.status).toBe("not_supported");
      expect(parsed.chainId).toBe("cosmoshub-4");
      expect(parsed.reason).toContain("not available");
      expect(parsed.delegations).toEqual([]);
      expect(parsed.rewards).toEqual([]);
      expect(parsed.suggestedActions).toBeDefined();
      expect(
        parsed.suggestedActions.find((a) => a.tool === "get-balances"),
      ).toBeDefined();
      // Should suggest cosmwasm-list-contracts instead of cosmwasm-query
      expect(
        parsed.suggestedActions.find(
          (a) => a.tool === "cosmwasm-list-contracts",
        ),
      ).toBeDefined();
      expect(
        parsed.suggestedActions.find((a) => a.tool === "cosmwasm-query"),
      ).toBeUndefined();
    });

    it("should still return generic error for non-staking query failures", async () => {
      const tool = mockServer.getTool("get-staking-info");
      mockClient.getDelegations.mockRejectedValueOnce(
        new Error("Network timeout"),
      );
      mockClient.getRewards.mockRejectedValueOnce(new Error("Network timeout"));

      const result = (await tool!.handler({ chain: "cosmoshub-4" })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.isError).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should classify non-setup errors", async () => {
      const tool = mockServer.getTool("get-balances");
      mockStore.getClientFor.mockRejectedValueOnce(
        new Error("Network timeout"),
      );

      const result = (await tool!.handler({ chain: "cosmoshub-4" })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.isError).toBe(true);
      expect(parsed.message).toContain("Network timeout");
    });

    it("should handle unknown chain errors", async () => {
      const tool = mockServer.getTool("get-cosmos-address");

      // Mock chain resolution to throw for unknown chains
      const { getChainConfig, findAllChainsByName } = await import(
        "../../chains/cosmos.js"
      );
      vi.mocked(getChainConfig).mockReturnValueOnce(undefined);
      vi.mocked(findAllChainsByName).mockReturnValueOnce([]);

      const result = (await tool!.handler({ chain: "unknown-chain" })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.isError).toBe(true);
    });
  });
});
