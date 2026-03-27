/**
 * Shared balance formatting utility.
 *
 * Converts raw on-chain balances into display-ready format,
 * resolving denom names using chain config metadata when available.
 */

import type { ChainInfo } from "@keplr-wallet/types";
import {
  getStakeDecimals,
  getStakeDenom,
  getStakeMinimalDenom,
  resolveChainDenom,
} from "../chains/cosmos.js";
import type { BalanceResult } from "../clients/cosmos.js";
import { getTokenDecimals } from "../types/currency.js";

/**
 * Format a minimal-denom amount string into a display amount.
 * Uses string manipulation to avoid floating-point precision loss
 * for amounts exceeding Number.MAX_SAFE_INTEGER (common with 18-decimal tokens).
 */
export const formatDisplayAmount = (
  amount: string,
  decimals: number,
): string => {
  if (decimals === 0) return amount;
  const padded = amount.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);
  return `${intPart}.${fracPart}`;
};

/**
 * Format raw on-chain balances into display-ready BalanceResult[].
 *
 * Resolution order for each balance:
 * 1. Native staking denom → stakeDenom / stakeDecimals
 * 2. Chain config match (currencies → feeCurrencies) → resolved symbol / decimals
 * 3. Fallback → heuristic decimals + raw denom
 */
export const formatBalances = (
  balances: ReadonlyArray<{ denom: string; amount: string }>,
  chain: ChainInfo,
): BalanceResult[] => {
  const minimalDenom = getStakeMinimalDenom(chain);
  const stakeDecimals = getStakeDecimals(chain);
  const stakeDenom = getStakeDenom(chain);

  return balances.map((b) => {
    if (b.denom === minimalDenom) {
      return {
        denom: b.denom,
        amount: b.amount,
        displayAmount: formatDisplayAmount(b.amount, stakeDecimals),
        displayDenom: stakeDenom,
      };
    }

    const resolved = resolveChainDenom(chain, b.denom);
    if (resolved) {
      return {
        denom: b.denom,
        amount: b.amount,
        displayAmount: formatDisplayAmount(b.amount, resolved.decimals),
        displayDenom: resolved.displayDenom,
      };
    }

    const decimals = getTokenDecimals(b.denom);
    return {
      denom: b.denom,
      amount: b.amount,
      displayAmount: formatDisplayAmount(b.amount, decimals),
      displayDenom: b.denom,
    };
  });
};
