import { describe, expect, it } from "vitest";
import {
  addAmounts,
  compareAmounts,
  formatCurrencyAmount,
  formatDisplayValue,
  parseCurrencyAmount,
  parseGasPrice,
  subtractAmounts,
} from "../utils/format.js";

describe("formatCurrencyAmount", () => {
  it("should format basic amounts correctly", () => {
    expect(
      formatCurrencyAmount("1500000", { decimals: 6, symbol: "ATOM" }),
    ).toBe("1.5 ATOM");

    expect(
      formatCurrencyAmount("1000000", { decimals: 6, symbol: "ATOM" }),
    ).toBe("1 ATOM");

    expect(
      formatCurrencyAmount("500000", { decimals: 6, symbol: "OSMO" }),
    ).toBe("0.5 OSMO");
  });

  it("should handle 18-decimal tokens (ETH, INJ, DYDX)", () => {
    expect(
      formatCurrencyAmount("1000000000000000000", {
        decimals: 18,
        symbol: "ETH",
      }),
    ).toBe("1 ETH");

    expect(
      formatCurrencyAmount("1500000000000000000", {
        decimals: 18,
        symbol: "INJ",
      }),
    ).toBe("1.5 INJ");

    expect(
      formatCurrencyAmount("12500000000000000000", {
        decimals: 18,
        symbol: "DYDX",
      }),
    ).toBe("12.5 DYDX");
  });

  it("should handle zero amounts", () => {
    expect(formatCurrencyAmount("0", { decimals: 6, symbol: "ATOM" })).toBe(
      "0 ATOM",
    );

    expect(formatCurrencyAmount(0n, { decimals: 18, symbol: "ETH" })).toBe(
      "0 ETH",
    );
  });

  it("should handle bigint input", () => {
    expect(
      formatCurrencyAmount(1500000n, { decimals: 6, symbol: "ATOM" }),
    ).toBe("1.5 ATOM");

    expect(
      formatCurrencyAmount(1000000000000000000n, {
        decimals: 18,
        symbol: "ETH",
      }),
    ).toBe("1 ETH");
  });

  it("should respect includeSymbol option", () => {
    expect(
      formatCurrencyAmount(
        "1500000",
        {
          decimals: 6,
          symbol: "ATOM",
        },
        { includeSymbol: false },
      ),
    ).toBe("1.5");

    expect(
      formatCurrencyAmount(
        "1500000",
        {
          decimals: 6,
          symbol: "ATOM",
        },
        { includeSymbol: true },
      ),
    ).toBe("1.5 ATOM");
  });

  it("should respect maxDecimals option", () => {
    expect(
      formatCurrencyAmount(
        "1234567",
        {
          decimals: 6,
          symbol: "ATOM",
        },
        { maxDecimals: 2 },
      ),
    ).toBe("1.23 ATOM");

    expect(
      formatCurrencyAmount(
        "1234567",
        {
          decimals: 6,
          symbol: "ATOM",
        },
        { maxDecimals: 4 },
      ),
    ).toBe("1.2345 ATOM");
  });

  it("should work with Keplr Currency format", () => {
    expect(
      formatCurrencyAmount("1500000", {
        coinDecimals: 6,
        coinDenom: "ATOM",
      }),
    ).toBe("1.5 ATOM");
  });

  it("should handle very small amounts", () => {
    expect(formatCurrencyAmount("1", { decimals: 6, symbol: "ATOM" })).toBe(
      "0.000001 ATOM",
    );

    expect(formatCurrencyAmount("1", { decimals: 18, symbol: "ETH" })).toBe(
      "0.000000000000000001 ETH",
    );
  });

  it("should handle very large amounts", () => {
    // CoinPretty uses locale formatting by default for large numbers
    expect(
      formatCurrencyAmount("1000000000000", { decimals: 6, symbol: "ATOM" }),
    ).toBe("1,000,000 ATOM");
  });
});

describe("parseCurrencyAmount", () => {
  it("should parse display amounts to minimal denomination", () => {
    expect(parseCurrencyAmount("1.5", 6)).toBe("1500000");
    expect(parseCurrencyAmount("1", 6)).toBe("1000000");
    expect(parseCurrencyAmount("0.5", 6)).toBe("500000");
  });

  it("should handle 18-decimal tokens", () => {
    expect(parseCurrencyAmount("1", 18)).toBe("1000000000000000000");
    expect(parseCurrencyAmount("1.5", 18)).toBe("1500000000000000000");
  });

  it("should handle zero and empty inputs", () => {
    expect(parseCurrencyAmount("0", 6)).toBe("0");
    expect(parseCurrencyAmount("", 6)).toBe("0");
    expect(parseCurrencyAmount("   ", 6)).toBe("0");
  });

  it("should truncate excess decimals", () => {
    expect(parseCurrencyAmount("1.1234567890", 6)).toBe("1123456");
  });

  it("should handle whole numbers without decimal", () => {
    expect(parseCurrencyAmount("100", 6)).toBe("100000000");
  });

  it("should strip commas from formatted input", () => {
    expect(parseCurrencyAmount("1,000.5", 6)).toBe("1000500000");
  });
});

describe("parseGasPrice", () => {
  it("should parse gas price strings", () => {
    const result = parseGasPrice("0.025uatom");
    expect(result.amount).toBe(0.025);
    expect(result.denom).toBe("uatom");
    expect(result.gasPriceStep.low).toBe(0.025);
    expect(result.gasPriceStep.average).toBeCloseTo(0.0375, 10);
    expect(result.gasPriceStep.high).toBeCloseTo(0.05, 10);
  });

  it("should handle large gas prices (e.g., Injective)", () => {
    const result = parseGasPrice("500000000inj");
    expect(result.amount).toBe(500000000);
    expect(result.denom).toBe("inj");
  });

  it("should throw on invalid format", () => {
    expect(() => parseGasPrice("invalid")).toThrow("Invalid gas price format");
  });
});

describe("compareAmounts", () => {
  it("should compare amounts correctly", () => {
    expect(compareAmounts("1000000", "500000")).toBe(1);
    expect(compareAmounts("500000", "1000000")).toBe(-1);
    expect(compareAmounts("1000000", "1000000")).toBe(0);
  });

  it("should handle bigint input", () => {
    expect(compareAmounts(1000000n, 500000n)).toBe(1);
    expect(compareAmounts(500000n, 1000000n)).toBe(-1);
    expect(compareAmounts(1000000n, 1000000n)).toBe(0);
  });

  it("should handle very large amounts (256-bit)", () => {
    const large1 =
      "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const large2 =
      "115792089237316195423570985008687907853269984665640564039457584007913129639934";
    expect(compareAmounts(large1, large2)).toBe(1);
  });
});

describe("addAmounts", () => {
  it("should add amounts correctly", () => {
    expect(addAmounts("1000000", "500000")).toBe("1500000");
    expect(addAmounts("0", "1000000")).toBe("1000000");
  });

  it("should handle bigint input", () => {
    expect(addAmounts(1000000n, 500000n)).toBe("1500000");
  });

  it("should handle very large amounts", () => {
    const large = "100000000000000000000000000000";
    expect(addAmounts(large, large)).toBe("200000000000000000000000000000");
  });
});

describe("subtractAmounts", () => {
  it("should subtract amounts correctly", () => {
    expect(subtractAmounts("1000000", "500000")).toBe("500000");
    expect(subtractAmounts("1000000", "0")).toBe("1000000");
  });

  it("should return 0 for negative results", () => {
    expect(subtractAmounts("500000", "1000000")).toBe("0");
    expect(subtractAmounts("0", "1")).toBe("0");
  });

  it("should handle bigint input", () => {
    expect(subtractAmounts(1000000n, 500000n)).toBe("500000");
  });
});

describe("formatDisplayValue", () => {
  it("should format regular numbers", () => {
    expect(formatDisplayValue(1.5)).toBe("1.5");
    expect(formatDisplayValue(100)).toBe("100");
  });

  it("should handle zero", () => {
    expect(formatDisplayValue(0)).toBe("0");
  });

  it("should use exponential notation for very small numbers", () => {
    expect(formatDisplayValue(0.0000001)).toBe("1.00e-7");
  });

  it("should trim trailing zeros", () => {
    expect(formatDisplayValue(1.5, 6)).toBe("1.5");
    expect(formatDisplayValue(1.0, 6)).toBe("1");
  });
});
