/**
 * Currency Formatting Utilities
 *
 * Unified formatting functions for displaying currency amounts across
 * all ecosystems (Cosmos, EVM, protocols).
 *
 * Uses @keplr-wallet/unit for battle-tested arithmetic and formatting.
 */

import type { Currency } from "@keplr-wallet/types";
import { CoinPretty, Int } from "@keplr-wallet/unit";

/**
 * Minimal currency info required for formatting.
 * Works with both Keplr Currency and simple {decimals, symbol} objects.
 */
export type FormatCurrencyInfo =
  | Pick<Currency, "coinDecimals" | "coinDenom">
  | { decimals: number; symbol: string };

/**
 * Normalize currency info to consistent format.
 */
function normalizeCurrencyInfo(currency: FormatCurrencyInfo): {
  decimals: number;
  symbol: string;
} {
  if ("coinDecimals" in currency) {
    return {
      decimals: currency.coinDecimals,
      symbol: currency.coinDenom,
    };
  }
  return currency;
}

/**
 * Format a currency amount for display.
 *
 * Converts from minimal denomination (e.g., uatom, wei) to display format.
 * Uses CoinPretty from @keplr-wallet/unit for battle-tested formatting.
 *
 * @param amount - Amount in minimal denomination (string or bigint)
 * @param currency - Currency info with decimals and symbol
 * @param options - Formatting options
 * @returns Formatted string (e.g., "1.5 ATOM", "0.001 ETH")
 *
 * @example
 * ```typescript
 * formatCurrencyAmount("1500000", { coinDecimals: 6, coinDenom: "ATOM" })
 * // => "1.5 ATOM"
 *
 * formatCurrencyAmount(1000000000000000000n, { decimals: 18, symbol: "ETH" })
 * // => "1 ETH"
 * ```
 */
export function formatCurrencyAmount(
  amount: string | bigint,
  currency: FormatCurrencyInfo,
  options?: {
    /** Include the symbol in output (default: true) */
    includeSymbol?: boolean;
    /** Maximum decimal places to show (default: currency decimals) */
    maxDecimals?: number;
    /** Minimum decimal places to show (default: 0) */
    minDecimals?: number;
    /** Use locale-aware formatting (default: false) */
    useLocale?: boolean;
  },
): string {
  const { decimals, symbol } = normalizeCurrencyInfo(currency);
  const includeSymbol = options?.includeSymbol ?? true;
  const maxDecimals = options?.maxDecimals ?? decimals;
  const useLocale = options?.useLocale ?? false;

  // Create a Currency object for CoinPretty
  const currencyObj = {
    coinDenom: symbol,
    coinMinimalDenom: symbol.toLowerCase(),
    coinDecimals: decimals,
  };

  // Convert amount to string for Int constructor
  const amountStr = typeof amount === "bigint" ? amount.toString() : amount;

  // Use CoinPretty for formatting
  let coinPretty = new CoinPretty(currencyObj, new Int(amountStr))
    .maxDecimals(maxDecimals)
    .trim(true);

  if (useLocale) {
    coinPretty = coinPretty.locale(true);
  }

  if (!includeSymbol) {
    coinPretty = coinPretty.hideDenom(true);
  }

  return coinPretty.toString();
}

/**
 * Parse a display amount to minimal denomination.
 *
 * Converts from display format (e.g., "1.5") to minimal denomination.
 *
 * @param displayAmount - Amount in display format (e.g., "1.5", "100.123")
 * @param decimals - Number of decimal places for the currency
 * @returns Amount in minimal denomination as string
 *
 * @example
 * ```typescript
 * parseCurrencyAmount("1.5", 6)
 * // => "1500000"
 *
 * parseCurrencyAmount("1", 18)
 * // => "1000000000000000000"
 * ```
 */
export function parseCurrencyAmount(
  displayAmount: string,
  decimals: number,
): string {
  // Handle empty input
  if (!displayAmount || displayAmount.trim() === "") {
    return "0";
  }

  // Parse the display amount
  const cleaned = displayAmount.replace(/,/g, "").trim();

  // Split into whole and fractional parts
  const parts = cleaned.split(".");
  const wholePart = parts[0] || "0";
  let fractionalPart = parts[1] || "";

  // Pad or truncate fractional part to match decimals
  if (fractionalPart.length > decimals) {
    // Truncate if too many decimals
    fractionalPart = fractionalPart.slice(0, decimals);
  } else {
    // Pad with zeros if too few decimals
    fractionalPart = fractionalPart.padEnd(decimals, "0");
  }

  // Combine and remove leading zeros (except for "0")
  const combined = wholePart + fractionalPart;
  return combined.replace(/^0+/, "") || "0";
}

/**
 * Parsed gas price information.
 */
export interface ParsedGasPrice {
  /** Gas price amount (e.g., 0.025) */
  amount: number;
  /** Gas price denomination (e.g., "uatom") */
  denom: string;
  /** Gas price step for fee estimation */
  gasPriceStep: {
    low: number;
    average: number;
    high: number;
  };
}

/**
 * Parse a gas price string into structured data.
 *
 * @param gasPriceStr - Gas price string (e.g., "0.025uatom", "500000000inj")
 * @returns Parsed gas price with amount, denom, and gas price step
 *
 * @example
 * ```typescript
 * parseGasPrice("0.025uatom")
 * // => {
 * //   amount: 0.025,
 * //   denom: "uatom",
 * //   gasPriceStep: { low: 0.025, average: 0.0375, high: 0.05 }
 * // }
 * ```
 */
export function parseGasPrice(gasPriceStr: string): ParsedGasPrice {
  const match = gasPriceStr.match(/^([\d.]+)(.+)$/);

  if (!match) {
    throw new Error(`Invalid gas price format: ${gasPriceStr}`);
  }

  const amount = parseFloat(match[1]);
  const denom = match[2];

  return {
    amount,
    denom,
    gasPriceStep: {
      low: amount,
      average: amount * 1.5,
      high: amount * 2,
    },
  };
}

/**
 * Gas adjustment multiplier matching Keplr Extension's tx-executor behavior.
 * - feemarket chains: 1.6 (higher volatility in base fee)
 * - standard chains: 1.4
 */
export const getGasAdjustment = (chain: {
  features?: readonly string[];
}): number => (chain.features?.includes("feemarket") ? 1.6 : 1.4);

/**
 * Calculate fee amount from gas estimate and gas price.
 *
 * @param gasEstimate - Estimated gas units
 * @param gasPriceStr - Gas price string (e.g., "0.025uatom")
 * @param multiplier - Safety multiplier for gas estimate (default: 1.4)
 * @returns Fee amount in minimal denomination
 */
export function calculateFee(
  gasEstimate: number | string,
  gasPriceStr: string,
  multiplier: number = 1.4,
): string {
  const { amount: gasPriceAmount } = parseGasPrice(gasPriceStr);
  const gas =
    typeof gasEstimate === "string" ? parseInt(gasEstimate, 10) : gasEstimate;
  const gasWithBuffer = Math.ceil(gas * multiplier);
  const feeAmount = Math.ceil(gasWithBuffer * gasPriceAmount);

  return feeAmount.toString();
}

/**
 * Format a value with appropriate decimal places for display.
 * Handles very small and very large numbers.
 *
 * @param value - The numeric value
 * @param maxDecimals - Maximum decimal places (default: 6)
 * @returns Formatted string
 */
export function formatDisplayValue(
  value: number,
  maxDecimals: number = 6,
): string {
  if (value === 0) return "0";

  // For very small numbers, use exponential notation
  if (value !== 0 && Math.abs(value) < 0.000001) {
    return value.toExponential(2);
  }

  // For regular numbers, use fixed notation with appropriate decimals
  const formatted = value.toFixed(maxDecimals);

  // Trim trailing zeros after decimal point
  return formatted.replace(/\.?0+$/, "");
}

/**
 * Compare two amounts (useful for balance checks).
 *
 * Uses Int from @keplr-wallet/unit for 256-bit integer comparison.
 *
 * @param a - First amount (string or bigint)
 * @param b - Second amount (string or bigint)
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareAmounts(
  a: string | bigint,
  b: string | bigint,
): -1 | 0 | 1 {
  const intA = new Int(a.toString());
  const intB = new Int(b.toString());

  if (intA.lt(intB)) return -1;
  if (intA.gt(intB)) return 1;
  return 0;
}

/**
 * Add two amounts.
 *
 * Uses Int from @keplr-wallet/unit for 256-bit integer arithmetic.
 *
 * @param a - First amount (string or bigint)
 * @param b - Second amount (string or bigint)
 * @returns Sum as string
 */
export function addAmounts(a: string | bigint, b: string | bigint): string {
  return new Int(a.toString()).add(new Int(b.toString())).toString();
}

/**
 * Subtract two amounts (returns "0" if result would be negative).
 *
 * Uses Int from @keplr-wallet/unit for 256-bit integer arithmetic.
 *
 * @param a - First amount (string or bigint)
 * @param b - Second amount (string or bigint)
 * @returns Difference as string (minimum "0")
 */
export function subtractAmounts(
  a: string | bigint,
  b: string | bigint,
): string {
  const result = new Int(a.toString()).sub(new Int(b.toString()));
  return result.isNegative() ? "0" : result.toString();
}
