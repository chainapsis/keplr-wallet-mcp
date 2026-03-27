import type { ChainInfo } from "@keplr-wallet/types";
import { describe, expect, it } from "vitest";
import {
  AmountParseError,
  formatDisplayAmount,
  parseHumanAmount,
} from "../utils/amount-parser.js";

// Mock chain info for testing
const mockCosmosChain: ChainInfo = {
  rpc: "https://cosmos-rpc.example.com",
  rest: "https://cosmos-lcd.example.com",
  chainId: "cosmoshub-4",
  chainName: "Cosmos Hub",
  stakeCurrency: {
    coinDenom: "ATOM",
    coinMinimalDenom: "uatom",
    coinDecimals: 6,
  },
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: "cosmos",
    bech32PrefixAccPub: "cosmospub",
    bech32PrefixValAddr: "cosmosvaloper",
    bech32PrefixValPub: "cosmosvaloperpub",
    bech32PrefixConsAddr: "cosmosvalcons",
    bech32PrefixConsPub: "cosmosvalconspub",
  },
  currencies: [
    {
      coinDenom: "ATOM",
      coinMinimalDenom: "uatom",
      coinDecimals: 6,
    },
  ],
  feeCurrencies: [
    {
      coinDenom: "ATOM",
      coinMinimalDenom: "uatom",
      coinDecimals: 6,
    },
  ],
};

// Mock chain with 18 decimals (like dYdX)
const mockDydxChain: ChainInfo = {
  rpc: "https://dydx-rpc.example.com",
  rest: "https://dydx-lcd.example.com",
  chainId: "dydx-mainnet-1",
  chainName: "dYdX",
  stakeCurrency: {
    coinDenom: "DYDX",
    coinMinimalDenom: "adydx",
    coinDecimals: 18,
  },
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: "dydx",
    bech32PrefixAccPub: "dydxpub",
    bech32PrefixValAddr: "dydxvaloper",
    bech32PrefixValPub: "dydxvaloperpub",
    bech32PrefixConsAddr: "dydxvalcons",
    bech32PrefixConsPub: "dydxvalconspub",
  },
  currencies: [
    {
      coinDenom: "DYDX",
      coinMinimalDenom: "adydx",
      coinDecimals: 18,
    },
  ],
  feeCurrencies: [
    {
      coinDenom: "DYDX",
      coinMinimalDenom: "adydx",
      coinDecimals: 18,
    },
  ],
};

describe("Amount Parser", () => {
  describe("parseHumanAmount", () => {
    describe("display denom format (e.g., '1 ATOM')", () => {
      it("should parse integer amount with display denom", () => {
        const result = parseHumanAmount("1 ATOM", mockCosmosChain);
        expect(result.amount).toBe("1000000");
        expect(result.denom).toBe("uatom");
        expect(result.wasDisplayFormat).toBe(true);
      });

      it("should parse decimal amount with display denom", () => {
        const result = parseHumanAmount("1.5 ATOM", mockCosmosChain);
        expect(result.amount).toBe("1500000");
        expect(result.denom).toBe("uatom");
        expect(result.wasDisplayFormat).toBe(true);
      });

      it("should parse small decimal amount", () => {
        const result = parseHumanAmount("0.001 ATOM", mockCosmosChain);
        expect(result.amount).toBe("1000");
        expect(result.denom).toBe("uatom");
      });

      it("should handle case-insensitive denom", () => {
        const result = parseHumanAmount("1 atom", mockCosmosChain);
        expect(result.amount).toBe("1000000");
        expect(result.denom).toBe("uatom");
      });

      it("should handle 18 decimal chains", () => {
        const result = parseHumanAmount("1 DYDX", mockDydxChain);
        expect(result.amount).toBe("1000000000000000000");
        expect(result.denom).toBe("adydx");
      });

      it("should not produce exponential notation for large 18-decimal amounts", () => {
        const result = parseHumanAmount("1000 DYDX", mockDydxChain);
        expect(result.amount).toBe("1000000000000000000000");
        expect(result.amount).not.toContain("e");
        expect(result.denom).toBe("adydx");
      });

      it("should not produce exponential notation for 18-decimal overrideDecimals", () => {
        const result = parseHumanAmount("5000", mockCosmosChain, 18);
        expect(result.amount).toBe("5000000000000000000000");
        expect(result.amount).not.toContain("e");
      });
    });

    describe("minimal denom format (e.g., '1000000 uatom')", () => {
      it("should pass through minimal denom amounts", () => {
        const result = parseHumanAmount("1000000 uatom", mockCosmosChain);
        expect(result.amount).toBe("1000000");
        expect(result.denom).toBe("uatom");
        expect(result.wasDisplayFormat).toBe(false);
      });

      it("should handle large minimal amounts", () => {
        const result = parseHumanAmount("999999999 uatom", mockCosmosChain);
        expect(result.amount).toBe("999999999");
        expect(result.denom).toBe("uatom");
      });

      it("should pass through unknown denoms that look like minimal denoms", () => {
        // Unknown denoms starting with u/a/n or ibc/ are passed through
        const result = parseHumanAmount("1000 uunknown", mockCosmosChain);
        expect(result.amount).toBe("1000");
        expect(result.denom).toBe("uunknown");
        expect(result.wasDisplayFormat).toBe(false);
      });
    });

    describe("number-only format", () => {
      it("should treat decimal numbers as display format", () => {
        const result = parseHumanAmount("1.5", mockCosmosChain);
        expect(result.amount).toBe("1500000");
        expect(result.denom).toBe("uatom");
        expect(result.wasDisplayFormat).toBe(true);
      });

      it("should treat small numbers as display format", () => {
        const result = parseHumanAmount("100", mockCosmosChain);
        expect(result.amount).toBe("100000000");
        expect(result.denom).toBe("uatom");
        expect(result.wasDisplayFormat).toBe(true);
      });

      it("should treat large numbers as minimal format", () => {
        const result = parseHumanAmount("1000000", mockCosmosChain);
        expect(result.amount).toBe("1000000");
        expect(result.denom).toBe("uatom");
        expect(result.wasDisplayFormat).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle zero amount", () => {
        const result = parseHumanAmount("0 ATOM", mockCosmosChain);
        expect(result.amount).toBe("0");
        expect(result.denom).toBe("uatom");
      });

      it("should handle amounts with commas", () => {
        const result = parseHumanAmount("1,000 ATOM", mockCosmosChain);
        expect(result.amount).toBe("1000000000");
        expect(result.denom).toBe("uatom");
      });

      it("should handle extra whitespace", () => {
        const result = parseHumanAmount("  1   ATOM  ", mockCosmosChain);
        expect(result.amount).toBe("1000000");
        expect(result.denom).toBe("uatom");
      });
    });

    describe("error handling", () => {
      it("should throw on empty input", () => {
        expect(() => parseHumanAmount("", mockCosmosChain)).toThrow(
          AmountParseError,
        );
      });

      it("should throw on invalid number", () => {
        expect(() => parseHumanAmount("abc ATOM", mockCosmosChain)).toThrow(
          AmountParseError,
        );
      });

      it("should throw on negative amount", () => {
        expect(() => parseHumanAmount("-1 ATOM", mockCosmosChain)).toThrow(
          AmountParseError,
        );
      });

      it("should throw on unknown denom", () => {
        // Use "XYZ" instead of "UNKNOWN" because "UNKNOWN" starts with "u" which
        // is treated as a minimal denom prefix
        expect(() => parseHumanAmount("1 XYZ", mockCosmosChain)).toThrow(
          AmountParseError,
        );
      });

      it("should throw on invalid format", () => {
        expect(() =>
          parseHumanAmount("1 ATOM extra stuff", mockCosmosChain),
        ).toThrow(AmountParseError);
      });
    });

    describe("overrideDecimals parameter", () => {
      it("should use overrideDecimals instead of chain staking decimals for number-only input", () => {
        // Simulates IBC token with 18 decimals on a 6-decimal chain
        const result = parseHumanAmount("1", mockCosmosChain, 18);
        expect(result.amount).toBe("1000000000000000000");
        expect(result.wasDisplayFormat).toBe(true);
      });

      it("should use overrideDecimals for decimal number-only input", () => {
        const result = parseHumanAmount("0.5", mockCosmosChain, 18);
        expect(result.amount).toBe("500000000000000000");
        expect(result.wasDisplayFormat).toBe(true);
      });

      it("should use overrideDecimals for IBC denom with decimal amount", () => {
        const ibcDenom =
          "ibc/5D1F516200EE8C6B2354102143B78A2DEDA25EDE771AC0F8DC3C1837C8FD4447";
        const result = parseHumanAmount(`0.5 ${ibcDenom}`, mockCosmosChain, 18);
        expect(result.amount).toBe("500000000000000000");
        expect(result.denom).toBe(ibcDenom);
        expect(result.wasDisplayFormat).toBe(true);
      });

      it("should not affect parsing when overrideDecimals matches chain decimals", () => {
        const result = parseHumanAmount("1.5", mockCosmosChain, 6);
        expect(result.amount).toBe("1500000");
      });

      it("should not affect known denom parsing even with overrideDecimals", () => {
        // Known denom ATOM uses its own coinDecimals regardless of override
        const result = parseHumanAmount("1 ATOM", mockCosmosChain, 18);
        expect(result.amount).toBe("1000000");
        expect(result.denom).toBe("uatom");
      });

      it("should still passthrough integer IBC amounts without override", () => {
        const ibcDenom =
          "ibc/5D1F516200EE8C6B2354102143B78A2DEDA25EDE771AC0F8DC3C1837C8FD4447";
        const result = parseHumanAmount(`1000000 ${ibcDenom}`, mockCosmosChain);
        expect(result.amount).toBe("1000000");
        expect(result.denom).toBe(ibcDenom);
        expect(result.wasDisplayFormat).toBe(false);
      });
    });
  });

  describe("formatDisplayAmount", () => {
    it("should format minimal amount to display", () => {
      const result = formatDisplayAmount("1000000", mockCosmosChain);
      expect(result).toBe("1 ATOM");
    });

    it("should handle decimal amounts", () => {
      const result = formatDisplayAmount("1500000", mockCosmosChain);
      expect(result).toBe("1.5 ATOM");
    });

    it("should handle small amounts", () => {
      const result = formatDisplayAmount("1000", mockCosmosChain);
      expect(result).toBe("0.001 ATOM");
    });

    it("should trim trailing zeros", () => {
      const result = formatDisplayAmount("1100000", mockCosmosChain);
      expect(result).toBe("1.1 ATOM");
    });

    it("should handle 18 decimal chains", () => {
      const result = formatDisplayAmount("1000000000000000000", mockDydxChain);
      expect(result).toBe("1 DYDX");
    });
  });
});
