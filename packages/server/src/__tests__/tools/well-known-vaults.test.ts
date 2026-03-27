/**
 * Tests for well-known vault discovery in get-staking-info.
 *
 * Verifies that:
 * - Vault positions are probed and returned alongside native staking
 * - Vault positions appear in the not_supported path
 * - Vault probe failures are silently skipped
 * - Unbond suggested actions contain correct params
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

// Mock chain configs
const mockNeutronChain = {
  chainId: "neutron-1",
  chainName: "Neutron",
  rpc: "https://rpc.neutron.org",
  rest: "https://lcd.neutron.org",
  stakeCurrency: {
    coinDenom: "NTRN",
    coinMinimalDenom: "untrn",
    coinDecimals: 6,
  },
  bech32Config: {
    bech32PrefixAccAddr: "neutron",
    bech32PrefixAccPub: "neutronpub",
    bech32PrefixValAddr: "neutronvaloper",
    bech32PrefixValPub: "neutronvaloperpub",
    bech32PrefixConsAddr: "neutronvalcons",
    bech32PrefixConsPub: "neutronvalconspub",
  },
  feeCurrencies: [
    {
      coinDenom: "NTRN",
      coinMinimalDenom: "untrn",
      coinDecimals: 6,
      gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 },
    },
  ],
  isBuiltin: true,
};

const mockCosmosChain = {
  chainId: "cosmoshub-4",
  chainName: "Cosmos Hub",
  rpc: "https://rpc.cosmos.network",
  rest: "https://lcd.cosmos.network",
  stakeCurrency: {
    coinDenom: "ATOM",
    coinMinimalDenom: "uatom",
    coinDecimals: 6,
  },
  bech32Config: {
    bech32PrefixAccAddr: "cosmos",
    bech32PrefixAccPub: "cosmospub",
    bech32PrefixValAddr: "cosmosvaloper",
    bech32PrefixValPub: "cosmosvaloperpub",
    bech32PrefixConsAddr: "cosmosvalcons",
    bech32PrefixConsPub: "cosmosvalconspub",
  },
  feeCurrencies: [
    {
      coinDenom: "ATOM",
      coinMinimalDenom: "uatom",
      coinDecimals: 6,
      gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 },
    },
  ],
  isBuiltin: true,
};

vi.mock("../../chains/cosmos.js", () => ({
  listChains: vi.fn().mockReturnValue([mockNeutronChain, mockCosmosChain]),
  getChainConfig: vi.fn().mockImplementation((chainId: string) => {
    if (chainId === "neutron-1") return mockNeutronChain;
    if (chainId === "cosmoshub-4") return mockCosmosChain;
    return undefined;
  }),
  findChainByName: vi.fn().mockImplementation((name: string) => {
    const lower = name.toLowerCase();
    if (lower === "neutron") return mockNeutronChain;
    if (lower === "cosmos" || lower === "cosmos hub") return mockCosmosChain;
    return undefined;
  }),
  getStakeDenom: vi.fn().mockImplementation((chain: unknown) => {
    return (
      (chain as { stakeCurrency?: { coinDenom?: string } })?.stakeCurrency
        ?.coinDenom ?? ""
    );
  }),
  getBech32Prefix: vi.fn().mockImplementation((chain: unknown) => {
    return (
      (chain as { bech32Config?: { bech32PrefixAccAddr?: string } })
        ?.bech32Config?.bech32PrefixAccAddr ?? ""
    );
  }),
  getStakeMinimalDenom: vi.fn().mockImplementation((chain: unknown) => {
    return (
      (chain as { stakeCurrency?: { coinMinimalDenom?: string } })
        ?.stakeCurrency?.coinMinimalDenom ?? ""
    );
  }),
  getStakeDecimals: vi.fn().mockImplementation((chain: unknown) => {
    return (
      (chain as { stakeCurrency?: { coinDecimals?: number } })?.stakeCurrency
        ?.coinDecimals ?? 6
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
    return `${price}${fee?.coinMinimalDenom ?? "untrn"}`;
  }),
}));

vi.mock("../../accounts.js", () => ({
  getActiveMnemonic: vi.fn().mockResolvedValue("test mnemonic"),
}));

const NEUTRON_VAULT_ADDR =
  "neutron1qeyjez6a9dwlghf9d6cy44fxmsajztw257586akk6xn6k88x0gus5djz4e";

interface VaultPosition {
  protocol: string;
  description: string;
  contractAddress: string;
  bondedAmount: string;
  bondDenom: string;
  suggestedActions: Array<{
    tool: string;
    reason: string;
    params: Record<string, string>;
    priority: number;
  }>;
}

describe("Well-known vault discovery in get-staking-info", () => {
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

  it("should return vault positions alongside native staking for Neutron", async () => {
    const tool = mockServer.getTool("get-staking-info");
    expect(tool).toBeDefined();

    mockClient.getAddress.mockResolvedValueOnce("neutron1user...");
    mockClient.getDelegations.mockResolvedValueOnce([
      {
        validatorAddress: "neutronvaloper1abc...",
        balance: { denom: "untrn", amount: "5000000" },
      },
    ]);
    mockClient.getRewards.mockResolvedValueOnce([]);

    // Vault query returns bonded amount
    mockClient.queryContract.mockResolvedValueOnce({
      data: { power: "1000000", height: 12345678 },
    });

    const result = await tool!.handler({ chain: "neutron-1" });
    const parsed = parseToolResponse<{
      address: string;
      chainId: string;
      delegations: unknown[];
      rewards: unknown[];
      vaultPositions: VaultPosition[];
      suggestedActions: Array<{
        tool: string;
        params?: Record<string, string>;
      }>;
    }>(result);

    expect(parsed.chainId).toBe("neutron-1");
    expect(parsed.delegations).toHaveLength(1);
    expect(parsed.vaultPositions).toHaveLength(1);

    const vault = parsed.vaultPositions[0];
    expect(vault.protocol).toBe("Neutron DAO");
    expect(vault.contractAddress).toBe(NEUTRON_VAULT_ADDR);
    expect(vault.bondedAmount).toBe("1000000");
    expect(vault.bondDenom).toBe("untrn");

    // Suggested actions should include cosmwasm-execute for unbonding
    const unbondAction = parsed.suggestedActions.find(
      (a) =>
        a.tool === "cosmwasm-execute" &&
        a.params?.contractAddress === NEUTRON_VAULT_ADDR,
    );
    expect(unbondAction).toBeDefined();
  });

  it("should return vault positions in not_supported path", async () => {
    const tool = mockServer.getTool("get-staking-info");

    mockClient.getAddress.mockResolvedValueOnce("neutron1user...");
    mockClient.getDelegations.mockRejectedValueOnce(
      new Error("unknown query path"),
    );
    mockClient.getRewards.mockRejectedValueOnce(
      new Error("unknown query path"),
    );

    // Vault query returns bonded amount
    mockClient.queryContract.mockResolvedValueOnce({
      data: { power: "2000000", height: 12345678 },
    });

    const result = await tool!.handler({ chain: "neutron-1" });
    const parsed = parseToolResponse<{
      status: string;
      chainId: string;
      vaultPositions: VaultPosition[];
      suggestedActions: Array<{ tool: string }>;
    }>(result);

    expect(parsed.status).toBe("not_supported");
    expect(parsed.vaultPositions).toHaveLength(1);
    expect(parsed.vaultPositions[0].bondedAmount).toBe("2000000");

    // Should include vault unbond action instead of cosmwasm-list-contracts
    expect(
      parsed.suggestedActions.find((a) => a.tool === "cosmwasm-execute"),
    ).toBeDefined();
    expect(
      parsed.suggestedActions.find((a) => a.tool === "cosmwasm-list-contracts"),
    ).toBeUndefined();
  });

  it("should fall back to cosmwasm-list-contracts when no vault positions found", async () => {
    const tool = mockServer.getTool("get-staking-info");

    mockClient.getAddress.mockResolvedValueOnce("neutron1user...");
    mockClient.getDelegations.mockRejectedValueOnce(
      new Error("unknown service cosmos.staking"),
    );
    mockClient.getRewards.mockRejectedValueOnce(
      new Error("unknown service cosmos.staking"),
    );

    // Vault query returns zero position
    mockClient.queryContract.mockResolvedValueOnce({
      data: { power: "0", height: 12345678 },
    });

    const result = await tool!.handler({ chain: "neutron-1" });
    const parsed = parseToolResponse<{
      status: string;
      vaultPositions: VaultPosition[];
      suggestedActions: Array<{ tool: string }>;
    }>(result);

    expect(parsed.status).toBe("not_supported");
    expect(parsed.vaultPositions).toHaveLength(0);
    expect(
      parsed.suggestedActions.find((a) => a.tool === "cosmwasm-list-contracts"),
    ).toBeDefined();
  });

  it("should skip vault silently when vault query fails", async () => {
    const tool = mockServer.getTool("get-staking-info");

    mockClient.getAddress.mockResolvedValueOnce("neutron1user...");
    mockClient.getDelegations.mockResolvedValueOnce([]);
    mockClient.getRewards.mockResolvedValueOnce([]);

    // Vault query fails
    mockClient.queryContract.mockRejectedValueOnce(
      new Error("Contract query failed (500): Internal error"),
    );

    const result = await tool!.handler({ chain: "neutron-1" });
    const parsed = parseToolResponse<{
      chainId: string;
      vaultPositions: VaultPosition[];
    }>(result);

    // Should not crash; vault positions should be empty
    expect(parsed.chainId).toBe("neutron-1");
    expect(parsed.vaultPositions).toHaveLength(0);
  });

  it("should return empty vaultPositions for chains without well-known vaults", async () => {
    const tool = mockServer.getTool("get-staking-info");

    mockClient.getAddress.mockResolvedValueOnce("cosmos1abc...");
    mockClient.getDelegations.mockResolvedValueOnce([]);
    mockClient.getRewards.mockResolvedValueOnce([]);

    const result = await tool!.handler({ chain: "cosmoshub-4" });
    const parsed = parseToolResponse<{
      chainId: string;
      vaultPositions: VaultPosition[];
    }>(result);

    expect(parsed.chainId).toBe("cosmoshub-4");
    expect(parsed.vaultPositions).toHaveLength(0);
    // queryContract should not have been called
    expect(mockClient.queryContract).not.toHaveBeenCalled();
  });

  it("should include correct unbond execute message in suggested actions", async () => {
    const tool = mockServer.getTool("get-staking-info");

    mockClient.getAddress.mockResolvedValueOnce("neutron1user...");
    mockClient.getDelegations.mockResolvedValueOnce([]);
    mockClient.getRewards.mockResolvedValueOnce([]);

    mockClient.queryContract.mockResolvedValueOnce({
      data: { power: "500000", height: 12345678 },
    });

    const result = await tool!.handler({ chain: "neutron-1" });
    const parsed = parseToolResponse<{
      vaultPositions: VaultPosition[];
    }>(result);

    const vault = parsed.vaultPositions[0];
    expect(vault.suggestedActions).toHaveLength(1);

    const action = vault.suggestedActions[0];
    expect(action.tool).toBe("cosmwasm-execute");
    expect(action.params.chain).toBe("neutron-1");
    expect(action.params.contractAddress).toBe(NEUTRON_VAULT_ADDR);
    expect(JSON.parse(action.params.executeMsg)).toEqual({
      unbond: { amount: "500000" },
    });
  });
});
