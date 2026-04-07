/**
 * Tests for CosmosClient broadcast, fee calculation, and gas estimation.
 *
 * Covers previously untested critical paths:
 * - signAndBroadcastSafe: standard vs ethermint broadcast
 * - simulateFee: 1.4x gas buffer
 * - calculateEthermintFallbackFee: 1.5x buffer with BASE + PER_MSG formula
 * - calculateFeeForDenom: custom fee denom branch
 */

import { SigningStargateClient } from "@cosmjs/stargate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CosmosClient } from "../../clients/cosmos.js";

vi.mock("../../accounts.js", () => ({
  getActiveAccount: vi.fn().mockResolvedValue(null),
  getActiveAccountInfo: vi.fn().mockResolvedValue(null),
  getActiveMnemonic: vi.fn().mockResolvedValue("test mnemonic phrase here"),
  setActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../chains/cosmos.js", () => ({
  getBech32Prefix: vi.fn().mockReturnValue("cosmos"),
  getGasPrice: vi.fn().mockReturnValue("0.025uatom"),
  getGasPriceForDenom: vi
    .fn()
    .mockImplementation((chain: unknown, denom: string) => {
      if (denom === "uatom") return "0.025uatom";
      if (denom === "uosmo") return "0.01uosmo";
      return undefined;
    }),
  getStakeDecimals: vi.fn().mockReturnValue(6),
  getStakeDenom: vi.fn().mockReturnValue("ATOM"),
  getStakeMinimalDenom: vi.fn().mockReturnValue("uatom"),
}));

vi.mock("@cosmjs/stargate", () => ({
  SigningStargateClient: {
    connectWithSigner: vi.fn(),
    createWithSigner: vi.fn(),
  },
  StargateClient: { connect: vi.fn() },
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
  Registry: vi.fn().mockImplementation(() => ({ register: vi.fn() })),
  coin: (amount: string, denom: string) => ({ amount, denom }),
}));

const mockLcdFetch = vi.fn();
const mockSafeParseJson = vi.fn();
vi.mock("../../utils/lcd-fetch.js", () => ({
  lcdFetch: (...args: unknown[]) => mockLcdFetch(...args),
  safeParseJson: (...args: unknown[]) => mockSafeParseJson(...args),
}));

vi.mock("cosmjs-types/cosmos/tx/v1beta1/tx.js", () => ({
  TxRaw: {
    encode: vi.fn().mockReturnValue({
      finish: () => new Uint8Array([1, 2, 3]),
    }),
  },
}));

vi.mock("cosmjs-types/cosmwasm/wasm/v1/tx.js", () => ({
  MsgExecuteContract: {},
  MsgInstantiateContract: {},
}));

vi.mock("@cosmjs/tendermint-rpc", () => ({
  Tendermint37Client: {
    connect: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@babylonlabs-io/babylon-proto-ts", () => ({
  epochingtx: {
    MsgWrappedDelegate: {},
    MsgWrappedUndelegate: {},
    MsgWrappedBeginRedelegate: {},
    MsgWrappedCancelUnbondingDelegation: {},
  },
}));

const standardChain = {
  chainId: "cosmoshub-4",
  chainName: "Cosmos Hub",
  rpc: "https://rpc.cosmos.network",
  bip44: { coinType: 118 },
  bech32Config: { bech32PrefixAccAddr: "cosmos" },
  feeCurrencies: [
    {
      coinDenom: "ATOM",
      coinMinimalDenom: "uatom",
      coinDecimals: 6,
      gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 },
    },
  ],
} as never;

const ethermintChain = {
  chainId: "injective-1",
  chainName: "Injective",
  rpc: "https://rpc.injective.network",
  bip44: { coinType: 60 },
  bech32Config: { bech32PrefixAccAddr: "inj" },
  features: ["eth-address-gen", "eth-key-sign"],
  feeCurrencies: [
    {
      coinDenom: "INJ",
      coinMinimalDenom: "inj",
      coinDecimals: 18,
      gasPriceStep: { low: 500000000, average: 1000000000, high: 1500000000 },
    },
  ],
} as never;

const makeMsgSend = () => ({
  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: {
    fromAddress: "cosmos1test123",
    toAddress: "cosmos1receiver",
    amount: [{ denom: "uatom", amount: "1000000" }],
  },
});

describe("CosmosClient broadcast & fee calculation", () => {
  let mockSignAndBroadcast: ReturnType<typeof vi.fn>;
  let mockSign: ReturnType<typeof vi.fn>;
  let mockSimulate: ReturnType<typeof vi.fn>;
  let client: CosmosClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSignAndBroadcast = vi.fn().mockResolvedValue({
      transactionHash: "AABB1234",
      code: 0,
      gasUsed: BigInt(80000),
      gasWanted: BigInt(100000),
    });
    mockSign = vi.fn().mockResolvedValue({
      bodyBytes: new Uint8Array(),
      authInfoBytes: new Uint8Array(),
      signatures: [],
    });
    mockSimulate = vi.fn().mockResolvedValue(100000);

    const mockClient = {
      signAndBroadcast: mockSignAndBroadcast,
      sign: mockSign,
      simulate: mockSimulate,
    } as never;
    vi.mocked(SigningStargateClient.connectWithSigner).mockResolvedValue(
      mockClient,
    );
    vi.mocked(SigningStargateClient.createWithSigner).mockResolvedValue(
      mockClient,
    );

    client = new CosmosClient(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );
  });

  describe("simulateFee", () => {
    it("should apply 1.4x gas buffer", async () => {
      const result = await client.simulateFee(standardChain, [makeMsgSend()]);

      expect(mockSimulate).toHaveBeenCalled();
      // gasEstimate = 100000, with 1.4x buffer = 140000
      expect(result.gasEstimate).toBe("100000");
      const gasWithBuffer = Math.ceil(100000 * 1.4);
      expect(Number.parseInt(result.feeAmount)).toBe(
        Math.ceil(gasWithBuffer * 0.025),
      );
    });
  });

  describe("calculateEthermintFallbackFee", () => {
    it("should use 1.5x buffer with BASE_GAS + PER_MSG formula", () => {
      // Access private method
      const fee = (
        client as never as Record<string, (...args: unknown[]) => unknown>
      ).calculateEthermintFallbackFee(ethermintChain, [makeMsgSend()]);

      // BASE_GAS=200000 + 1*PER_MSG=100000 = 300000
      // with 1.5x buffer = 450000
      const result = fee as {
        gas: string;
        amount: { amount: string; denom: string }[];
      };
      expect(result.gas).toBe("450000");
    });

    it("should scale with number of messages", () => {
      const fee = (
        client as never as Record<string, (...args: unknown[]) => unknown>
      ).calculateEthermintFallbackFee(ethermintChain, [
        makeMsgSend(),
        makeMsgSend(),
        makeMsgSend(),
      ]);

      // BASE=200k + 3*100k = 500k, * 1.5 = 750k
      const result = fee as { gas: string };
      expect(result.gas).toBe("750000");
    });
  });

  describe("signAndBroadcastSafe", () => {
    it("should delegate to client.signAndBroadcast for non-ethermint chains", async () => {
      const result = await (
        client as never as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      ).signAndBroadcastSafe(
        standardChain,
        "cosmos1test123",
        [makeMsgSend()],
        "auto",
      );

      expect(mockSignAndBroadcast).toHaveBeenCalledWith(
        "cosmos1test123",
        [makeMsgSend()],
        "auto",
      );
      expect(result).toEqual({
        transactionHash: "AABB1234",
        code: 0,
        gasUsed: "80000",
        gasWanted: "100000",
      });
    });

    it("should sign and broadcast via LCD for ethermint chains", async () => {
      // Mock LCD broadcast response
      mockLcdFetch.mockResolvedValueOnce({ ok: true });
      mockSafeParseJson.mockResolvedValueOnce({
        tx_response: {
          code: 0,
          txhash: "ETHERMINT_TX_HASH",
          raw_log: "",
          gas_used: "150000",
          gas_wanted: "200000",
        },
      });

      // Mock LCD poll response (successful)
      mockLcdFetch.mockResolvedValueOnce({ ok: true });
      mockSafeParseJson.mockResolvedValueOnce({
        tx_response: {
          code: 0,
          txhash: "ETHERMINT_TX_HASH",
          raw_log: "",
          gas_used: "150000",
          gas_wanted: "200000",
        },
      });

      const result = await (
        client as never as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      ).signAndBroadcastSafe(
        ethermintChain,
        "inj1test123",
        [makeMsgSend()],
        "auto",
      );

      // Should NOT use standard signAndBroadcast
      expect(mockSignAndBroadcast).not.toHaveBeenCalled();
      // Should use client.sign + LCD
      expect(mockSign).toHaveBeenCalled();
      expect(mockLcdFetch).toHaveBeenCalledWith(
        ethermintChain,
        "/cosmos/tx/v1beta1/txs",
        expect.objectContaining({ method: "POST" }),
      );

      const txResult = result as { transactionHash: string; code: number };
      expect(txResult.transactionHash).toBe("ETHERMINT_TX_HASH");
      expect(txResult.code).toBe(0);
    });

    it("should throw on LCD broadcast HTTP error for ethermint", async () => {
      mockLcdFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(
        (
          client as never as Record<
            string,
            (...args: unknown[]) => Promise<unknown>
          >
        ).signAndBroadcastSafe(
          ethermintChain,
          "inj1test123",
          [makeMsgSend()],
          "auto",
        ),
      ).rejects.toThrow("LCD broadcast failed with status 500");
    });

    it("should throw raw_log when ethermint SYNC broadcast returns non-zero code", async () => {
      mockLcdFetch.mockResolvedValueOnce({ ok: true });
      mockSafeParseJson.mockResolvedValueOnce({
        tx_response: {
          code: 5,
          txhash: "FAILED_TX",
          raw_log: "insufficient funds",
        },
      });

      await expect(
        (
          client as never as Record<
            string,
            (...args: unknown[]) => Promise<unknown>
          >
        ).signAndBroadcastSafe(
          ethermintChain,
          "inj1test123",
          [makeMsgSend()],
          "auto",
        ),
      ).rejects.toThrow("insufficient funds");
    });

    it("should auto-retry on out-of-gas (code 11) and succeed", async () => {
      // First call: CosmJS throws BroadcastTxError at CheckTx stage
      mockSignAndBroadcast.mockRejectedValueOnce(
        new Error(
          "Broadcasting transaction failed with code 11 (codespace: sdk). Log: out of gas in location: WriteFlat; gasWanted: 90000, gasUsed: 95000: out of gas",
        ),
      );
      // Retry call: success
      mockSignAndBroadcast.mockResolvedValueOnce({
        transactionHash: "RETRY_TX",
        code: 0,
        gasUsed: BigInt(95000),
        gasWanted: BigInt(114000),
      });

      const result = (await (
        client as never as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      ).signAndBroadcastSafe(standardChain, "cosmos1test123", [makeMsgSend()], {
        gas: "90000",
        amount: [{ denom: "uatom", amount: "2250" }],
      })) as { transactionHash: string; code: number };

      expect(mockSignAndBroadcast).toHaveBeenCalledTimes(2);
      expect(result.transactionHash).toBe("RETRY_TX");
      expect(result.code).toBe(0);
      // retryGas = ceil(95000 * 1.4) = 133000
      const retryFee = mockSignAndBroadcast.mock.calls[1][2] as {
        gas: string;
      };
      expect(retryFee.gas).toBe("133000");
    });

    it("should auto-retry on DeliverTx out-of-gas (code 11 in result)", async () => {
      // First call: DeliverTx returns code 11 (not thrown)
      mockSignAndBroadcast.mockResolvedValueOnce({
        transactionHash: "FAILED_TX",
        code: 11,
        gasUsed: BigInt(95000),
        gasWanted: BigInt(90000),
      });
      // Retry: success
      mockSignAndBroadcast.mockResolvedValueOnce({
        transactionHash: "RETRY_TX",
        code: 0,
        gasUsed: BigInt(95000),
        gasWanted: BigInt(133000),
      });

      const result = (await (
        client as never as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      ).signAndBroadcastSafe(standardChain, "cosmos1test123", [makeMsgSend()], {
        gas: "90000",
        amount: [{ denom: "uatom", amount: "2250" }],
      })) as { transactionHash: string; code: number };

      expect(mockSignAndBroadcast).toHaveBeenCalledTimes(2);
      expect(result.transactionHash).toBe("RETRY_TX");
      expect(result.code).toBe(0);
      // retryGas = ceil(95000 * 1.4) = 133000
      const retryFee = mockSignAndBroadcast.mock.calls[1][2] as {
        gas: string;
      };
      expect(retryFee.gas).toBe("133000");
    });

    it("should not retry DeliverTx code 11 when gasUsed is 0", async () => {
      mockSignAndBroadcast.mockResolvedValueOnce({
        transactionHash: "FAILED_TX",
        code: 11,
        gasUsed: BigInt(0),
        gasWanted: BigInt(100000),
      });

      const result = (await (
        client as never as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      ).signAndBroadcastSafe(
        standardChain,
        "cosmos1test123",
        [makeMsgSend()],
        "auto",
      )) as { code: number };

      expect(mockSignAndBroadcast).toHaveBeenCalledTimes(1);
      expect(result.code).toBe(11);
    });

    it("should propagate retry failure when retry also throws", async () => {
      mockSignAndBroadcast.mockRejectedValueOnce(
        new Error(
          "Broadcasting transaction failed with code 11 (codespace: sdk). Log: out of gas in location: WriteFlat; gasWanted: 90000, gasUsed: 95000: out of gas",
        ),
      );
      mockSignAndBroadcast.mockRejectedValueOnce(
        new Error(
          "Broadcasting transaction failed with code 11 (codespace: sdk). Log: out of gas; gasWanted: 114000, gasUsed: 114500: out of gas",
        ),
      );

      await expect(
        (
          client as never as Record<
            string,
            (...args: unknown[]) => Promise<unknown>
          >
        ).signAndBroadcastSafe(
          standardChain,
          "cosmos1test123",
          [makeMsgSend()],
          { gas: "90000", amount: [{ denom: "uatom", amount: "2250" }] },
        ),
      ).rejects.toThrow("code 11");

      expect(mockSignAndBroadcast).toHaveBeenCalledTimes(2);
    });

    it("should not retry on non-11 error codes", async () => {
      mockSignAndBroadcast.mockRejectedValueOnce(
        new Error(
          "Broadcasting transaction failed with code 5. Log: insufficient funds",
        ),
      );

      await expect(
        (
          client as never as Record<
            string,
            (...args: unknown[]) => Promise<unknown>
          >
        ).signAndBroadcastSafe(
          standardChain,
          "cosmos1test123",
          [makeMsgSend()],
          "auto",
        ),
      ).rejects.toThrow("code 5");

      expect(mockSignAndBroadcast).toHaveBeenCalledTimes(1);
    });

    it("should not retry when gasUsed cannot be parsed from error", async () => {
      mockSignAndBroadcast.mockRejectedValueOnce(
        new Error(
          "Broadcasting transaction failed with code 11 (codespace: sdk). Log: out of gas",
        ),
      );

      await expect(
        (
          client as never as Record<
            string,
            (...args: unknown[]) => Promise<unknown>
          >
        ).signAndBroadcastSafe(
          standardChain,
          "cosmos1test123",
          [makeMsgSend()],
          "auto",
        ),
      ).rejects.toThrow("code 11");

      expect(mockSignAndBroadcast).toHaveBeenCalledTimes(1);
    });

    it("should throw raw_log when ethermint DeliverTx poll returns non-zero code", async () => {
      // SYNC success
      mockLcdFetch.mockResolvedValueOnce({ ok: true });
      mockSafeParseJson.mockResolvedValueOnce({
        tx_response: { code: 0, txhash: "TX123", raw_log: "" },
      });

      // DeliverTx poll returns failure
      mockLcdFetch.mockResolvedValueOnce({ ok: true });
      mockSafeParseJson.mockResolvedValueOnce({
        tx_response: {
          code: 11,
          txhash: "TX123",
          raw_log: "out of gas",
        },
      });

      await expect(
        (
          client as never as Record<
            string,
            (...args: unknown[]) => Promise<unknown>
          >
        ).signAndBroadcastSafe(
          ethermintChain,
          "inj1test123",
          [makeMsgSend()],
          "auto",
        ),
      ).rejects.toThrow("out of gas");
    });
  });

  describe("calculateFeeForDenom", () => {
    it("should return fallback fee for ethermint chains", async () => {
      const result = await (
        client as never as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      ).calculateFeeForDenom(ethermintChain, [makeMsgSend()], "inj");

      const fee = result as { gas: string };
      // Should use ethermint fallback (1.5x buffer), not simulate
      expect(mockSimulate).not.toHaveBeenCalled();
      expect(Number.parseInt(fee.gas)).toBeGreaterThan(0);
    });

    it("should simulate with default gas price when no custom feeDenom", async () => {
      const result = await (
        client as never as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      ).calculateFeeForDenom(standardChain, [makeMsgSend()]);

      expect(mockSimulate).toHaveBeenCalled();
      const fee = result as {
        gas: string;
        amount: { denom: string; amount: string }[];
      };
      // 100000 * 1.4 = 140000
      expect(fee.gas).toBe("140000");
      expect(fee.amount[0].denom).toBe("uatom");
    });

    it("should use default gas price for invalid feeDenom", async () => {
      const result = await (
        client as never as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      ).calculateFeeForDenom(standardChain, [makeMsgSend()], "invalid-denom");

      expect(mockSimulate).toHaveBeenCalled();
      const fee = result as {
        gas: string;
        amount: { denom: string; amount: string }[];
      };
      // Falls back to default gas price
      expect(fee.gas).toBe("140000");
      expect(fee.amount[0].denom).toBe("uatom");
    });

    it("should simulate and build fee for valid custom feeDenom", async () => {
      const result = await (
        client as never as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      ).calculateFeeForDenom(standardChain, [makeMsgSend()], "uatom");

      expect(mockSimulate).toHaveBeenCalled();
      const fee = result as {
        gas: string;
        amount: { denom: string; amount: string }[];
      };
      expect(fee.amount[0].denom).toBe("uatom");
      // 100000 * 1.4 = 140000
      expect(fee.gas).toBe("140000");
    });
  });
});
