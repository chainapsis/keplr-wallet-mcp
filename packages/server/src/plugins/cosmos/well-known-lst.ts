/**
 * Well-known liquid staking tokens (LSTs) per chain.
 *
 * These tokens represent liquid-staked positions where direct unstaking via
 * the issuing contract is either impossible or uses non-obvious message
 * formats (e.g. Drop Protocol's factory contract only exposes admin variants).
 *
 * The registry lets `get-portfolio` and `get-balances` annotate matching
 * balances with exit strategies (typically DEX swap or IBC transfer) so the
 * agent doesn't waste tool calls trying to unstake through the factory.
 */

import type { SuggestedAction } from "../../errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LstDefinition {
  /** Protocol name (e.g. "Drop Protocol") */
  protocol: string;
  /** Human-readable description */
  description: string;
  /** Underlying asset symbol (e.g. "NTRN") */
  underlyingAsset: string;
  /** Match displayDenom (case-insensitive). When omitted, matching relies solely on denomContains. */
  displayDenom?: string;
  /** Alternative: match substring in raw denom (case-insensitive) */
  denomContains?: string;
  /** Frontend URL for manual exit when MCP tool is unavailable */
  frontendUrl?: string;
  /** Build exit strategy actions for this token */
  buildExitActions: (
    chainId: string,
    displayAmount: string,
    denom: string,
    rawAmount: string,
  ) => SuggestedAction[];
}

export interface LstPosition {
  protocol: string;
  description: string;
  underlyingAsset: string;
  displayDenom: string;
  displayAmount: string;
  denom: string;
  frontendUrl?: string;
  suggestedActions: SuggestedAction[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const WELL_KNOWN_LSTS: Record<string, LstDefinition[]> = {};

/** Get LST definitions for a chain. Returns `[]` when none are registered. */
export const getWellKnownLsts = (chainId: string): LstDefinition[] =>
  WELL_KNOWN_LSTS[chainId] ?? [];

// ---------------------------------------------------------------------------
// Matching helper
// ---------------------------------------------------------------------------

/**
 * Identify well-known LSTs among the given balances and return enriched
 * positions with exit strategies. Skips zero-amount balances.
 */
export const matchLstBalances = (
  chainId: string,
  balances: ReadonlyArray<{
    denom: string;
    amount: string;
    displayDenom: string;
    displayAmount: string;
  }>,
): LstPosition[] => {
  const defs = getWellKnownLsts(chainId);
  if (defs.length === 0) return [];

  const positions: LstPosition[] = [];

  for (const balance of balances) {
    if (balance.amount === "0" || balance.amount === "") continue;

    for (const def of defs) {
      const matchByDisplay = def.displayDenom
        ? def.displayDenom.toLowerCase() === balance.displayDenom.toLowerCase()
        : false;
      const matchByDenom = def.denomContains
        ? balance.denom.toLowerCase().includes(def.denomContains.toLowerCase())
        : false;

      if (matchByDisplay || matchByDenom) {
        positions.push({
          protocol: def.protocol,
          description: def.description,
          underlyingAsset: def.underlyingAsset,
          displayDenom: balance.displayDenom,
          displayAmount: balance.displayAmount,
          denom: balance.denom,
          frontendUrl: def.frontendUrl,
          suggestedActions: def.buildExitActions(
            chainId,
            balance.displayAmount,
            balance.denom,
            balance.amount,
          ),
        });
        break; // One match per balance
      }
    }
  }

  return positions;
};
