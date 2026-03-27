/**
 * Human-Readable Amount Parser
 *
 * Parses user-friendly amount inputs like "1 ATOM" or "1.5" into
 * minimal denomination amounts suitable for blockchain transactions.
 */

import type { ChainInfo, Currency } from "@keplr-wallet/types";
import {
  getStakeDecimals,
  getStakeDenom,
  getStakeMinimalDenom,
} from "../chains/cosmos.js";

/**
 * Parsed amount result
 */
export interface ParsedAmount {
  /** Amount in minimal denomination (e.g., "1000000" for 1 ATOM) */
  amount: string;
  /** Minimal denomination (e.g., "uatom") */
  denom: string;
  /** Original input for reference */
  originalInput: string;
  /** Whether the input was in display format (e.g., "1 ATOM" vs "1000000 uatom") */
  wasDisplayFormat: boolean;
}

/**
 * Error thrown when amount parsing fails
 */
export class AmountParseError extends Error {
  constructor(
    message: string,
    public readonly input: string,
  ) {
    super(message);
    this.name = "AmountParseError";
  }
}

/**
 * Find a currency in the chain by denom (display or minimal).
 * Returns the currency config if found.
 */
function findCurrencyByDenom(
  chain: ChainInfo,
  denom: string,
): Currency | undefined {
  const lowerDenom = denom.toLowerCase();

  // Check all currencies in the chain
  for (const currency of chain.currencies) {
    if (
      currency.coinDenom.toLowerCase() === lowerDenom ||
      currency.coinMinimalDenom.toLowerCase() === lowerDenom
    ) {
      return currency;
    }
  }

  // Also check stake currency
  if (chain.stakeCurrency) {
    if (
      chain.stakeCurrency.coinDenom.toLowerCase() === lowerDenom ||
      chain.stakeCurrency.coinMinimalDenom.toLowerCase() === lowerDenom
    ) {
      return chain.stakeCurrency;
    }
  }

  return undefined;
}

/**
 * Check if a denom is a minimal denom (starts with 'u', 'a', 'n', etc. or is IBC denom)
 */
function isMinimalDenom(denom: string): boolean {
  const lower = denom.toLowerCase();
  // Common minimal denom prefixes
  if (
    lower.startsWith("u") || // uatom, uosmo, etc.
    lower.startsWith("a") || // adydx, aevmos, etc.
    lower.startsWith("n") || // nund, etc.
    lower.startsWith("ibc/") // IBC denoms
  ) {
    return true;
  }
  // Special cases
  if (lower === "inj" || lower === "wei") {
    return true;
  }
  return false;
}

/**
 * Parse a human-readable amount into minimal denomination.
 *
 * Supported formats:
 * - "1 ATOM" → 1000000 uatom
 * - "1.5 ATOM" → 1500000 uatom
 * - "1.5" → 1500000 uatom (uses chain's native display denom)
 * - "1000000 uatom" → 1000000 uatom (passthrough for minimal denom)
 * - "1000000" → 1000000 uatom (if looks like minimal denom amount)
 *
 * @param input - User input (e.g., "1 ATOM", "1.5", "1000000 uatom")
 * @param chain - Chain configuration for denom lookup
 * @param overrideDecimals - Optional decimals to use instead of chain staking decimals (for IBC tokens with non-standard decimals)
 * @returns Parsed amount with minimal denom
 * @throws AmountParseError if input cannot be parsed
 */
export function parseHumanAmount(
  input: string,
  chain: ChainInfo,
  overrideDecimals?: number,
): ParsedAmount {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new AmountParseError("Amount cannot be empty", input);
  }

  // Try to parse as "amount denom" format
  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    // Just a number - determine if it's display or minimal format
    return parseAmountOnly(parts[0], chain, input, overrideDecimals);
  }

  if (parts.length === 2) {
    // "amount denom" format
    return parseAmountWithDenom(
      parts[0],
      parts[1],
      chain,
      input,
      overrideDecimals,
    );
  }

  throw new AmountParseError(
    `Invalid amount format: "${input}". Use "1.5 ATOM" or "1000000 uatom"`,
    input,
  );
}

/**
 * Parse amount when only a number is provided (no denom).
 * Uses heuristics to determine if it's display or minimal format.
 */
function parseAmountOnly(
  amountStr: string,
  chain: ChainInfo,
  originalInput: string,
  overrideDecimals?: number,
): ParsedAmount {
  const amount = parseNumber(amountStr, originalInput);
  const decimals = overrideDecimals ?? getStakeDecimals(chain);
  const minimalDenom = getStakeMinimalDenom(chain);

  // Heuristic: if the number has a decimal point or is "small" (< 10000),
  // treat it as display format. Otherwise, treat as minimal denom.
  const hasDecimal = amountStr.includes(".");
  const isSmallNumber = amount < 10000;

  if (hasDecimal || isSmallNumber) {
    // Treat as display format (e.g., "1.5" = 1.5 ATOM)
    const minimalAmount = convertToMinimal(amountStr, decimals);
    return {
      amount: minimalAmount,
      denom: minimalDenom,
      originalInput,
      wasDisplayFormat: true,
    };
  }

  // Treat as minimal denom (e.g., "1000000" = 1000000 uatom)
  return {
    amount: Math.floor(amount).toString(),
    denom: minimalDenom,
    originalInput,
    wasDisplayFormat: false,
  };
}

/**
 * Parse amount with explicit denom.
 */
function parseAmountWithDenom(
  amountStr: string,
  denomStr: string,
  chain: ChainInfo,
  originalInput: string,
  overrideDecimals?: number,
): ParsedAmount {
  const amount = parseNumber(amountStr, originalInput);
  const currency = findCurrencyByDenom(chain, denomStr);

  if (!currency) {
    // Unknown denom - pass through as-is (might be IBC denom)
    if (isMinimalDenom(denomStr)) {
      // If override decimals provided and input has decimal point, treat as display format
      if (overrideDecimals !== undefined && amountStr.includes(".")) {
        const minimalAmount = convertToMinimal(amountStr, overrideDecimals);
        return {
          amount: minimalAmount,
          denom: denomStr,
          originalInput,
          wasDisplayFormat: true,
        };
      }
      return {
        amount: Math.floor(amount).toString(),
        denom: denomStr,
        originalInput,
        wasDisplayFormat: false,
      };
    }
    throw new AmountParseError(
      `Unknown denom "${denomStr}" for chain ${chain.chainId}. Available: ${getStakeDenom(chain)}`,
      originalInput,
    );
  }

  // Determine if input is in display or minimal format
  const isDisplay = currency.coinDenom.toLowerCase() === denomStr.toLowerCase();

  if (isDisplay) {
    // Convert from display to minimal
    const minimalAmount = convertToMinimal(amountStr, currency.coinDecimals);
    return {
      amount: minimalAmount,
      denom: currency.coinMinimalDenom,
      originalInput,
      wasDisplayFormat: true,
    };
  }

  // Already in minimal format
  return {
    amount: Math.floor(amount).toString(),
    denom: currency.coinMinimalDenom,
    originalInput,
    wasDisplayFormat: false,
  };
}

/**
 * Parse a number string, handling decimals.
 */
function parseNumber(str: string, originalInput: string): number {
  // Remove commas (e.g., "1,000,000")
  const cleaned = str.replace(/,/g, "");

  const num = Number.parseFloat(cleaned);

  if (Number.isNaN(num)) {
    throw new AmountParseError(
      `Invalid number: "${str}". Use a valid number like "1.5" or "1000000"`,
      originalInput,
    );
  }

  if (num < 0) {
    throw new AmountParseError("Amount cannot be negative", originalInput);
  }

  return num;
}

/**
 * Convert a display amount to minimal denomination.
 * Handles decimal precision carefully to avoid floating point errors.
 */
function convertToMinimal(amountStr: string, decimals: number): string {
  // Use string/BigInt arithmetic to avoid exponential notation (e.g. "1e+21")
  const str = amountStr.replace(/,/g, "");
  const [whole, frac = ""] = str.split(".");

  if (frac.length > decimals) {
    // More decimal places than needed — truncate and round
    const truncated = BigInt(whole + frac.slice(0, decimals));
    const roundUp = Number(frac[decimals]) >= 5;
    return (truncated + (roundUp ? 1n : 0n)).toString();
  }

  // Pad fractional part with zeros to reach required decimal places
  const paddedFrac = frac.padEnd(decimals, "0");
  return BigInt(whole + paddedFrac).toString();
}

/**
 * Format a minimal amount back to display format.
 * Useful for confirmation messages.
 */
export function formatDisplayAmount(
  minimalAmount: string,
  chain: ChainInfo,
  denom?: string,
): string {
  const targetDenom = denom ?? getStakeMinimalDenom(chain);
  const currency = findCurrencyByDenom(chain, targetDenom);

  if (!currency) {
    // Unknown denom - return as-is
    return `${minimalAmount} ${targetDenom}`;
  }

  const decimals = currency.coinDecimals;
  const amount = BigInt(minimalAmount);
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;

  if (fraction === 0n) {
    return `${whole} ${currency.coinDenom}`;
  }

  // Format with appropriate decimal places
  const fractionStr = fraction.toString().padStart(decimals, "0");
  // Trim trailing zeros
  const trimmedFraction = fractionStr.replace(/0+$/, "");

  return `${whole}.${trimmedFraction} ${currency.coinDenom}`;
}
