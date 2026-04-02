/**
 * Shared chain config mocks for tool tests.
 *
 * Extracted from cosmos-query, cosmwasm, well-known-lst, and well-known-vaults
 * test files to eliminate ~200 lines of duplication.
 */
import { vi } from "vitest";

export const mockCosmosChain = {
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
};

export const mockOsmosisChain = {
  chainId: "osmosis-1",
  chainName: "Osmosis",
  rpc: "https://rpc.osmosis.network",
  rest: "https://lcd.osmosis.network",
  stakeCurrency: {
    coinDenom: "OSMO",
    coinMinimalDenom: "uosmo",
    coinDecimals: 6,
  },
  bech32Config: {
    bech32PrefixAccAddr: "osmo",
    bech32PrefixAccPub: "osmopub",
    bech32PrefixValAddr: "osmovaloper",
    bech32PrefixValPub: "osmovaloperpub",
    bech32PrefixConsAddr: "osmovalcons",
    bech32PrefixConsPub: "osmovalconspub",
  },
  feeCurrencies: [
    {
      coinDenom: "OSMO",
      coinMinimalDenom: "uosmo",
      coinDecimals: 6,
      gasPriceStep: { low: 0.0025, average: 0.025, high: 0.04 },
    },
  ],
};

export const mockNeutronChain = {
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
};

type ChainConfig = typeof mockCosmosChain;

/**
 * Create a chains/cosmos.js mock from a map of chainId → config.
 * Pass the result to vi.mock("../../chains/cosmos.js", () => createChainsMock(...)).
 */
export const createChainsMock = (chains: Record<string, ChainConfig>) => {
  const chainList = Object.values(chains);
  const byId = (chainId: string) => chains[chainId] ?? undefined;
  const byName = (name: string) => {
    const lower = name.toLowerCase();
    return chainList.find(
      (c) =>
        c.chainName.toLowerCase() === lower ||
        c.chainName.toLowerCase().split(" ")[0] === lower,
    );
  };

  return {
    listChains: vi.fn().mockReturnValue(chainList),
    getChainConfig: vi.fn().mockImplementation(byId),
    findChainByName: vi.fn().mockImplementation(byName),
    findAllChainsByName: vi.fn().mockImplementation((name: string) => {
      const found = byName(name);
      return found ? [found] : [];
    }),
    getStakeDenom: vi
      .fn()
      .mockImplementation(
        (chain: unknown) =>
          (chain as ChainConfig)?.stakeCurrency?.coinDenom ?? "",
      ),
    getBech32Prefix: vi
      .fn()
      .mockImplementation(
        (chain: unknown) =>
          (chain as ChainConfig)?.bech32Config?.bech32PrefixAccAddr ?? "",
      ),
    getStakeMinimalDenom: vi
      .fn()
      .mockImplementation(
        (chain: unknown) =>
          (chain as ChainConfig)?.stakeCurrency?.coinMinimalDenom ?? "",
      ),
    getStakeDecimals: vi
      .fn()
      .mockImplementation(
        (chain: unknown) =>
          (chain as ChainConfig)?.stakeCurrency?.coinDecimals ?? 6,
      ),
    getGasPrice: vi.fn().mockImplementation((chain: unknown) => {
      const fee = (chain as ChainConfig)?.feeCurrencies?.[0];
      const price = fee?.gasPriceStep?.average ?? 0.025;
      return `${price}${fee?.coinMinimalDenom ?? "uatom"}`;
    }),
  };
};
