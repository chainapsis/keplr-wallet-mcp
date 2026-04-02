/**
 * Gas Savings Calculation Tests
 *
 * Verifies that simulateMultiActionWithSavings() correctly calculates
 * gas savings for batched vs individual transactions.
 *
 * Phase 1: Pure formula tests (no imports needed)
 * Phase 2: Integration tests with real CosmosClient
 */

import { SigningStargateClient } from "@cosmjs/stargate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CosmosClient } from "../../clients/cosmos.js";

// Mock dependencies for CosmosClient instantiation
vi.mock("../../accounts.js", () => ({
  getActiveAccount: vi.fn().mockResolvedValue(null),
  getActiveAccountInfo: vi.fn().mockResolvedValue(null),
  getActiveMnemonic: vi.fn().mockResolvedValue("test mnemonic phrase here"),
  setActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../chains/cosmos.js", () => ({
  getBech32Prefix: vi.fn().mockReturnValue("cosmos"),
  getGasPrice: vi.fn().mockReturnValue("0.025uatom"),
  getGasPriceForDenom: vi.fn().mockReturnValue("0.025uatom"),
  getStakeDecimals: vi.fn().mockReturnValue(6),
  getStakeDenom: vi.fn().mockReturnValue("ATOM"),
  getStakeMinimalDenom: vi.fn().mockReturnValue("uatom"),
}));

vi.mock("@cosmjs/stargate", () => ({
  SigningStargateClient: {
    connectWithSigner: vi.fn(),
  },
  StargateClient: {
    connect: vi.fn(),
  },
  GasPrice: {
    fromString: vi.fn().mockReturnValue({ amount: "0.025", denom: "uatom" }),
  },
  defaultRegistryTypes: [],
}));

vi.mock("@cosmjs/proto-signing", () => ({
  DirectSecp256k1HdWallet: {
    fromMnemonic: vi.fn().mockResolvedValue({
      getAccounts: vi
        .fn()
        .mockResolvedValue([
          { address: "cosmos1test123", pubkey: new Uint8Array(33) },
        ]),
    }),
  },
  Registry: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
  })),
  coin: (amount: string, denom: string) => ({ amount, denom }),
}));

// --- Test Helpers ---

const mockChain = {
  chainId: "cosmoshub-4",
  chainName: "Cosmos Hub",
  rpc: "https://rpc.cosmos.network",
} as never;

const makeMsgSend = () => ({
  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: {
    fromAddress: "cosmos1test123",
    toAddress: "cosmos1receiver",
    amount: [{ denom: "uatom", amount: "1000000" }],
  },
});

// === Real CosmosClient Integration Tests ===

describe("CosmosClient.simulateMultiActionWithSavings", () => {
  let mockSimulate: ReturnType<typeof vi.fn>;
  let client: CosmosClient;

  beforeEach(() => {
    mockSimulate = vi.fn();
    vi.mocked(SigningStargateClient.connectWithSigner).mockResolvedValue({
      simulate: mockSimulate,
    } as never);

    client = new CosmosClient("test mnemonic phrase here");
  });

  it("should throw for empty messages array", async () => {
    await expect(
      client.simulateMultiActionWithSavings(mockChain, []),
    ).rejects.toThrow("Cannot simulate multi-action with no messages");
  });

  it("should return gasEstimate only for single message", async () => {
    mockSimulate.mockResolvedValueOnce(100000);

    const result = await client.simulateMultiActionWithSavings(mockChain, [
      makeMsgSend(),
    ]);

    expect(result.gasEstimate).toBe("130000"); // 100k * 1.3
    expect(result.gasEstimateIndividual).toBeUndefined();
    expect(result.gasSavingsPercent).toBeUndefined();
    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });

  it("should calculate savings for multiple messages", async () => {
    // Batch simulation: 200k gas
    mockSimulate.mockResolvedValueOnce(200000);
    // Individual simulations: 100k each
    mockSimulate.mockResolvedValueOnce(100000);
    mockSimulate.mockResolvedValueOnce(100000);
    mockSimulate.mockResolvedValueOnce(100000);

    const result = await client.simulateMultiActionWithSavings(mockChain, [
      makeMsgSend(),
      makeMsgSend(),
      makeMsgSend(),
    ]);

    // Batched: ceil(200k * 1.3) = 260000
    expect(result.gasEstimate).toBe("260000");
    // Individual: 3 * ceil(100k * 1.3) = 3 * 130000 = 390000
    expect(result.gasEstimateIndividual).toBe("390000");
    // Savings: round((1 - 260000/390000) * 100) = 33
    expect(result.gasSavingsPercent).toBe(33);

    // 1 batch + 3 individual simulations
    expect(mockSimulate).toHaveBeenCalledTimes(4);
  });

  it("should return undefined gasSavingsPercent for negative savings", async () => {
    // Batch is worse than individual (rare but possible)
    mockSimulate.mockResolvedValueOnce(300000); // batch: 300k
    mockSimulate.mockResolvedValueOnce(100000); // individual 1: 100k
    mockSimulate.mockResolvedValueOnce(100000); // individual 2: 100k

    const result = await client.simulateMultiActionWithSavings(mockChain, [
      makeMsgSend(),
      makeMsgSend(),
    ]);

    // Batched: ceil(300k * 1.3) = 390000
    // Individual: 2 * ceil(100k * 1.3) = 260000
    // Savings: (1 - 390000/260000) * 100 = -50 → undefined
    expect(result.gasEstimate).toBe("390000");
    expect(result.gasEstimateIndividual).toBe("260000");
    expect(result.gasSavingsPercent).toBeUndefined();
  });

  it("should skip savings when individual simulation fails", async () => {
    // Batch succeeds
    mockSimulate.mockResolvedValueOnce(200000);
    // First individual succeeds
    mockSimulate.mockResolvedValueOnce(100000);
    // Second individual fails
    mockSimulate.mockRejectedValueOnce(new Error("Simulation failed"));

    const result = await client.simulateMultiActionWithSavings(mockChain, [
      makeMsgSend(),
      makeMsgSend(),
    ]);

    // Should return batched estimate only
    expect(result.gasEstimate).toBe("260000"); // ceil(200k * 1.3)
    expect(result.gasEstimateIndividual).toBeUndefined();
    expect(result.gasSavingsPercent).toBeUndefined();
  });

  it("should apply 1.3x buffer consistently", async () => {
    mockSimulate.mockResolvedValueOnce(150000); // batch
    mockSimulate.mockResolvedValueOnce(80000); // individual 1
    mockSimulate.mockResolvedValueOnce(90000); // individual 2

    const result = await client.simulateMultiActionWithSavings(mockChain, [
      makeMsgSend(),
      makeMsgSend(),
    ]);

    // Batched: ceil(150000 * 1.3) = 195000
    expect(result.gasEstimate).toBe("195000");
    // Individual: ceil(80000 * 1.3) + ceil(90000 * 1.3) = 104000 + 117000 = 221000
    expect(result.gasEstimateIndividual).toBe("221000");
  });
});
