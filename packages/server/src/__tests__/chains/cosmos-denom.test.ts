import type { ChainInfo } from "@keplr-wallet/types";
import { describe, expect, it } from "vitest";
import { resolveChainDenom } from "../../chains/cosmos.js";

/**
 * Minimal chain config fixture for testing denom resolution.
 */
const osmosisChain: ChainInfo = {
  chainId: "osmosis-1",
  chainName: "Osmosis",
  rpc: "https://rpc.osmosis.zone",
  rest: "https://lcd.osmosis.zone",
  stakeCurrency: {
    coinDenom: "OSMO",
    coinMinimalDenom: "uosmo",
    coinDecimals: 6,
    coinGeckoId: "osmosis",
  },
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: "osmo",
    bech32PrefixAccPub: "osmopub",
    bech32PrefixValAddr: "osmovaloper",
    bech32PrefixValPub: "osmovaloperpub",
    bech32PrefixConsAddr: "osmovalcons",
    bech32PrefixConsPub: "osmovalconspub",
  },
  currencies: [
    {
      coinDenom: "OSMO",
      coinMinimalDenom: "uosmo",
      coinDecimals: 6,
      coinGeckoId: "osmosis",
    },
    {
      coinDenom: "USDC",
      coinMinimalDenom:
        "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
      coinDecimals: 6,
      coinGeckoId: "usd-coin",
    },
    {
      coinDenom: "ATOM",
      coinMinimalDenom:
        "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
      coinDecimals: 6,
      coinGeckoId: "cosmos",
    },
  ],
  feeCurrencies: [
    {
      coinDenom: "OSMO",
      coinMinimalDenom: "uosmo",
      coinDecimals: 6,
      coinGeckoId: "osmosis",
      gasPriceStep: { low: 0.03, average: 0.1, high: 0.16 },
    },
  ],
};

const stargazeChain: ChainInfo = {
  chainId: "stargaze-1",
  chainName: "Stargaze",
  rpc: "https://rpc.stargaze-apis.com",
  rest: "https://rest.stargaze-apis.com",
  stakeCurrency: {
    coinDenom: "STARS",
    coinMinimalDenom: "ustars",
    coinDecimals: 6,
    coinGeckoId: "stargaze",
  },
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: "stars",
    bech32PrefixAccPub: "starspub",
    bech32PrefixValAddr: "starsvaloper",
    bech32PrefixValPub: "starsvaloperpub",
    bech32PrefixConsAddr: "starsvalcons",
    bech32PrefixConsPub: "starsvalconspub",
  },
  currencies: [
    {
      coinDenom: "STARS",
      coinMinimalDenom: "ustars",
      coinDecimals: 6,
      coinGeckoId: "stargaze",
    },
  ],
  feeCurrencies: [
    {
      coinDenom: "STARS",
      coinMinimalDenom: "ustars",
      coinDecimals: 6,
      coinGeckoId: "stargaze",
      gasPriceStep: { low: 1, average: 1.1, high: 1.2 },
    },
    {
      coinDenom: "ATOM",
      coinMinimalDenom:
        "ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9",
      coinDecimals: 6,
      coinGeckoId: "cosmos",
      gasPriceStep: { low: 0.003, average: 0.003, high: 0.003 },
    },
  ],
};

describe("resolveChainDenom", () => {
  it("should resolve IBC ATOM denom on Osmosis from currencies", () => {
    const result = resolveChainDenom(
      osmosisChain,
      "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
    );
    expect(result).toEqual({
      displayDenom: "ATOM",
      decimals: 6,
      coinGeckoId: "cosmos",
    });
  });

  it("should resolve IBC USDC denom on Osmosis from currencies", () => {
    const result = resolveChainDenom(
      osmosisChain,
      "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
    );
    expect(result).toEqual({
      displayDenom: "USDC",
      decimals: 6,
      coinGeckoId: "usd-coin",
    });
  });

  it("should resolve native denom from currencies", () => {
    const result = resolveChainDenom(osmosisChain, "uosmo");
    expect(result).toEqual({
      displayDenom: "OSMO",
      decimals: 6,
      coinGeckoId: "osmosis",
    });
  });

  it("should resolve IBC ATOM denom from feeCurrencies on Stargaze", () => {
    const result = resolveChainDenom(
      stargazeChain,
      "ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9",
    );
    expect(result).toEqual({
      displayDenom: "ATOM",
      decimals: 6,
      coinGeckoId: "cosmos",
    });
  });

  it("should return null for unknown denom", () => {
    const result = resolveChainDenom(osmosisChain, "ibc/UNKNOWN_HASH");
    expect(result).toBeNull();
  });

  it("should return null for empty currencies", () => {
    const emptyChain: ChainInfo = {
      ...osmosisChain,
      currencies: [],
      feeCurrencies: [],
    };
    const result = resolveChainDenom(emptyChain, "uosmo");
    expect(result).toBeNull();
  });

  it("should prefer currencies over feeCurrencies", () => {
    // OSMO exists in both currencies and feeCurrencies on osmosisChain
    // currencies entry does NOT have gasPriceStep, feeCurrencies does
    // resolveChainDenom should return the currencies match first
    const result = resolveChainDenom(osmosisChain, "uosmo");
    expect(result).not.toBeNull();
    expect(result?.displayDenom).toBe("OSMO");
  });
});
