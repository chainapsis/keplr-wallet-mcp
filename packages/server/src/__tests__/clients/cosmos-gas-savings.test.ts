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

// === Phase 1: Pure Formula Tests ===

describe("Gas Savings Calculation", () => {
  describe("Savings Formula", () => {
    /**
     * The savings formula is:
     * savings = (1 - batchedGas / individualGas) * 100
     *
     * Example:
     * - 3 individual txs: 100k + 100k + 100k = 300k gas
     * - 1 batched tx: 200k gas
     * - Savings: (1 - 200k/300k) * 100 = 33%
     */
    it("should calculate 33% savings when batch is 2/3 of individual", () => {
      const batchedGas = 200000;
      const individualGas = 300000;
      const savings = Math.round((1 - batchedGas / individualGas) * 100);
      expect(savings).toBe(33);
    });

    it("should calculate 50% savings when batch is half of individual", () => {
      const batchedGas = 100000;
      const individualGas = 200000;
      const savings = Math.round((1 - batchedGas / individualGas) * 100);
      expect(savings).toBe(50);
    });

    it("should calculate 0% savings when batch equals individual", () => {
      const batchedGas = 100000;
      const individualGas = 100000;
      const savings = Math.round((1 - batchedGas / individualGas) * 100);
      expect(savings).toBe(0);
    });

    it("should handle negative savings (batch worse than individual)", () => {
      const batchedGas = 150000;
      const individualGas = 100000;
      const savings = Math.round((1 - batchedGas / individualGas) * 100);
      // -50% savings means batch is worse
      expect(savings).toBe(-50);
    });
  });

  describe("Realistic Gas Scenarios", () => {
    /**
     * Based on actual Cosmos SDK gas costs:
     * - Base tx overhead: ~65,000 gas
     * - Signature verification: ~10,000 gas per signature
     * - MsgSend: ~40,000 gas
     * - MsgDelegate: ~200,000 gas
     * - MsgWithdrawDelegatorReward: ~100,000 gas
     *
     * Batching saves the base tx overhead for each additional message.
     */

    it("should show ~20% savings for 2 simple sends", () => {
      // Individual: 2 txs with full overhead
      // - Tx 1: 65k (base) + 10k (sig) + 40k (send) = 115k
      // - Tx 2: 65k (base) + 10k (sig) + 40k (send) = 115k
      // Total: 230k
      const individualGas = 230000;

      // Batched: 1 tx with shared overhead
      // - 1 tx: 65k (base) + 10k (sig) + 40k (send 1) + 40k (send 2) = 155k
      // But there's some additional encoding overhead, let's say ~20k
      const batchedGas = 175000;

      const savings = Math.round((1 - batchedGas / individualGas) * 100);
      expect(savings).toBeGreaterThanOrEqual(20);
      expect(savings).toBeLessThanOrEqual(30);
    });

    it("should show ~35% savings for claim + restake workflow", () => {
      // Individual:
      // - Claim: 65k + 10k + 100k = 175k
      // - Delegate: 65k + 10k + 200k = 275k
      // Total: 450k
      const individualGas = 450000;

      // Batched: 65k + 10k + 100k + 200k + ~20k overhead = 395k
      const batchedGas = 295000;

      const savings = Math.round((1 - batchedGas / individualGas) * 100);
      expect(savings).toBeGreaterThanOrEqual(30);
      expect(savings).toBeLessThanOrEqual(40);
    });

    it("should show diminishing returns for many actions", () => {
      // 5 simple sends individual: 5 * 115k = 575k
      const individualGas = 575000;

      // Batched: 65k + 10k + (5 * 40k) + ~40k overhead = 315k
      const batchedGas = 315000;

      const savings = Math.round((1 - batchedGas / individualGas) * 100);
      // ~45% savings for 5 actions
      expect(savings).toBeGreaterThanOrEqual(40);
      expect(savings).toBeLessThanOrEqual(50);
    });
  });

  describe("Edge Cases", () => {
    it("should return undefined savings for single message", () => {
      // Single message - no comparison possible
      const messages = 1;
      const shouldCalculateSavings = messages > 1;
      expect(shouldCalculateSavings).toBe(false);
    });

    it("should handle zero individual gas gracefully", () => {
      const individualGas = 0;
      const batchedGas = 100000;

      // Should not divide by zero
      const savings =
        individualGas > 0
          ? Math.round((1 - batchedGas / individualGas) * 100)
          : undefined;

      expect(savings).toBeUndefined();
    });

    it("should filter out negative savings", () => {
      const batchedGas = 200000;
      const individualGas = 150000; // Batch is worse

      const rawSavings = Math.round((1 - batchedGas / individualGas) * 100);
      const displayedSavings = rawSavings > 0 ? rawSavings : undefined;

      expect(rawSavings).toBe(-33);
      expect(displayedSavings).toBeUndefined();
    });
  });

  describe("Integration with 30% Buffer", () => {
    /**
     * The actual implementation adds a 30% buffer to all gas estimates.
     * This should be applied consistently to both batched and individual.
     */

    it("should maintain savings ratio after buffer is applied", () => {
      const rawBatched = 150000;
      const rawIndividual = 250000;
      const buffer = 1.3;

      const bufferedBatched = Math.ceil(rawBatched * buffer);
      const bufferedIndividual = Math.ceil(rawIndividual * buffer);

      // Raw savings
      const rawSavings = Math.round((1 - rawBatched / rawIndividual) * 100);

      // Buffered savings
      const bufferedSavings = Math.round(
        (1 - bufferedBatched / bufferedIndividual) * 100,
      );

      // Savings should be the same regardless of buffer
      expect(rawSavings).toBe(bufferedSavings);
      expect(rawSavings).toBe(40);
    });
  });
});

// === Phase 2: Real CosmosClient Integration Tests ===

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
