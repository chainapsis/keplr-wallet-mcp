/**
 * Tests for well-known liquid staking token (LST) identification.
 *
 * Verifies that:
 * - LST balances are identified and annotated in get-balances
 * - Exit strategies are suggested (IBC transfer, send)
 * - Zero-amount LSTs are skipped
 * - Non-LST tokens on LST-registered chains are unaffected
 * - Chains without registered LSTs return no positions
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWellKnownLsts,
  matchLstBalances,
} from "../../plugins/cosmos/well-known-lst.js";
import {
  createChainsMock,
  mockCosmosChain,
  mockNeutronChain,
} from "../helpers/chain-mocks.js";
import {
  createMockCosmosClient,
  createMockMcpServer,
  createMockStore,
  type MockCosmosClient,
  type MockMcpServer,
  type MockStore,
  parseToolResponse,
} from "../helpers/mocks.js";

vi.mock("../../chains/cosmos.js", () =>
  createChainsMock({
    "neutron-1": mockNeutronChain,
    "cosmoshub-4": mockCosmosChain,
  }),
);

vi.mock("../../accounts.js", () => ({
  getActiveMnemonic: vi.fn().mockResolvedValue("test mnemonic"),
}));

interface LstPosition {
  protocol: string;
  description: string;
  underlyingAsset: string;
  displayDenom: string;
  displayAmount: string;
  denom: string;
  suggestedActions: Array<{
    tool: string;
    reason: string;
    params?: Record<string, string>;
    priority: number;
  }>;
}

// ---------------------------------------------------------------------------
// Unit tests for matchLstBalances
// ---------------------------------------------------------------------------

describe("matchLstBalances", () => {
  it("should match dNTRN by displayDenom", () => {
    const positions = matchLstBalances("neutron-1", [
      {
        denom: "factory/neutron1abc.../udntrn",
        amount: "5000000",
        displayDenom: "dNTRN",
        displayAmount: "5",
      },
    ]);

    expect(positions).toHaveLength(1);
    expect(positions[0].protocol).toBe("Drop Protocol");
    expect(positions[0].underlyingAsset).toBe("NTRN");
    expect(positions[0].displayAmount).toBe("5");
    expect(positions[0].suggestedActions).toHaveLength(2);
    expect(positions[0].suggestedActions[0].tool).toBe("ibc-transfer");
    expect(positions[0].suggestedActions[1].tool).toBe("send-tokens");
  });

  it("should match dNTRN by denomContains", () => {
    const positions = matchLstBalances("neutron-1", [
      {
        denom: "factory/neutron1xyz.../udntrn",
        amount: "1000000",
        displayDenom: "UNKNOWN-TOKEN",
        displayAmount: "1",
      },
    ]);

    expect(positions).toHaveLength(1);
    expect(positions[0].protocol).toBe("Drop Protocol");
  });

  it("should skip zero-amount LSTs", () => {
    const positions = matchLstBalances("neutron-1", [
      {
        denom: "factory/neutron1abc.../udntrn",
        amount: "0",
        displayDenom: "dNTRN",
        displayAmount: "0",
      },
    ]);

    expect(positions).toHaveLength(0);
  });

  it("should return empty for non-LST tokens on Neutron", () => {
    const positions = matchLstBalances("neutron-1", [
      {
        denom: "untrn",
        amount: "10000000",
        displayDenom: "NTRN",
        displayAmount: "10",
      },
    ]);

    expect(positions).toHaveLength(0);
  });

  it("should return empty for chains without registered LSTs", () => {
    const positions = matchLstBalances("cosmoshub-4", [
      {
        denom: "uatom",
        amount: "5000000",
        displayDenom: "ATOM",
        displayAmount: "5",
      },
    ]);

    expect(positions).toHaveLength(0);
  });

  it("should match supervault LP by denomContains (contract address)", () => {
    const balances = [
      {
        denom:
          "factory/neutron16jdl03kz2ggrdm90lu3t4hdqj3tpc808r06nrcpnf0xun9wuqaws7qw42x/USDC-NTRN",
        amount: "1000000",
        displayDenom: "NTRN-USDC",
        displayAmount: "1",
      },
    ];
    const positions = matchLstBalances("neutron-1", balances);
    expect(positions).toHaveLength(1);
    expect(positions[0].protocol).toBe("Neutron Supervault (NTRN-USDC)");
    expect(positions[0].frontendUrl).toBe(
      "https://app.neutron.org/supervaults",
    );
    expect(positions[0].suggestedActions).toHaveLength(1);
    expect(positions[0].suggestedActions[0].tool).toBe("cosmwasm-execute");
  });

  it("should use rawAmount (not displayAmount) in supervault withdraw executeMsg", () => {
    const balances = [
      {
        denom:
          "factory/neutron16jdl03kz2ggrdm90lu3t4hdqj3tpc808r06nrcpnf0xun9wuqaws7qw42x/USDC-NTRN",
        amount: "1000000",
        displayDenom: "NTRN-USDC",
        displayAmount: "1",
      },
    ];
    const positions = matchLstBalances("neutron-1", balances);
    const params = positions[0].suggestedActions[0].params as Record<
      string,
      string
    >;
    const executeMsg = JSON.parse(params.executeMsg);
    expect(executeMsg).toEqual({ withdraw: { amount: "1000000" } });
  });

  it("should propagate frontendUrl for dNTRN", () => {
    const balances = [
      {
        denom: "factory/neutron1dropcontract/udntrn",
        amount: "5000000",
        displayDenom: "dNTRN",
        displayAmount: "5",
      },
    ];
    const positions = matchLstBalances("neutron-1", balances);
    expect(positions[0].frontendUrl).toBe("https://app.drop-protocol.org");
  });

  it("should detect multiple supervaults simultaneously", () => {
    const balances = [
      {
        denom:
          "factory/neutron16jdl03kz2ggrdm90lu3t4hdqj3tpc808r06nrcpnf0xun9wuqaws7qw42x/USDC-NTRN",
        amount: "1000000",
        displayDenom: "NTRN-USDC",
        displayAmount: "1",
      },
      {
        denom:
          "factory/neutron1z4qky902yes9zl5eruwgdd2pgtlyeglunc0escf0a7n2xeyw97gqcr7u5u/BTC-USDC",
        amount: "500000",
        displayDenom: "wBTC-USDC",
        displayAmount: "0.5",
      },
      {
        denom: "untrn",
        amount: "10000000",
        displayDenom: "NTRN",
        displayAmount: "10",
      },
    ];
    const positions = matchLstBalances("neutron-1", balances);
    expect(positions).toHaveLength(2);
    expect(positions[0].protocol).toBe("Neutron Supervault (NTRN-USDC)");
    expect(positions[1].protocol).toBe("Neutron Supervault (wBTC-USDC)");
  });

  it("should handle mixed balances — only annotate LSTs", () => {
    const positions = matchLstBalances("neutron-1", [
      {
        denom: "untrn",
        amount: "10000000",
        displayDenom: "NTRN",
        displayAmount: "10",
      },
      {
        denom: "factory/neutron1abc.../udntrn",
        amount: "3000000",
        displayDenom: "dNTRN",
        displayAmount: "3",
      },
      {
        denom: "ibc/ABC123",
        amount: "2000000",
        displayDenom: "USDC",
        displayAmount: "2",
      },
    ]);

    expect(positions).toHaveLength(1);
    expect(positions[0].displayDenom).toBe("dNTRN");
  });
});

describe("getWellKnownLsts", () => {
  it("should return definitions for neutron-1", () => {
    const defs = getWellKnownLsts("neutron-1");
    expect(defs).toHaveLength(15);
    expect(defs[0].protocol).toBe("Drop Protocol");
    expect(defs[0].displayDenom).toBe("dNTRN");
  });

  it("should return empty for unknown chains", () => {
    expect(getWellKnownLsts("unknown-chain")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: get-balances with LST annotation
// ---------------------------------------------------------------------------

describe("LST annotation in get-balances", () => {
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

    const { default: queryPlugin } = await import(
      "../../plugins/cosmos/query.js"
    );
    queryPlugin.register(mockServer as any, mockStore as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should include liquidStakingPositions when dNTRN is in balances", async () => {
    const tool = mockServer.getTool("get-balances");
    expect(tool).toBeDefined();

    mockClient.getAddress.mockResolvedValueOnce("neutron1user...");
    mockClient.getBalances.mockResolvedValueOnce([
      {
        denom: "untrn",
        amount: "10000000",
        displayDenom: "NTRN",
        displayAmount: "10",
      },
      {
        denom: "factory/neutron1dropcontract/udntrn",
        amount: "5000000",
        displayDenom: "dNTRN",
        displayAmount: "5",
      },
    ]);

    const result = await tool!.handler({ chain: "neutron-1" });
    const parsed = parseToolResponse<{
      address: string;
      chainId: string;
      balances: unknown[];
      liquidStakingPositions: LstPosition[];
      suggestedActions: Array<{ tool: string }>;
    }>(result);

    expect(parsed.chainId).toBe("neutron-1");
    expect(parsed.liquidStakingPositions).toHaveLength(1);

    const lst = parsed.liquidStakingPositions[0];
    expect(lst.protocol).toBe("Drop Protocol");
    expect(lst.underlyingAsset).toBe("NTRN");
    expect(lst.displayAmount).toBe("5");

    // LST exit actions should appear in suggestedActions
    const ibcAction = parsed.suggestedActions.find(
      (a) => a.tool === "ibc-transfer",
    );
    expect(ibcAction).toBeDefined();
  });

  it("should not include liquidStakingPositions when no LSTs in balances", async () => {
    const tool = mockServer.getTool("get-balances");

    mockClient.getAddress.mockResolvedValueOnce("neutron1user...");
    mockClient.getBalances.mockResolvedValueOnce([
      {
        denom: "untrn",
        amount: "10000000",
        displayDenom: "NTRN",
        displayAmount: "10",
      },
    ]);

    const result = await tool!.handler({ chain: "neutron-1" });
    const parsed = parseToolResponse<{
      liquidStakingPositions?: LstPosition[];
    }>(result);

    expect(parsed.liquidStakingPositions).toBeUndefined();
  });

  it("should not include liquidStakingPositions for chains without LSTs", async () => {
    const tool = mockServer.getTool("get-balances");

    mockClient.getAddress.mockResolvedValueOnce("cosmos1user...");
    mockClient.getBalances.mockResolvedValueOnce([
      {
        denom: "uatom",
        amount: "5000000",
        displayDenom: "ATOM",
        displayAmount: "5",
      },
    ]);

    const result = await tool!.handler({ chain: "cosmoshub-4" });
    const parsed = parseToolResponse<{
      liquidStakingPositions?: LstPosition[];
    }>(result);

    expect(parsed.liquidStakingPositions).toBeUndefined();
  });
});
