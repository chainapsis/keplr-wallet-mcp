/**
 * Staking LCD Fallback Tests
 *
 * Verifies that getDelegations() and getRewards() fall back to LCD REST
 * when ABCI queries fail (e.g., Neutron where staking module is not exposed via ABCI).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CosmosClient } from "../../clients/cosmos.js";

// --- Mocks ---

vi.mock("../../accounts.js", () => ({
  getActiveAccount: vi.fn().mockResolvedValue(null),
  getActiveAccountInfo: vi.fn().mockResolvedValue(null),
  getActiveMnemonic: vi.fn().mockResolvedValue("test mnemonic phrase here"),
  setActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../chains/cosmos.js", () => ({
  getBech32Prefix: vi.fn().mockReturnValue("neutron"),
  getGasPrice: vi.fn().mockReturnValue("0.025untrn"),
  getGasPriceForDenom: vi.fn().mockReturnValue("0.025untrn"),
  getStakeDecimals: vi.fn().mockReturnValue(6),
  getStakeDenom: vi.fn().mockReturnValue("NTRN"),
  getStakeMinimalDenom: vi.fn().mockReturnValue("untrn"),
}));

const mockLcdFetch = vi.fn();
const mockSafeParseJson = vi.fn();

vi.mock("../../utils/lcd-fetch.js", () => ({
  lcdFetch: (...args: unknown[]) => mockLcdFetch(...args),
  safeParseJson: (...args: unknown[]) => mockSafeParseJson(...args),
  LcdParseError: class extends Error {
    name = "LcdParseError";
  },
}));

const mockDelegatorDelegations = vi.fn();
const mockDelegationTotalRewards = vi.fn();

vi.mock("@cosmjs/stargate", () => ({
  SigningStargateClient: { connectWithSigner: vi.fn() },
  StargateClient: { connect: vi.fn() },
  GasPrice: {
    fromString: vi.fn().mockReturnValue({ amount: "0.025", denom: "untrn" }),
  },
  defaultRegistryTypes: [],
  QueryClient: {
    withExtensions: vi.fn().mockReturnValue({
      staking: {
        delegatorDelegations: (...args: unknown[]) =>
          mockDelegatorDelegations(...args),
      },
      distribution: {
        delegationTotalRewards: (...args: unknown[]) =>
          mockDelegationTotalRewards(...args),
      },
    }),
  },
  setupStakingExtension: vi.fn(),
  setupDistributionExtension: vi.fn(),
  setupGovExtension: vi.fn(),
  coin: (amount: string, denom: string) => ({ amount, denom }),
}));

vi.mock("@cosmjs/proto-signing", () => ({
  DirectSecp256k1HdWallet: {
    fromMnemonic: vi.fn().mockResolvedValue({
      getAccounts: vi
        .fn()
        .mockResolvedValue([
          { address: "neutron1testaddr", pubkey: new Uint8Array(33) },
        ]),
    }),
  },
  Registry: vi.fn().mockImplementation(() => ({ register: vi.fn() })),
  coin: (amount: string, denom: string) => ({ amount, denom }),
}));

vi.mock("@cosmjs/tendermint-rpc", () => ({
  Tendermint37Client: {
    connect: vi.fn().mockResolvedValue({}),
  },
}));

const mockChain = {
  chainId: "neutron-1",
  chainName: "Neutron",
  rpc: "https://rpc.neutron.org",
  rest: "https://rest.neutron.org",
} as never;

describe("Staking LCD Fallback", () => {
  let client: CosmosClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CosmosClient("test mnemonic phrase here");
  });

  describe("getDelegations", () => {
    it("should return delegations via ABCI when it succeeds", async () => {
      mockDelegatorDelegations.mockResolvedValueOnce({
        delegationResponses: [
          {
            delegation: { validatorAddress: "neutronvaloper1abc" },
            balance: { denom: "untrn", amount: "5000000" },
          },
        ],
      });

      const result = await client.getDelegations(mockChain);

      expect(result).toEqual([
        {
          validatorAddress: "neutronvaloper1abc",
          amount: "5000000",
          displayAmount: "5.000000",
          denom: "NTRN",
        },
      ]);
      expect(mockLcdFetch).not.toHaveBeenCalled();
    });

    it("should fall back to LCD when ABCI fails", async () => {
      mockDelegatorDelegations.mockRejectedValueOnce(
        new Error("unknown query path"),
      );

      mockLcdFetch.mockResolvedValueOnce({ ok: true });
      mockSafeParseJson.mockResolvedValueOnce({
        delegation_responses: [
          {
            delegation: { validator_address: "neutronvaloper1abc" },
            balance: { denom: "untrn", amount: "5000000" },
          },
        ],
      });

      const result = await client.getDelegations(mockChain);

      expect(result).toEqual([
        {
          validatorAddress: "neutronvaloper1abc",
          amount: "5000000",
          displayAmount: "5.000000",
          denom: "NTRN",
        },
      ]);
      expect(mockLcdFetch).toHaveBeenCalledWith(
        mockChain,
        expect.stringContaining(
          "/cosmos/staking/v1beta1/delegations/neutron1testaddr",
        ),
      );
    });

    it("should return empty array when LCD returns no delegations", async () => {
      mockDelegatorDelegations.mockRejectedValueOnce(
        new Error("unknown query path"),
      );

      mockLcdFetch.mockResolvedValueOnce({ ok: true });
      mockSafeParseJson.mockResolvedValueOnce({
        delegation_responses: [],
      });

      const result = await client.getDelegations(mockChain);
      expect(result).toEqual([]);
    });

    it("should throw when both ABCI and LCD fail", async () => {
      mockDelegatorDelegations.mockRejectedValueOnce(
        new Error("unknown query path"),
      );

      mockLcdFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
      });

      await expect(client.getDelegations(mockChain)).rejects.toThrow(
        "Failed to fetch delegations",
      );
    });
  });

  describe("getRewards", () => {
    it("should return rewards via ABCI when it succeeds", async () => {
      mockDelegationTotalRewards.mockResolvedValueOnce({
        rewards: [
          {
            validatorAddress: "neutronvaloper1abc",
            reward: [{ denom: "untrn", amount: "639327.868541" }],
          },
        ],
      });

      const result = await client.getRewards(mockChain);

      expect(result).toEqual([
        {
          validatorAddress: "neutronvaloper1abc",
          rewards: [{ denom: "untrn", amount: "639327" }],
        },
      ]);
      expect(mockLcdFetch).not.toHaveBeenCalled();
    });

    it("should fall back to LCD when ABCI fails", async () => {
      mockDelegationTotalRewards.mockRejectedValueOnce(
        new Error("unknown query path"),
      );

      mockLcdFetch.mockResolvedValueOnce({ ok: true });
      mockSafeParseJson.mockResolvedValueOnce({
        rewards: [
          {
            validator_address: "neutronvaloper1abc",
            reward: [{ denom: "untrn", amount: "639327.868541" }],
          },
        ],
      });

      const result = await client.getRewards(mockChain);

      expect(result).toEqual([
        {
          validatorAddress: "neutronvaloper1abc",
          rewards: [{ denom: "untrn", amount: "639327" }],
        },
      ]);
      expect(mockLcdFetch).toHaveBeenCalledWith(
        mockChain,
        expect.stringContaining(
          "/cosmos/distribution/v1beta1/delegators/neutron1testaddr/rewards",
        ),
      );
    });

    it("should handle null reward array in LCD response", async () => {
      mockDelegationTotalRewards.mockRejectedValueOnce(
        new Error("unknown query path"),
      );

      mockLcdFetch.mockResolvedValueOnce({ ok: true });
      mockSafeParseJson.mockResolvedValueOnce({
        rewards: [
          {
            validator_address: "neutronvaloper1abc",
            reward: null,
          },
        ],
      });

      const result = await client.getRewards(mockChain);

      expect(result).toEqual([
        {
          validatorAddress: "neutronvaloper1abc",
          rewards: [],
        },
      ]);
    });

    it("should return empty rewards when LCD returns 501 Not Implemented", async () => {
      mockDelegationTotalRewards.mockRejectedValueOnce(
        new Error("unknown query path"),
      );

      mockLcdFetch.mockResolvedValueOnce({
        ok: false,
        status: 501,
        statusText: "Not Implemented",
      });

      const result = await client.getRewards(mockChain);
      expect(result).toEqual([]);
    });

    it("should throw when both ABCI and LCD fail with non-501 error", async () => {
      mockDelegationTotalRewards.mockRejectedValueOnce(
        new Error("unknown query path"),
      );

      mockLcdFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(client.getRewards(mockChain)).rejects.toThrow(
        "Failed to fetch rewards",
      );
    });
  });
});
