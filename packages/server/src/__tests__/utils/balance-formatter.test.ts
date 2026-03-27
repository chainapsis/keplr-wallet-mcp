import type { ChainInfo } from "@keplr-wallet/types";
import { describe, expect, it } from "vitest";
import {
  formatBalances,
  formatDisplayAmount,
} from "../../utils/balance-formatter.js";

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

describe("formatDisplayAmount", () => {
  it("should return amount unchanged when decimals is 0", () => {
    expect(formatDisplayAmount("12345", 0)).toBe("12345");
    expect(formatDisplayAmount("0", 0)).toBe("0");
    expect(formatDisplayAmount("999999999", 0)).toBe("999999999");
  });

  it("should handle amounts shorter than decimals (small amounts)", () => {
    // 5 with 6 decimals = 0.000005
    expect(formatDisplayAmount("5", 6)).toBe("0.000005");
    // 1 with 18 decimals = 0.000000000000000001
    expect(formatDisplayAmount("1", 18)).toBe("0.000000000000000001");
    // 100 with 6 decimals = 0.000100
    expect(formatDisplayAmount("100", 6)).toBe("0.000100");
  });

  it("should handle standard amounts correctly", () => {
    // 1 OSMO = 1000000 uosmo with 6 decimals
    expect(formatDisplayAmount("1000000", 6)).toBe("1.000000");
    // 10.5 OSMO
    expect(formatDisplayAmount("10500000", 6)).toBe("10.500000");
    // 1 ETH = 1e18 wei with 18 decimals
    expect(formatDisplayAmount("1000000000000000000", 18)).toBe(
      "1.000000000000000000",
    );
  });

  it("should handle zero amount", () => {
    expect(formatDisplayAmount("0", 6)).toBe("0.000000");
    expect(formatDisplayAmount("0", 18)).toBe("0.000000000000000000");
  });

  it("should handle very large amounts without precision loss", () => {
    // Amount exceeding Number.MAX_SAFE_INTEGER (9007199254740991)
    const largeAmount = "123456789012345678901234567890";
    const result = formatDisplayAmount(largeAmount, 18);
    expect(result).toBe("123456789012.345678901234567890");
    // Verify the string manipulation preserved all digits
    expect(result.replace(".", "")).toBe(largeAmount);
  });

  it("should handle amount exactly equal to decimals length", () => {
    // Amount "123456" with 6 decimals = 0.123456
    expect(formatDisplayAmount("123456", 6)).toBe("0.123456");
  });
});

describe("formatBalances", () => {
  it("should resolve native staking denom correctly", () => {
    const result = formatBalances(
      [{ denom: "uosmo", amount: "5000000" }],
      osmosisChain,
    );
    expect(result).toEqual([
      {
        denom: "uosmo",
        amount: "5000000",
        displayAmount: "5.000000",
        displayDenom: "OSMO",
      },
    ]);
  });

  it("should resolve IBC ATOM denom from chain currencies", () => {
    const ibcAtomDenom =
      "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
    const result = formatBalances(
      [{ denom: ibcAtomDenom, amount: "10000000" }],
      osmosisChain,
    );
    expect(result).toEqual([
      {
        denom: ibcAtomDenom,
        amount: "10000000",
        displayAmount: "10.000000",
        displayDenom: "ATOM",
      },
    ]);
  });

  it("should resolve IBC USDC denom from chain currencies", () => {
    const ibcUsdcDenom =
      "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
    const result = formatBalances(
      [{ denom: ibcUsdcDenom, amount: "1000000" }],
      osmosisChain,
    );
    expect(result).toEqual([
      {
        denom: ibcUsdcDenom,
        amount: "1000000",
        displayAmount: "1.000000",
        displayDenom: "USDC",
      },
    ]);
  });

  it("should fall back to raw denom for unknown tokens", () => {
    const unknownDenom = "ibc/UNKNOWN_HASH_ABCDEF1234567890";
    const result = formatBalances(
      [{ denom: unknownDenom, amount: "999999" }],
      osmosisChain,
    );
    expect(result).toEqual([
      {
        denom: unknownDenom,
        amount: "999999",
        displayAmount: "0.999999",
        displayDenom: unknownDenom,
      },
    ]);
  });

  it("should use correct decimals for 18-decimal tokens", () => {
    const dydxChain: ChainInfo = {
      ...osmosisChain,
      chainId: "dydx-mainnet-1",
      stakeCurrency: {
        coinDenom: "DYDX",
        coinMinimalDenom: "adydx",
        coinDecimals: 18,
        coinGeckoId: "dydx-chain",
      },
      currencies: [
        {
          coinDenom: "DYDX",
          coinMinimalDenom: "adydx",
          coinDecimals: 18,
          coinGeckoId: "dydx-chain",
        },
      ],
    };
    const result = formatBalances(
      [{ denom: "adydx", amount: "1000000000000000000" }],
      dydxChain,
    );
    expect(result[0].displayDenom).toBe("DYDX");
    expect(result[0].displayAmount).toBe("1.000000000000000000");
  });

  it("should handle empty balances array", () => {
    const result = formatBalances([], osmosisChain);
    expect(result).toEqual([]);
  });

  it("should handle multiple balances including native and IBC", () => {
    const result = formatBalances(
      [
        { denom: "uosmo", amount: "5000000" },
        {
          denom:
            "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
          amount: "10000000",
        },
        { denom: "ibc/UNKNOWN", amount: "100" },
      ],
      osmosisChain,
    );
    expect(result).toHaveLength(3);
    expect(result[0].displayDenom).toBe("OSMO");
    expect(result[1].displayDenom).toBe("ATOM");
    expect(result[2].displayDenom).toBe("ibc/UNKNOWN");
  });
});
