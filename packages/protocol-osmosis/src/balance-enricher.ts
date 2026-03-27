/**
 * Osmosis Balance Enricher
 *
 * Resolves unresolved token metadata (symbol, decimals) for Osmosis balances
 * using Skip API asset data. Handles factory denoms (e.g., allBTC with 8 decimals)
 * and IBC denoms that the static chain config doesn't cover.
 */

import type { BalanceResult } from "@keplr-wallet/keplr-wallet-mcp/sdk";
import { toDisplayAmount } from "./client.js";
import { getSkipOsmosisAssets } from "./skip-assets.js";

/**
 * Enrich Osmosis balances with Skip API metadata.
 * Only processes unresolved tokens (where displayDenom === denom).
 * Throws on Skip API errors. The caller (BalanceEnricherRegistry.enrich) handles errors gracefully by falling back to previous results.
 */
export const enrichOsmosisBalances = async (
  balances: BalanceResult[],
  _chainId: string,
): Promise<BalanceResult[]> => {
  const unresolvedExists = balances.some((b) => b.displayDenom === b.denom);
  if (!unresolvedExists) {
    return balances;
  }

  const assets = await getSkipOsmosisAssets();

  return balances.map((b) => {
    if (b.displayDenom !== b.denom) {
      return b;
    }

    const match = assets.find((a) => a.denom === b.denom);
    if (!match) {
      return b;
    }

    return {
      denom: b.denom,
      amount: b.amount,
      displayAmount: toDisplayAmount(b.amount, match.decimals),
      displayDenom: match.recommended_symbol ?? match.symbol,
    };
  });
};
